#!/usr/bin/env python3
"""Put one pull request in a working tree that is ready to review, push and test.

    setup.py <PR>

Prints KEY=VALUE lines and exits 0 when the tree is ready, or prints STATUS=blocked
with a one-line REASON (and any detail after a `--- detail` line) and exits 2.

The tree is, in order of preference:

  1. the review tree an earlier run kept for this pull request: the worktree on
     branch loop-review/<number>, wherever it is, or the cache path for it. Its own unpushed commits are kept: they
     are fixes a BLOCKED run committed, and the next push publishes them;
  2. a worktree of a local clone that has the head branch checked out (the tree the
     feature was written in), when its tracked files are clean and it has no commits
     the remote lacks. It is fast-forwarded and used in place, and never switched;
  3. a new review tree, branch loop-review/<number> from the remote head, added to
     the clone the current directory belongs to, or to one cached clone of the
     repository when it does not belong to one.

Trees are never deleted, so the next run is a fetch. Dependencies are installed
only when a package.json or lockfile changed since the last install in that tree; a
new tree first clones node_modules from a sibling worktree.
"""

import contextlib
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

CACHE = os.environ.get('LOOP_REVIEW_CACHE') or os.path.join(
    os.environ.get('XDG_CACHE_HOME') or os.path.expanduser('~/.cache'), 'loop-review')
STAMP = '.loop-review-deps'
ACTIVE_MUTATION = 'active-mutation'
LOCKFILES = {
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'bun.lock': 'bun',
    'bun.lockb': 'bun',
    'package-lock.json': 'npm',
}
DIFFSTAT_LINES = 30
LOG_TAIL_LINES = 30


class Blocked(Exception):
    def __init__(self, reason, detail=''):
        super().__init__(reason)
        self.detail = detail


def run(args, cwd=None, check=True, env=None):
    proc = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                          env={**os.environ, **(env or {})})
    if check and proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip().splitlines()[-5:]
        raise Blocked(f"`{' '.join(args)}` failed: {' | '.join(detail)}")
    return proc.stdout.rstrip()


def git(cwd, *args, check=True):
    return run(['git', '-c', 'color.ui=never', *args], cwd=cwd, check=check)


def git_path(tree, name):
    return git(tree, 'rev-parse', '--path-format=absolute', '--git-path', name)


def parse_ref(ref):
    ref = ref.strip().rstrip('/')
    gitlab = re.match(r'^https?://([^/]+)/(.+?)/-/merge_requests/(\d+)', ref)
    if gitlab:
        return dict(host=gitlab.group(1).lower(), kind='gitlab', slug=gitlab.group(2), number=gitlab.group(3))
    github = re.match(r'^https?://([^/]+)/([^/]+/[^/]+)/pull/(\d+)', ref)
    if github:
        return dict(host=github.group(1).lower(), kind='github', slug=github.group(2), number=github.group(3))
    short_gitlab = re.match(r'^([\w.-]+(?:/[\w.-]+)+)!(\d+)$', ref)
    if short_gitlab:
        return dict(host='gitlab.com', kind='gitlab', slug=short_gitlab.group(1), number=short_gitlab.group(2))
    short_github = re.match(r'^([\w.-]+/[\w.-]+)#(\d+)$', ref)
    if short_github:
        return dict(host='github.com', kind='github', slug=short_github.group(1), number=short_github.group(2))
    raise Blocked(f'{ref} is not a pull request URL, owner/repo#number or group/project!number')


def pr_url(pr):
    if pr['kind'] == 'gitlab':
        return f"https://{pr['host']}/{pr['slug']}/-/merge_requests/{pr['number']}"
    return f"https://{pr['host']}/{pr['slug']}/pull/{pr['number']}"


def cli_env(pr):
    return {'GH_HOST': pr['host']} if pr['kind'] == 'github' else {'GITLAB_HOST': pr['host']}


def read_meta(pr):
    env = cli_env(pr)
    if pr['kind'] == 'github':
        fields = 'state,title,headRefName,baseRefName,isCrossRepository'
        data = json.loads(run(['gh', 'pr', 'view', pr_url(pr), '--json', fields], env=env))
        return dict(open=data['state'] == 'OPEN', state=data['state'], title=data['title'],
                    head=data['headRefName'], base=data['baseRefName'], fork=data['isCrossRepository'])
    project = urllib.parse.quote(pr['slug'], safe='')
    data = json.loads(run(['glab', 'api', '--hostname', pr['host'],
                           f"projects/{project}/merge_requests/{pr['number']}"], env=env))
    return dict(open=data['state'] == 'opened', state=data['state'], title=data['title'],
                head=data['source_branch'], base=data['target_branch'],
                fork=data['source_project_id'] != data['target_project_id'])


def ssh_hostname(alias):
    proc = subprocess.run(['ssh', '-G', alias], capture_output=True, text=True)
    for line in proc.stdout.splitlines():
        if line.startswith('hostname '):
            return line.split(' ', 1)[1].strip().lower()
    return alias


def remote_location(url):
    """(host, path) of a remote URL, or (None, path) for a local one."""
    url = re.sub(r'\.git$', '', url.strip().rstrip('/'))
    scp = re.match(r'^(?:[^/@]+@)?([^:/]+):(?!//)(.+)$', url)
    if scp and not url.startswith('/'):
        return ssh_hostname(scp.group(1).lower()), scp.group(2).lower()
    remote = re.match(r'^[a-z+]+://(?:[^@/]+@)?([^/:]+)(?::\d+)?/(.+)$', url)
    if remote and not url.startswith('file://'):
        host = remote.group(1).lower()
        return (ssh_hostname(host) if url.startswith('ssh://') else host), remote.group(2).lower()
    return None, re.sub(r'^file://', '', url).lower()


def remote_for(repo, pr):
    """The remote of `repo` that points at the pull request's repository."""
    slug = pr['slug'].lower()
    for name in git(repo, 'remote').split():
        host, path = remote_location(git(repo, 'remote', 'get-url', name))
        if host == pr['host'] and path == slug:
            return name
        if host is None and path.endswith(f"/{pr['host']}/{slug}"):
            return name
    return None


def local_clone(pr, start):
    """The clone the current directory belongs to, when it has a remote for the repository."""
    top = git(start, 'rev-parse', '--show-toplevel', check=False) if os.path.isdir(start) else ''
    if top and remote_for(top, pr):
        return top
    return None


def cached_clone(pr):
    path = os.path.join(CACHE, pr['host'], pr['slug'], '_clone')
    if not os.path.isdir(os.path.join(path, '.git')):
        cli = 'gh' if pr['kind'] == 'github' else 'glab'
        run([cli, 'repo', 'clone', f"{pr['host']}/{pr['slug']}", path], env=cli_env(pr))
    return path


@contextlib.contextmanager
def repository_lock(pr):
    """One setup at a time per repository, so batch runs do not race on one clone."""
    os.makedirs(os.path.join(CACHE, pr['host'], pr['slug']), exist_ok=True)
    with open(os.path.join(CACHE, pr['host'], pr['slug'], '.lock'), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def worktrees(repo):
    trees, current = [], {}
    for line in git(repo, 'worktree', 'list', '--porcelain').splitlines() + ['']:
        if not line:
            if current:
                trees.append(current)
            current = {}
        elif ' ' in line:
            key, value = line.split(' ', 1)
            current[key] = value
        else:
            current[line] = True
    return trees


def same_path(a, b):
    return os.path.realpath(a) == os.path.realpath(b)


def tree_on(repo, branch):
    for tree in worktrees(repo):
        if tree.get('branch') == f'refs/heads/{branch}' and os.path.isdir(tree['worktree']):
            return tree['worktree']
    return None


def registered(repo, path):
    return any(same_path(tree['worktree'], path) for tree in worktrees(repo))


def recover_mutation(tree):
    """Restores a file a killed mutate.py run left mutated."""
    marker = git_path(tree, os.path.join('loop-review', ACTIVE_MUTATION))
    if os.path.exists(marker):
        with open(marker) as file:
            path = file.read().strip()
        git(tree, 'restore', '--source=HEAD', '--staged', '--worktree', '--', path)
        os.remove(marker)


def operation_in_progress(tree):
    return next((state for state in ('rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD')
                 if os.path.exists(git_path(tree, state))), None)


def is_clean(tree):
    return not git(tree, 'status', '--porcelain', '--untracked-files=no') and not operation_in_progress(tree)


def counts(tree, upstream):
    return map(int, git(tree, 'rev-list', '--left-right', '--count', f'HEAD...{upstream}').split())


def place_tree(pr, meta, start):
    """Returns (tree, kind, push remote, base ref)."""
    repo = local_clone(pr, start) or cached_clone(pr)
    remote = remote_for(repo, pr)
    if not remote:
        raise Blocked(f"{repo} has no remote for {pr['host']}/{pr['slug']}")
    git(repo, 'fetch', '--quiet', remote, meta['base'])
    base = f"{remote}/{meta['base']}"
    review_branch = f"loop-review/{pr['number']}"
    review_path = tree_on(repo, review_branch) or os.path.join(CACHE, pr['host'], pr['slug'], pr['number'])

    if meta['fork']:
        if pr['kind'] == 'gitlab':
            raise Blocked('merge requests from a fork are not supported: check one out by hand')
        if not registered(repo, review_path):
            git(repo, 'worktree', 'add', '--quiet', '--detach', review_path)
        recover_mutation(review_path)
        if not is_clean(review_path):
            raise Blocked(f'{review_path} has uncommitted changes or an operation in progress')
        run(['gh', 'pr', 'checkout', pr_url(pr), '--branch', review_branch], cwd=review_path, env=cli_env(pr))
        return review_path, 'review', git(review_path, 'config', f'branch.{review_branch}.remote'), base

    git(repo, 'fetch', '--quiet', remote, meta['head'])
    upstream = f"{remote}/{meta['head']}"

    feature = tree_on(repo, meta['head'])
    if feature and not registered(repo, review_path):
        recover_mutation(feature)
        ahead, behind = counts(feature, upstream)
        if is_clean(feature) and not ahead:
            if behind:
                git(feature, 'merge', '--ff-only', '--quiet', upstream)
            return feature, 'feature', remote, base

    if not registered(repo, review_path):
        if os.path.exists(review_path):
            raise Blocked(f'{review_path} exists but is not a worktree of {repo}: move it aside, then run again')
        if git(repo, 'rev-parse', '--verify', '--quiet', f'refs/heads/{review_branch}', check=False):
            git(repo, 'worktree', 'add', '--quiet', review_path, review_branch)
        else:
            git(repo, 'worktree', 'add', '--quiet', '--no-track', '-b', review_branch, review_path, upstream)

    recover_mutation(review_path)
    state = operation_in_progress(review_path)
    if state:
        raise Blocked(f'{review_path} has a {state} in progress: finish or abort it, then run again')
    if git(review_path, 'status', '--porcelain', '--untracked-files=no'):
        raise Blocked(f'{review_path} has uncommitted changes: commit or restore them, then run again')
    ahead, behind = counts(review_path, upstream)
    if ahead and behind:
        raise Blocked(f'{review_path} and {upstream} have diverged ({ahead} local, {behind} remote commits): '
                      f'run `git pull --rebase {remote} {meta["head"]}` there, then run again')
    if behind:
        git(review_path, 'merge', '--ff-only', '--quiet', upstream)
    return review_path, 'review', remote, base


def manifests(tree):
    tracked = git(tree, 'ls-files', '--', 'package.json', '*/package.json', *LOCKFILES, *[f'*/{f}' for f in LOCKFILES])
    return sorted(path for path in tracked.splitlines() if 'node_modules/' not in path)


def is_single_package(tree):
    return sum(os.path.basename(path) == 'package.json' for path in manifests(tree)) == 1


def deps_fingerprint(tree):
    digest = hashlib.sha256()
    for name in manifests(tree):
        digest.update(name.encode())
        with open(os.path.join(tree, name), 'rb') as file:
            digest.update(file.read())
    return digest.hexdigest()


def package_manager(tree, siblings):
    try:
        with open(os.path.join(tree, 'package.json')) as file:
            declared = (json.load(file).get('packageManager') or '').split('@')[0]
    except (OSError, ValueError):
        declared = ''
    if declared:
        return declared
    for lockfile, manager in LOCKFILES.items():
        if os.path.exists(os.path.join(tree, lockfile)):
            return manager
    if any(os.path.isdir(os.path.join(sibling, 'node_modules', '.pnpm')) for sibling in [tree, *siblings]):
        return 'pnpm'
    return 'npm'


def read_stamp(tree):
    try:
        with open(os.path.join(tree, 'node_modules', STAMP)) as file:
            return file.read().strip()
    except OSError:
        return None


def write_stamp(tree, fingerprint):
    with open(os.path.join(tree, 'node_modules', STAMP), 'w') as file:
        file.write(fingerprint)


def clone_dir(source, target):
    cmd = ['cp', '-cR', source, target] if sys.platform == 'darwin' else ['cp', '-a', '--reflink=auto', source, target]
    if subprocess.run(cmd, capture_output=True).returncode != 0:
        shutil.rmtree(target, ignore_errors=True)
        shutil.copytree(source, target, symlinks=True)


def install(tree, logs):
    if not os.path.isfile(os.path.join(tree, 'package.json')):
        return 'none (no package.json)'
    fingerprint = deps_fingerprint(tree)
    modules = os.path.join(tree, 'node_modules')
    if os.path.isdir(modules) and read_stamp(tree) == fingerprint:
        return 'reused'
    siblings = [t['worktree'] for t in worktrees(tree)
                if not same_path(t['worktree'], tree) and os.path.isdir(os.path.join(t['worktree'], 'node_modules'))]
    cloned = ''
    if not os.path.isdir(modules) and siblings:
        exact = [s for s in siblings if read_stamp(s) == fingerprint]
        source = (exact or siblings)[0]
        clone_dir(os.path.join(source, 'node_modules'), modules)
        cloned = f'cloned from {source}'
        if exact and is_single_package(tree):
            write_stamp(tree, fingerprint)
            return cloned
    manager = package_manager(tree, siblings)
    log = os.path.join(logs, 'install.log')
    with open(log, 'w') as out:
        code = subprocess.run([manager, 'install'], cwd=tree, stdout=out, stderr=subprocess.STDOUT,
                              env={**os.environ, 'CI': '1'}).returncode
    if code != 0:
        with open(log) as file:
            tail = file.read().splitlines()[-LOG_TAIL_LINES:]
        raise Blocked(f'`{manager} install` exited {code}, log {log}', '\n'.join(tail))
    rewritten = git(tree, 'diff', '--name-only').splitlines()
    if rewritten:
        git(tree, 'restore', '--', *rewritten)
    write_stamp(tree, deps_fingerprint(tree))
    note = f" (restored {', '.join(rewritten)}, which the install rewrote)" if rewritten else ''
    return f"{cloned + ', then ' if cloned else ''}{manager} install{note}"


def main(argv):
    if len(argv) != 1:
        print('usage: setup.py <PR>', file=sys.stderr)
        return 64
    try:
        pr = parse_ref(argv[0])
        meta = read_meta(pr)
        if not meta['open']:
            raise Blocked(f"{pr_url(pr)} is {meta['state']}, not open")
        with repository_lock(pr):
            tree, kind, remote, base = place_tree(pr, meta, os.getcwd())
            logs = git_path(tree, 'loop-review')
            os.makedirs(logs, exist_ok=True)
            git(tree, 'push', '--dry-run', '--quiet', '--no-verify', remote, f"HEAD:refs/heads/{meta['head']}")
            deps = install(tree, logs)
        ahead, _ = counts(tree, f"{remote}/{meta['head']}") if not meta['fork'] else (0, 0)
    except Blocked as error:
        print('STATUS=blocked')
        print(f'REASON={error}')
        if error.detail:
            print('--- detail')
            print(error.detail)
        return 2
    print('STATUS=ready')
    print(f'PR={pr_url(pr)}')
    print(f"TITLE={meta['title']}")
    print(f'TREE={tree}')
    print(f'TREE_KIND={kind}')
    print(f"BRANCH={git(tree, 'branch', '--show-current')}")
    print(f'BASE={base}')
    print(f"PUSH=git push {remote} HEAD:refs/heads/{meta['head']}")
    print(f"PULL=git pull --rebase {remote} {meta['head']}")
    print(f"HEAD={git(tree, 'rev-parse', '--short', 'HEAD')}")
    print(f'UNPUSHED={ahead}')
    print(f'INSTALL={deps}')
    print(f'LOGS={logs}')
    print('--- diff stat')
    stat = git(tree, 'diff', '--stat', f'{base}...HEAD').splitlines()
    print('\n'.join(stat if len(stat) <= DIFFSTAT_LINES else stat[:DIFFSTAT_LINES - 1] + ['...', stat[-1]]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
