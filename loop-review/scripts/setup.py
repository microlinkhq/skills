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
node_modules from a sibling worktree.
"""

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


def fingerprint(tree):
    digest = hashlib.sha256()
    for name in manifests(tree):
        with open(os.path.join(tree, name), 'rb') as file:
            digest.update(name.encode() + file.read())
    return digest.hexdigest()


def stamp_path(tree):
    return os.path.join(tree, 'node_modules', STAMP)


def read_stamp(tree):
    try:
        with open(stamp_path(tree)) as file:
            return file.read().strip()
    except OSError:
        return None


def installed_after_manifests(tree):
    markers = [os.path.join(tree, 'node_modules', name) for name in INSTALL_MARKERS]
    installed = max((os.path.getmtime(path) for path in markers if os.path.exists(path)), default=None)
    return installed is not None and all(os.path.getmtime(os.path.join(tree, name)) <= installed for name in manifests(tree))


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


def install(tree, logs):
    if not os.path.isfile(os.path.join(tree, 'package.json')):
        return 'none (no package.json)'
    current = fingerprint(tree)
    modules = os.path.join(tree, 'node_modules')
    stamp = read_stamp(tree)
    if os.path.isdir(modules) and (stamp == current or (stamp is None and installed_after_manifests(tree))):
        with open(stamp_path(tree), 'w') as file:
            file.write(current)
        return 'reused'
    siblings = [t['path'] for t in worktrees(tree)
                if os.path.realpath(t['path']) != os.path.realpath(tree) and os.path.isdir(os.path.join(t['path'], 'node_modules'))]
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
        code = subprocess.run([manager, 'install'], cwd=tree, stdout=out, stderr=subprocess.STDOUT,
                              env={**os.environ, 'CI': '1'}).returncode
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
        deps = install(tree, logs)
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
        f'LOGS={logs}',
        '--- diff stat',
        *(stat if len(stat) <= DIFFSTAT_LINES else stat[:DIFFSTAT_LINES - 1] + ['...', stat[-1]]),
    ]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
