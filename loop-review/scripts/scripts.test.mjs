import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const SETUP = join(SCRIPTS, 'setup.py')
const RUN = join(SCRIPTS, 'run.sh')

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1'
}

const FAKE_GH = `#!/usr/bin/env bash
case "$1 $2" in
  "pr view"|"api "*) cat "$FAKE_META" ;;
  "repo clone") git clone -q "$FAKE_CLONE_SRC" "$4" ;;
  "") exit 64 ;;
  ?*) exit 1 ;;
esac
`

const FAKE_PNPM = `#!/usr/bin/env bash
echo "$PWD" >> "$FAKE_PNPM_LOG"
echo "$* node=$(node --version 2>/dev/null)" >> "$FAKE_PNPM_LOG.args"
[ -n "\${FAKE_PNPM_FAIL:-}" ] && { echo "ERR_PNPM boom"; exit 1; }
grep -q foreign node_modules/.modules.yaml 2>/dev/null && [[ " $* " != *" --config.confirmModulesPurge=false "* ]] && { echo "ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY"; exit 1; }
[ -n "\${CI:-}" ] && [ ! -f pnpm-lock.yaml ] && { echo "ERR_PNPM_NO_LOCKFILE"; exit 1; }
[ -t 0 ] && { echo "stdin is a terminal"; exit 1; }
mkdir -p node_modules && echo pnpm > node_modules/.modules.yaml
`

const repositoryWithFeatureBranch = ({ kind = 'github', slug = 'acme/app', state, fork = false } = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'loop-review-')))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  for (const [name, body] of [['gh', FAKE_GH], ['glab', FAKE_GH], ['pnpm', FAKE_PNPM]]) {
    writeFileSync(join(bin, name), body)
    chmodSync(join(bin, name), 0o755)
  }
  const host = `${kind}.com`
  const remote = join(root, 'remotes', host, `${slug}.git`)
  mkdirSync(remote, { recursive: true })
  const env = {
    ...process.env,
    ...GIT_ENV,
    PATH: `${bin}:${process.env.PATH}`,
    LOOP_REVIEW_CACHE: join(root, 'cache'),
    HOME: join(root, 'home'),
    NVM_DIR: join(root, 'home', '.nvm'),
    FAKE_META: join(root, 'meta.json'),
    FAKE_CLONE_SRC: remote,
    FAKE_PNPM_LOG: join(root, 'pnpm.log')
  }
  const meta = kind === 'github'
    ? { state: state ?? 'OPEN', title: 'Add feat', headRefName: 'feat', baseRefName: 'main', isCrossRepository: fork }
    : { state: state ?? 'opened', title: 'Add feat', source_branch: 'feat', target_branch: 'main', source_project_id: 1, target_project_id: fork ? 2 : 1 }
  writeFileSync(env.FAKE_META, JSON.stringify(meta))
  const git = (cwd, script) => execFileSync('bash', ['-ec', script], { cwd, env, encoding: 'utf8' }).trim()
  git(root, `git init -q --bare -b main "${remote}"
    git clone -q "${remote}" seed && cd seed
    echo '{"name":"app","packageManager":"pnpm@9.0.0"}' > package.json
    echo node_modules > .gitignore
    git add . && git commit -qm seed && git push -q origin main
    git switch -qc feat && echo feat > feat.txt && git add feat.txt && git commit -qm feat && git push -q origin feat
    git switch -q main`)
  const work = join(root, 'work')
  git(root, `git clone -q "${remote}" work`)
  const url = kind === 'github' ? `https://github.com/${slug}/pull/7` : `https://gitlab.com/${slug}/-/merge_requests/7`
  const setup = (cwd = work, extra = {}) => {
    const result = spawnSync('python3', [SETUP, url], { cwd, env: { ...env, ...extra }, encoding: 'utf8' })
    const values = Object.fromEntries(
      result.stdout.split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      })
    )
    return { status: result.status, stdout: result.stdout, ...values }
  }
  const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : [])
  const pnpmRuns = () => lines(env.FAKE_PNPM_LOG)
  const pnpmArgs = () => lines(`${env.FAKE_PNPM_LOG}.args`)
  const pushRemote = script => git(join(root, 'seed'), `git switch -q feat && ${script} && git push -q origin feat`)
  const review = join(root, 'cache', host, slug, '7')
  return { root, work, env, git, setup, pnpmRuns, pnpmArgs, pushRemote, review }
}

const installed = (f, tree) => f.git(tree, 'mkdir -p node_modules && sleep 1 && echo pnpm > node_modules/.modules.yaml')

test('the worktree the feature was written in is reviewed in place, with no clone and no install', t => {
  const f = repositoryWithFeatureBranch()
  const feature = join(f.root, 'workspaces', 'feature')
  f.git(f.work, `git worktree add -q "${feature}" feat`)
  installed(f, feature)
  f.pushRemote('echo two > two.txt && git add two.txt && git commit -qm two')
  const out = f.setup(f.work)
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.TREE, feature)
  assert.equal(out.TREE_KIND, 'feature')
  assert.equal(out.BRANCH, 'feat')
  assert.equal(out.PUSH, 'git push origin HEAD:refs/heads/feat')
  assert.equal(out.PULL, 'git pull --rebase origin feat')
  assert.equal(out.UNPUSHED, '0')
  assert.equal(out.INSTALL, 'reused')
  assert.ok(existsSync(join(feature, 'two.txt')), 'fast-forwarded to the remote head')
  assert.deepEqual(f.pnpmRuns(), [])
  assert.ok(!existsSync(join(f.root, 'cache')), 'no clone and no review tree')
})

test('the main checkout counts as the feature tree when it is on the head branch', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat')
  const out = f.setup()
  assert.equal(out.TREE, f.work, out.stdout)
  assert.equal(out.TREE_KIND, 'feature')
  assert.equal(out.INSTALL, 'pnpm install', 'a missing node_modules is installed')
  assert.equal(f.setup().INSTALL, 'reused')
  assert.equal(f.pnpmRuns().length, 1)
})

test('a feature tree with uncommitted changes is left alone; the review gets its own tree with node_modules copied', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat && echo wip >> feat.txt')
  installed(f, f.work)
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.TREE, f.review)
  assert.equal(out.TREE_KIND, 'review')
  assert.equal(out.BRANCH, 'loop-review/7')
  assert.equal(out.PUSH, 'git push origin HEAD:refs/heads/feat')
  assert.match(out.INSTALL, /^copied from .*work, then pnpm install$/)
  assert.equal(f.git(f.work, 'git status --porcelain'), 'M feat.txt')
  assert.equal(f.git(f.work, 'git branch --show-current'), 'feat')
})

test('a feature tree with unpushed commits is never published: the review gets its own tree', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat && echo mine > mine.txt && git add mine.txt && git commit -qm mine')
  const out = f.setup()
  assert.equal(out.TREE_KIND, 'review', out.stdout)
  assert.ok(!existsSync(join(out.TREE, 'mine.txt')))
})

test('a second run reuses the review tree, keeps its unpushed fixes and does not install again', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat && echo wip >> feat.txt')
  const first = f.setup()
  f.git(first.TREE, 'echo fix > fix.txt && git add fix.txt && git commit -qm fix')
  f.pushRemote('true')
  const second = f.setup()
  assert.equal(second.STATUS, 'ready', second.stdout)
  assert.equal(second.TREE, first.TREE)
  assert.equal(second.UNPUSHED, '1')
  assert.equal(second.INSTALL, 'reused')
  assert.equal(f.pnpmRuns().length, 1)
})

test('a review tree an older run left anywhere is reused where it is', t => {
  const f = repositoryWithFeatureBranch()
  const old = join(f.root, 'tmp-review')
  f.git(f.work, `git worktree add -q -b loop-review/7 "${old}" origin/feat`)
  const out = f.setup()
  assert.equal(out.TREE, old, out.stdout)
  assert.equal(out.TREE_KIND, 'review')
})

test('a review tree that diverged from the remote stops with the pull to run', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat && echo wip >> feat.txt')
  f.setup()
  f.git(f.review, 'echo fix > fix.txt && git add fix.txt && git commit -qm fix')
  f.pushRemote('echo two > two.txt && git add two.txt && git commit -qm two')
  const out = f.setup()
  assert.equal(out.STATUS, 'blocked')
  assert.match(out.REASON, /diverged: run `git pull --rebase origin feat` there/)
})

test('a lockfile-free pnpm repository installs, even when the agent runs with CI set', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat')
  const out = f.setup(f.work, { CI: '1' })
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.INSTALL, 'pnpm install')
})

test('a dependency change installs again', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat')
  f.setup()
  f.pushRemote(`mkdir -p packages/a && echo '{"name":"a"}' > packages/a/package.json && git add packages && git commit -qm pkg`)
  assert.equal(f.setup().INSTALL, 'pnpm install')
  assert.equal(f.pnpmRuns().length, 2)
})

test('a failed install is one REASON line with the log tail after it', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat')
  const out = f.setup(f.work, { FAKE_PNPM_FAIL: '1' })
  assert.equal(out.STATUS, 'blocked')
  assert.match(out.REASON, /^`pnpm install` exited 1, log .*install\.log$/)
  assert.match(out.stdout, /--- detail\nERR_PNPM boom/)
})

test('outside a clone of the repository, one cached clone is made and reused', t => {
  const f = repositoryWithFeatureBranch()
  const elsewhere = join(f.root, 'elsewhere')
  mkdirSync(elsewhere)
  const out = f.setup(elsewhere)
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.ok(existsSync(join(f.root, 'cache', 'github.com', 'acme', 'app', '_clone', '.git')))
  assert.equal(f.setup(elsewhere).TREE, out.TREE)
})

test('a GitLab merge request in a nested group is read through glab', t => {
  const f = repositoryWithFeatureBranch({ kind: 'gitlab', slug: 'microlink/tools/app' })
  f.git(f.work, 'git switch -q feat')
  const out = f.setup()
  assert.equal(out.TREE_KIND, 'feature', out.stdout)
  assert.equal(out.PR, 'https://gitlab.com/microlink/tools/app/-/merge_requests/7')
})

test('a closed or forked pull request, or something that is not one, stops before touching any tree', t => {
  const closed = repositoryWithFeatureBranch({ state: 'MERGED' }).setup()
  assert.match(closed.REASON, /is MERGED, not open/)
  const fork = repositoryWithFeatureBranch({ fork: true }).setup()
  assert.match(fork.REASON, /fork/)
  const f = repositoryWithFeatureBranch()
  const bad = spawnSync('python3', [SETUP, 'https://github.com/acme/app'], { cwd: f.work, env: f.env, encoding: 'utf8' })
  assert.equal(bad.status, 2)
  assert.match(bad.stdout, /is not a pull request URL/)
  assert.ok(!existsSync(f.review))
})

test('run.sh prints one line on success and the tail on failure, keeping the exit code', t => {
  const f = repositoryWithFeatureBranch()
  const env = { ...f.env, LOOP_REVIEW_LOGS: join(f.root, 'logs'), LOOP_REVIEW_TAIL: '2' }
  const pass = spawnSync(RUN, ['unit', 'bash', '-c', 'seq 1 500'], { cwd: f.work, env, encoding: 'utf8' })
  assert.equal(pass.status, 0)
  assert.match(pass.stdout, /^PASS unit \(\d+s\) log=.*unit\.log\n$/)
  const fail = spawnSync(RUN, ['unit', 'bash', '-c', 'seq 1 500; exit 3'], { cwd: f.work, env, encoding: 'utf8' })
  assert.equal(fail.status, 3)
  assert.deepEqual(fail.stdout.trim().split('\n').slice(1), ['499', '500'])
})

test('run.sh stops a command at the time limit', t => {
  const f = repositoryWithFeatureBranch()
  const env = { ...f.env, LOOP_REVIEW_LOGS: join(f.root, 'logs'), LOOP_REVIEW_TIMEOUT: '1' }
  const hang = spawnSync(RUN, ['hang', 'sleep', '30'], { cwd: f.work, env, encoding: 'utf8', timeout: 15000 })
  assert.equal(hang.status, 124)
  assert.match(hang.stdout, /^FAIL hang timed out after 1s/)
})

const fakeNode = (dir, version) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'node'), `#!/usr/bin/env bash\necho ${version}\n`)
  chmodSync(join(dir, 'node'), 0o755)
  return dir
}

test('a node_modules linked to another tree is reused while the manifests match, and never installed through', t => {
  const f = repositoryWithFeatureBranch()
  const feature = join(f.root, 'workspaces', 'feature')
  f.git(f.work, `git worktree add -q "${feature}" feat`)
  installed(f, f.work)
  symlinkSync(join(f.work, 'node_modules'), join(feature, 'node_modules'))
  const linked = f.setup(f.work)
  assert.equal(linked.TREE, feature, linked.stdout)
  assert.equal(linked.INSTALL, `linked to ${join(f.work, 'node_modules')}`)
  assert.deepEqual(f.pnpmRuns(), [])
  assert.ok(!existsSync(join(f.work, 'node_modules', '.loop-review-deps')), 'no stamp written into the shared node_modules')

  f.pushRemote(`echo '{"name":"app","packageManager":"pnpm@9.0.0","dependencies":{"x":"1"}}' > package.json && git commit -qam deps`)
  const own = f.setup(f.work)
  assert.equal(own.STATUS, 'ready', own.stdout)
  assert.match(own.INSTALL, /^copied from .*work, then pnpm install$/)
  assert.deepEqual(f.pnpmRuns(), [feature])
  assert.ok(!lstatSync(join(feature, 'node_modules')).isSymbolicLink(), 'the tree got its own node_modules')
  assert.equal(readFileSync(join(f.work, 'node_modules', '.modules.yaml'), 'utf8'), 'pnpm\n', 'the shared node_modules is untouched')
})

test('a sibling node_modules whose pnpm store lives outside it is not copied', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat && echo wip >> feat.txt')
  installed(f, f.work)
  writeFileSync(join(f.work, 'node_modules', '.modules.yaml'), JSON.stringify({ virtualStoreDir: '../../elsewhere/node_modules/.pnpm' }))
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.TREE_KIND, 'review')
  assert.equal(out.INSTALL, 'pnpm install')
})

test('pnpm rebuilds a node_modules laid out with other settings without asking for a terminal', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat && mkdir -p node_modules && echo foreign > node_modules/.modules.yaml && echo old > node_modules/.loop-review-deps')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.INSTALL, 'pnpm install')
  assert.match(f.pnpmArgs()[0], /^install --config\.confirmModulesPurge=false /)
})

test('the node major package.json pins is used for the install and by run.sh, when PATH has another one', t => {
  const f = repositoryWithFeatureBranch()
  const nPrefix = join(f.root, 'n')
  const pinned = fakeNode(join(nPrefix, 'n', 'versions', 'node', '9.1.0', 'bin'), 'v9.1.0')
  const path = `${fakeNode(join(f.root, 'path-node'), 'v26.7.0')}:${f.env.PATH}`
  f.git(f.work, 'git switch -q feat')
  f.pushRemote(`echo '{"name":"app","packageManager":"pnpm@9.0.0","engines":{"node":"9"}}' > package.json && git commit -qam engines`)
  const out = f.setup(f.work, { PATH: path, N_PREFIX: nPrefix })
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.NODE, `v9.1.0 from ${pinned}`)
  assert.match(f.pnpmArgs()[0], /node=v9\.1\.0$/)
  const env = { ...f.env, PATH: path }
  const run = spawnSync(RUN, ['node', 'node', '--version'], { cwd: f.work, env, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stdout)
  assert.equal(readFileSync(run.stdout.match(/log=(\S+)/)[1], 'utf8').trim(), 'v9.1.0')

  f.pushRemote(`echo '{"name":"app","packageManager":"pnpm@9.0.0"}' > package.json && git commit -qam unpin`)
  assert.equal(f.setup(f.work, { PATH: path, N_PREFIX: nPrefix }).NODE, 'v26.7.0')
  const unpinned = spawnSync(RUN, ['node', 'node', '--version'], { cwd: f.work, env, encoding: 'utf8' })
  assert.equal(readFileSync(unpinned.stdout.match(/log=(\S+)/)[1], 'utf8').trim(), 'v26.7.0')
})

test('a pinned node major that is not installed is reported, and the install still runs', t => {
  const f = repositoryWithFeatureBranch()
  const path = `${fakeNode(join(f.root, 'path-node'), 'v26.7.0')}:${f.env.PATH}`
  f.git(f.work, 'git switch -q feat')
  f.pushRemote(`echo '{"name":"app","packageManager":"pnpm@9.0.0","engines":{"node":"^5"}}' > package.json && git commit -qam engines`)
  const out = f.setup(f.work, { PATH: path, N_PREFIX: join(f.root, 'none'), HOME: join(f.root, 'home') })
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.NODE, 'v26.7.0, but package.json wants 5 and no node 5 is installed')
  assert.equal(out.INSTALL, 'pnpm install')
})

test('a linked node_modules is replaced when its owner was not installed for these manifests, is inside the tree, or the repo has workspace packages', t => {
  const cases = {
    stale: f => {
      installed(f, f.work)
      f.git(f.work, 'sleep 1 && touch package.json')
      return join(f.work, 'node_modules')
    },
    inside: (f, feature) => {
      f.git(feature, 'mkdir -p nm_real && echo pnpm > nm_real/.modules.yaml')
      return join(feature, 'nm_real')
    },
    workspace: f => {
      f.pushRemote(`mkdir -p packages/a && echo '{"name":"a"}' > packages/a/package.json && git add packages && git commit -qm pkg`)
      f.git(f.work, 'git fetch -q origin && git checkout -q origin/feat -- packages')
      installed(f, f.work)
      return join(f.work, 'node_modules')
    }
  }
  for (const [name, arrange] of Object.entries(cases)) {
    const f = repositoryWithFeatureBranch()
    const feature = join(f.root, 'workspaces', 'feature')
    f.git(f.work, `git worktree add -q "${feature}" feat`)
    const target = arrange(f, feature)
    symlinkSync(target, join(feature, 'node_modules'))
    const out = f.setup(f.work)
    assert.equal(out.STATUS, 'ready', `${name}: ${out.stdout}`)
    assert.doesNotMatch(out.INSTALL, /^linked/, name)
    assert.equal(out.TREE, feature, `${name}: ${out.stdout}`)
    assert.ok(!lstatSync(join(feature, 'node_modules')).isSymbolicLink(), `${name}: the tree got its own node_modules`)
    assert.ok(existsSync(join(target, '.modules.yaml')), `${name}: the link target is untouched`)
  }
})

test('a node pin that cannot be met clears the node run.sh used for the previous pin', t => {
  const f = repositoryWithFeatureBranch()
  const nPrefix = join(f.root, 'n')
  fakeNode(join(nPrefix, 'n', 'versions', 'node', '9.1.0', 'bin'), 'v9.1.0')
  const path = `${fakeNode(join(f.root, 'path-node'), 'v26.7.0')}:${f.env.PATH}`
  f.git(f.work, 'git switch -q feat')
  f.pushRemote(`echo '{"name":"app","packageManager":"pnpm@9.0.0","engines":{"node":"9"}}' > package.json && git commit -qam pin`)
  assert.match(f.setup(f.work, { PATH: path, N_PREFIX: nPrefix }).NODE, /^v9\.1\.0 from /)
  f.pushRemote(`echo '{"name":"app","packageManager":"pnpm@9.0.0","engines":{"node":"5"}}' > package.json && git commit -qam repin`)
  assert.match(f.setup(f.work, { PATH: path, N_PREFIX: nPrefix, HOME: join(f.root, 'home') }).NODE, /no node 5 is installed$/)
  const env = { ...f.env, PATH: path }
  const run = spawnSync(RUN, ['node', 'node', '--version'], { cwd: f.work, env, encoding: 'utf8' })
  assert.equal(readFileSync(run.stdout.match(/log=(\S+)/)[1], 'utf8').trim(), 'v26.7.0')
})

test('run.sh finds the pinned node even when its logs go elsewhere', t => {
  const f = repositoryWithFeatureBranch()
  const nPrefix = join(f.root, 'n')
  fakeNode(join(nPrefix, 'n', 'versions', 'node', '9.1.0', 'bin'), 'v9.1.0')
  const path = `${fakeNode(join(f.root, 'path-node'), 'v26.7.0')}:${f.env.PATH}`
  f.git(f.work, 'git switch -q feat')
  f.pushRemote(`echo '{"name":"app","packageManager":"pnpm@9.0.0","engines":{"node":"9"}}' > package.json && git commit -qam pin`)
  f.setup(f.work, { PATH: path, N_PREFIX: nPrefix })
  const env = { ...f.env, PATH: path, LOOP_REVIEW_LOGS: join(f.root, 'elsewhere-logs') }
  const run = spawnSync(RUN, ['node', 'node', '--version'], { cwd: join(f.work), env, encoding: 'utf8' })
  assert.equal(readFileSync(run.stdout.match(/log=(\S+)/)[1], 'utf8').trim(), 'v9.1.0')
})

test('a node_modules built for another node major is installed again once the pinned node is there', t => {
  const f = repositoryWithFeatureBranch()
  const nPrefix = join(f.root, 'n')
  const path = `${fakeNode(join(f.root, 'path-node'), 'v26.7.0')}:${f.env.PATH}`
  const env = { PATH: path, N_PREFIX: nPrefix }
  f.git(f.work, 'git switch -q feat')
  f.pushRemote(`echo '{"name":"app","packageManager":"pnpm@9.0.0","engines":{"node":"9"}}' > package.json && git commit -qam pin`)
  assert.match(f.setup(f.work, env).NODE, /no node 9 is installed$/)
  assert.match(f.pnpmArgs().at(-1), /node=v26\.7\.0$/)
  fakeNode(join(nPrefix, 'n', 'versions', 'node', '9.1.0', 'bin'), 'v9.1.0')
  assert.equal(f.setup(f.work, env).INSTALL, 'pnpm install')
  assert.match(f.pnpmArgs().at(-1), /node=v9\.1\.0$/)
  assert.equal(f.setup(f.work, env).INSTALL, 'reused', 'the same node keeps the install')
})

test('a linked node_modules is not reused while a pinned node other than PATH\'s is in use', t => {
  const f = repositoryWithFeatureBranch()
  const nPrefix = join(f.root, 'n')
  fakeNode(join(nPrefix, 'n', 'versions', 'node', '9.1.0', 'bin'), 'v9.1.0')
  const env = { PATH: `${fakeNode(join(f.root, 'path-node'), 'v26.7.0')}:${f.env.PATH}`, N_PREFIX: nPrefix }
  f.pushRemote(`echo '{"name":"app","packageManager":"pnpm@9.0.0","engines":{"node":"9"}}' > package.json && git commit -qam pin`)
  const feature = join(f.root, 'workspaces', 'feature')
  f.git(f.work, `git fetch -q origin && git worktree add -q -b feat "${feature}" origin/feat && git checkout -q origin/feat -- package.json`)
  installed(f, f.work)
  symlinkSync(join(f.work, 'node_modules'), join(feature, 'node_modules'))
  const out = f.setup(f.work, env)
  assert.equal(out.TREE, feature, out.stdout)
  assert.doesNotMatch(out.INSTALL, /^linked/)
  assert.ok(!lstatSync(join(feature, 'node_modules')).isSymbolicLink())
  assert.equal(f.setup(f.work, env).INSTALL, 'reused', 'its own install stays')
})
