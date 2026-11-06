import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
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
[ -n "\${FAKE_PNPM_FAIL:-}" ] && { echo "ERR_PNPM boom"; exit 1; }
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
  const pnpmRuns = () => (existsSync(env.FAKE_PNPM_LOG) ? readFileSync(env.FAKE_PNPM_LOG, 'utf8').trim().split('\n') : [])
  const pushRemote = script => git(join(root, 'seed'), `git switch -q feat && ${script} && git push -q origin feat`)
  const review = join(root, 'cache', host, slug, '7')
  return { root, work, env, git, setup, pnpmRuns, pushRemote, review }
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
