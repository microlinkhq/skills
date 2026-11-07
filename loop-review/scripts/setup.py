#!/usr/bin/env python3
"""Put one pull request in a working tree that is ready to review, push and test.

    setup.py <PR>

Run it from a clone of the pull request's repository (any of its worktrees). It
prints KEY=VALUE lines and exits 0 when the tree is ready, or prints STATUS=blocked
with a one-line REASON (and any detail after a `--- detail` line) and exits 2.

The tree is, in order:

  1. the review tree an earlier run kept: the worktree on branch loop-review/<number>.
     Its unpushed commits are fixes a BLOCKED run committed; the next push sends them;
  2. the worktree that has the head branch checked out (the tree the feature was
     written in), when its tracked files are clean and it has no unpushed commits.
     It is fast-forwarded and reviewed in place;
  3. a new review tree on loop-review/<number> from the remote head, under
     ~/.cache/loop-review (or $LOOP_REVIEW_CACHE).

Trees are never deleted. Dependencies are installed only when a package.json or
lockfile changed since the last install in that tree; a new tree first copies
node_modules from a sibling worktree that owns a portable one. A node_modules that
is a symlink to another tree's is shared: it is reused while the manifests match
that tree's, and replaced by the tree's own install when they do not, so an
install never runs through it. When package.json pins a Node.js major the node on
PATH does not match, a matching installed node is used for the install and saved
for run.sh.
"""

import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

CACHE = os.environ.get('LOOP_REVIEW_CACHE') or os.path.expanduser('~/.cache/loop-review')
STAMP = '.loop-review-deps'
LOCKFILES = {'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lock': 'bun', 'package-lock.json': 'npm'}
INSTALL_MARKERS = ('.modules.yaml', '.package-lock.json', '.yarn-integrity', '.yarn-state.yml')
NODE_BIN_FILE = 'node-bin'
NODE_MAJOR_PIN = re.compile(r'^\s*[\^~=]?v?(\d+)(?:\.(?:x|\*|0))*\s*$')
NODE_VERSION_TIMEOUT = 10
DIFFSTAT_LINES = 30
LOG_TAIL_LINES = 30


class Blocked(Exception):
    def __init__(self, reason, detail=''):
        super().__init__(reason)
        self.detail = detail


def run(args, cwd=None, check=True):
    proc = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip().splitlines()[-5:]
        raise Blocked(f"`{' '.join(args)}` failed: {' | '.join(detail)}")
    return proc.stdout.rstrip()


def git(cwd, *args, check=True):
    return run(['git', '-c', 'color.ui=never', *args], cwd=cwd, check=check)


def parse_ref(ref):
    ref = ref.strip().rstrip('/')
    patterns = [
        (r'^https?://(gitlab\.com)/(.+?)/-/merge_requests/(\d+)', 'gitlab'),
        (r'^https?://(github\.com)/([^/]+/[^/]+)/pull/(\d+)', 'github'),
        (r'^()([\w.-]+(?:/[\w.-]+)+)!(\d+)$', 'gitlab'),
        (r'^()([\w.-]+/[\w.-]+)#(\d+)$', 'github'),
    ]
    for pattern, kind in patterns:
        match = re.match(pattern, ref)
        if match:
            return dict(kind=kind, host=f'{kind}.com', slug=match.group(2), number=match.group(3))
    raise Blocked(f'{ref} is not a pull request URL, owner/repo#number or group/project!number')


def pr_url(pr):
    if pr['kind'] == 'gitlab':
        return f"https://gitlab.com/{pr['slug']}/-/merge_requests/{pr['number']}"
    return f"https://github.com/{pr['slug']}/pull/{pr['number']}"


def read_meta(pr):
    if pr['kind'] == 'github':
        data = json.loads(run(['gh', 'pr', 'view', pr_url(pr), '--json', 'state,title,headRefName,baseRefName,isCrossRepository']))
        return dict(open=data['state'] == 'OPEN', state=data['state'], title=data['title'],
                    head=data['headRefName'], base=data['baseRefName'], fork=data['isCrossRepository'])
    project = urllib.parse.quote(pr['slug'], safe='')
    data = json.loads(run(['glab', 'api', f"projects/{project}/merge_requests/{pr['number']}"]))
    return dict(open=data['state'] == 'opened', state=data['state'], title=data['title'],
                head=data['source_branch'], base=data['target_branch'],
                fork=data['source_project_id'] != data['target_project_id'])


def remote_for(repo, pr):
    """The remote of `repo` that points at the pull request's repository."""
    wanted = f"{pr['host']}/{pr['slug']}".lower()
    for name in git(repo, 'remote').split():
        url = re.sub(r'\.git$', '', git(repo, 'remote', 'get-url', name).rstrip('/')).lower()
        url = re.sub(r'^[a-z+]+://([^@/]+@)?', '', url)
        url = re.sub(r'^[^/@]+@([^:/]+):', r'\1/', url)
        if url == wanted or url.endswith('/' + wanted):
            return name
    return None


def find_clone(pr):
    top = git(os.getcwd(), 'rev-parse', '--show-toplevel', check=False)
    if top and remote_for(top, pr):
        return top
    clone = os.path.join(CACHE, pr['host'], pr['slug'], '_clone')
    if not os.path.isdir(os.path.join(clone, '.git')):
        run(['gh' if pr['kind'] == 'github' else 'glab', 'repo', 'clone', pr['slug'], clone])
    return clone


def worktrees(repo):
    trees, current = [], {}
    for line in git(repo, 'worktree', 'list', '--porcelain').splitlines() + ['']:
        if line.startswith('worktree '):
            current = {'path': line[len('worktree '):]}
        elif line.startswith('branch '):
            current['branch'] = line[len('branch refs/heads/'):]
        elif not line and current:
            trees.append(current)
            current = {}
    return trees


def tree_on(repo, branch):
    return next((t['path'] for t in worktrees(repo) if t.get('branch') == branch and os.path.isdir(t['path'])), None)


def in_progress(tree):
    return next((state for state in ('rebase-merge', 'rebase-apply', 'MERGE_HEAD')
                 if os.path.exists(git(tree, 'rev-parse', '--path-format=absolute', '--git-path', state))), None)


def dirty(tree):
    return git(tree, 'status', '--porcelain', '--untracked-files=no')


def ahead_behind(tree, upstream):
    return map(int, git(tree, 'rev-list', '--left-right', '--count', f'HEAD...{upstream}').split())


def place_tree(pr, meta):
    """Returns (tree, kind, remote, base)."""
    repo = find_clone(pr)
    remote = remote_for(repo, pr)
    if not remote:
        raise Blocked(f"{repo} has no remote for {pr['host']}/{pr['slug']}")
    git(repo, 'fetch', '--quiet', remote, meta['base'], meta['head'])
    base, upstream = f"{remote}/{meta['base']}", f"{remote}/{meta['head']}"
    branch = f"loop-review/{pr['number']}"

    review = tree_on(repo, branch)
    feature = tree_on(repo, meta['head'])
    if not review and feature and not dirty(feature) and not in_progress(feature):
        ahead, behind = ahead_behind(feature, upstream)
        if not ahead:
            if behind:
                git(feature, 'merge', '--ff-only', '--quiet', upstream)
            return feature, 'feature', remote, base

    if not review:
        review = os.path.join(CACHE, pr['host'], pr['slug'], pr['number'])
        if os.path.exists(review):
            raise Blocked(f'{review} exists but is not a worktree of {repo}: move it aside, then run again')
        if git(repo, 'rev-parse', '--verify', '--quiet', f'refs/heads/{branch}', check=False):
            git(repo, 'worktree', 'add', '--quiet', review, branch)
        else:
            git(repo, 'worktree', 'add', '--quiet', '--no-track', '-b', branch, review, upstream)
    state = in_progress(review)
    if state:
        raise Blocked(f'{review} has a {state} in progress: finish or abort it, then run again')
    if dirty(review):
        raise Blocked(f'{review} has uncommitted changes: commit or restore them, then run again')
    ahead, behind = ahead_behind(review, upstream)
    if ahead and behind:
        raise Blocked(f"{review} and {upstream} have diverged: run `git pull --rebase {remote} {meta['head']}` there, then run again")
    if behind:
        git(review, 'merge', '--ff-only', '--quiet', upstream)
    return review, 'review', remote, base


def manifests(tree):
    tracked = git(tree, 'ls-files', '--', 'package.json', '*/package.json', *LOCKFILES, *[f'*/{f}' for f in LOCKFILES])
    return sorted(path for path in tracked.splitlines() if 'node_modules/' not in path)


def fingerprint(tree, root=None):
    """Hash of the tree's manifests, read from `root` (default: the tree itself)."""
    digest = hashlib.sha256()
    for name in manifests(tree):
        try:
            with open(os.path.join(root or tree, name), 'rb') as file:
                digest.update(name.encode() + file.read())
        except OSError:
            digest.update(name.encode() + b'\0missing')
    return digest.hexdigest()


def stamp_path(tree):
    return os.path.join(tree, 'node_modules', STAMP)


def read_stamp(tree):
    try:
        with open(stamp_path(tree)) as file:
            return file.read().strip()
    except OSError:
        return None


def installed_after_manifests(tree, root=None):
    """The tree's manifests, read from `root` (default: the tree), are older than the last install there."""
    root = root or tree
    markers = [os.path.join(root, 'node_modules', name) for name in INSTALL_MARKERS]
    installed = max((os.path.getmtime(path) for path in markers if os.path.exists(path)), default=None)
    return installed is not None and all(
        os.path.exists(os.path.join(root, name)) and os.path.getmtime(os.path.join(root, name)) <= installed
        for name in manifests(tree))


def shared_install_matches(tree, shared):
    """A node_modules linked to another tree's serves this one only when nothing about the install would differ."""
    owner = os.path.dirname(shared)
    inside = os.path.commonpath([os.path.realpath(tree), owner]) == os.path.realpath(tree)
    workspace_packages = any(name not in ('package.json', *LOCKFILES) for name in manifests(tree))
    if inside or workspace_packages or not os.path.isdir(shared):
        return False
    current = fingerprint(tree)
    if fingerprint(tree, owner) != current:
        return False
    stamp = read_stamp(owner)
    return stamp == current or (stamp is None and installed_after_manifests(tree, owner))


def package_manager(tree, siblings):
    try:
        with open(os.path.join(tree, 'package.json')) as file:
            declared = (json.load(file).get('packageManager') or '').split('@')[0]
    except (OSError, ValueError):
        declared = ''
    if declared:
        return declared
    lockfile = next((manager for name, manager in LOCKFILES.items() if os.path.exists(os.path.join(tree, name))), None)
    if lockfile:
        return lockfile
    if os.path.exists(os.path.join(tree, 'pnpm-workspace.yaml')) or any(
            os.path.isdir(os.path.join(path, 'node_modules', '.pnpm')) for path in [tree, *siblings]):
        return 'pnpm'
    return 'npm'


def install_env(node_bin):
    """CI makes pnpm install with --frozen-lockfile, which fails in a repository without a lockfile."""
    env = {name: value for name, value in os.environ.items() if name != 'CI'}
    if node_bin:
        env['PATH'] = node_bin + os.pathsep + env.get('PATH', '')
    return env


def install_command(manager):
    """pnpm asks before rebuilding a node_modules laid out with other settings, and fails without a terminal."""
    return [manager, 'install', '--config.confirmModulesPurge=false'] if manager == 'pnpm' else [manager, 'install']


def virtual_store_dir(modules):
    try:
        with open(os.path.join(modules, '.modules.yaml')) as file:
            text = file.read()
    except OSError:
        return None
    try:
        return json.loads(text).get('virtualStoreDir')
    except ValueError:
        match = re.search(r'^virtualStoreDir:\s*[\'"]?([^\'"\n]+)', text, re.M)
        return match.group(1).strip() if match else None


def portable(modules):
    """A real node_modules whose pnpm virtual store lives inside it, so a copy of it still works elsewhere."""
    if os.path.islink(modules) or not os.path.isdir(modules):
        return False
    store = virtual_store_dir(modules)
    return store is None or not (os.path.isabs(store) or os.path.normpath(store).startswith('..'))


def node_major(binary='node', env=None):
    try:
        version = subprocess.run([binary, '--version'], capture_output=True, text=True, env=env,
                                 timeout=NODE_VERSION_TIMEOUT).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return None, None
    match = re.match(r'v?(\d+)', version)
    return (int(match.group(1)), version) if match else (None, None)


def pinned_node_major(tree):
    try:
        with open(os.path.join(tree, 'package.json')) as file:
            wanted = str((json.load(file).get('engines') or {}).get('node') or '')
    except (OSError, ValueError, AttributeError):
        return None
    match = NODE_MAJOR_PIN.match(wanted)
    return int(match.group(1)) if match else None


def installed_node_bins(major):
    home = os.path.expanduser('~')
    n_prefix = os.environ.get('N_PREFIX') or os.path.join(home, '.n')
    nvm = os.environ.get('NVM_DIR') or os.path.join(home, '.nvm')
    patterns = [
        os.path.join(n_prefix, 'n', 'versions', 'node', f'{major}.*', 'bin'),
        os.path.join('/usr/local/n/versions/node', f'{major}.*', 'bin'),
        os.path.join(nvm, 'versions', 'node', f'v{major}.*', 'bin'),
        os.path.join(home, '.local/share/fnm/node-versions', f'v{major}.*', 'installation', 'bin'),
        os.path.join(home, 'Library/Application Support/fnm/node-versions', f'v{major}.*', 'installation', 'bin'),
        os.path.join(home, '.volta/tools/image/node', f'{major}.*', 'bin'),
        os.path.join(home, '.local/share/mise/installs/node', f'{major}.*', 'bin'),
        f'/opt/homebrew/opt/node@{major}/bin',
        f'/usr/local/opt/node@{major}/bin',
    ]
    found = [path for pattern in patterns for path in glob.glob(pattern) if os.access(os.path.join(path, 'node'), os.X_OK)]
    return sorted(found, key=version_in_path, reverse=True)


def version_in_path(path):
    versions = re.findall(r'(?<![\w.])v?(\d+)\.(\d+)\.(\d+)(?![\w.])', path)
    return tuple(map(int, versions[-1])) if versions else (0, 0, 0)


def choose_node(tree, logs):
    """Returns (bin dir to put first on PATH or None, NODE line). run.sh reads the saved bin dir."""
    saved = os.path.join(logs, NODE_BIN_FILE)
    wanted = pinned_node_major(tree)
    current, version = node_major()
    if wanted is None or current == wanted:
        if os.path.exists(saved):
            os.remove(saved)
        return None, version or 'not found'
    node_bin = next((path for path in installed_node_bins(wanted)
                     if node_major(os.path.join(path, 'node'))[0] == wanted), None)
    if not node_bin:
        if os.path.exists(saved):
            os.remove(saved)
        return None, f'{version or "not found"}, but package.json wants {wanted} and no node {wanted} is installed'
    with open(saved, 'w') as file:
        file.write(node_bin)
    return node_bin, f"{node_major(os.path.join(node_bin, 'node'))[1]} from {node_bin}"


def install(tree, logs, node_bin):
    if not os.path.isfile(os.path.join(tree, 'package.json')):
        return 'none (no package.json)'
    current = fingerprint(tree)
    modules = os.path.join(tree, 'node_modules')
    if os.path.islink(modules):
        shared = os.path.realpath(modules)
        if shared_install_matches(tree, shared):
            return f'linked to {shared}'
        os.unlink(modules)
    stamp = read_stamp(tree)
    if os.path.isdir(modules) and (stamp == current or (stamp is None and installed_after_manifests(tree))):
        with open(stamp_path(tree), 'w') as file:
            file.write(current)
        return 'reused'
    siblings = [t['path'] for t in worktrees(tree)
                if os.path.realpath(t['path']) != os.path.realpath(tree) and portable(os.path.join(t['path'], 'node_modules'))]
    copied = ''
    if not os.path.isdir(modules) and siblings:
        source = next((s for s in siblings if read_stamp(s) == current), siblings[0])
        copy = ['cp', '-cR'] if sys.platform == 'darwin' else ['cp', '-a', '--reflink=auto']
        if subprocess.run([*copy, os.path.join(source, 'node_modules'), modules], capture_output=True).returncode != 0:
            shutil.copytree(os.path.join(source, 'node_modules'), modules, symlinks=True, dirs_exist_ok=True)
        copied = f'copied from {source}'
        if read_stamp(source) == current:
            return copied
    manager = package_manager(tree, siblings)
    log = os.path.join(logs, 'install.log')
    with open(log, 'w') as out:
        code = subprocess.run(install_command(manager), cwd=tree, stdin=subprocess.DEVNULL, stdout=out,
                              stderr=subprocess.STDOUT, env=install_env(node_bin)).returncode
    if code != 0:
        with open(log) as file:
            raise Blocked(f'`{manager} install` exited {code}, log {log}', '\n'.join(file.read().splitlines()[-LOG_TAIL_LINES:]))
    with open(stamp_path(tree), 'w') as file:
        file.write(fingerprint(tree))
    return f"{copied + ', then ' if copied else ''}{manager} install"


def main(argv):
    if len(argv) != 1:
        print('usage: setup.py <PR>', file=sys.stderr)
        return 64
    try:
        pr = parse_ref(argv[0])
        meta = read_meta(pr)
        if not meta['open']:
            raise Blocked(f"{pr_url(pr)} is {meta['state']}, not open")
        if meta['fork']:
            raise Blocked('pull requests from a fork are not supported: check one out by hand')
        tree, kind, remote, base = place_tree(pr, meta)
        logs = git(tree, 'rev-parse', '--path-format=absolute', '--git-path', 'loop-review')
        os.makedirs(logs, exist_ok=True)
        git(tree, 'push', '--dry-run', '--quiet', '--no-verify', remote, f"HEAD:refs/heads/{meta['head']}")
        node_bin, node = choose_node(tree, logs)
        deps = install(tree, logs, node_bin)
        ahead, _ = ahead_behind(tree, f"{remote}/{meta['head']}")
    except Blocked as error:
        print('STATUS=blocked')
        print(f'REASON={error}')
        if error.detail:
            print('--- detail')
            print(error.detail)
        return 2
    stat = git(tree, 'diff', '--stat', f'{base}...HEAD').splitlines()
    print('\n'.join([
        'STATUS=ready',
        f'PR={pr_url(pr)}',
        f"TITLE={meta['title']}",
        f'TREE={tree}',
        f'TREE_KIND={kind}',
        f"BRANCH={git(tree, 'branch', '--show-current')}",
        f'BASE={base}',
        f"PUSH=git push {remote} HEAD:refs/heads/{meta['head']}",
        f"PULL=git pull --rebase {remote} {meta['head']}",
        f'UNPUSHED={ahead}',
        f'INSTALL={deps}',
        f'NODE={node}',
        f'LOGS={logs}',
        '--- diff stat',
        *(stat if len(stat) <= DIFFSTAT_LINES else stat[:DIFFSTAT_LINES - 1] + ['...', stat[-1]]),
    ]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
