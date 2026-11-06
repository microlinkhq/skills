import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const SETUP = join(SCRIPTS, 'setup.py')
const MUTATE = join(SCRIPTS, 'mutate.py')
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
echo "$(basename "$0") GH_HOST=\${GH_HOST:-} GITLAB_HOST=\${GITLAB_HOST:-} $*" >> "$FAKE_CLI_LOG"
case "$1 $2" in
  "pr view") cat "$FAKE_META" ;;
  "repo clone") git clone -q "$FAKE_CLONE_SRC" "$4" ;;
  "api --hostname") cat "$FAKE_META" ;;
  "pr checkout")
    git fetch -q "$FAKE_FORK_SRC" feat && git switch -q -C "$5" FETCH_HEAD &&
    git config "branch.$5.remote" "$FAKE_FORK_SRC" && git config "branch.$5.merge" refs/heads/feat ;;
  *) echo "fake $0: unexpected $*" >&2; exit 1 ;;
esac
`

const FAKE_PNPM = `#!/usr/bin/env bash
echo "$PWD" >> "$FAKE_PNPM_LOG"
[ -n "\${FAKE_PNPM_FAIL:-}" ] && { echo "ERR_PNPM boom"; echo "second line"; exit 1; }
[ -f pnpm-lock.yaml ] && echo rewritten >> pnpm-lock.yaml
mkdir -p node_modules && echo installed > node_modules/marker
`

const repositoryWithFeatureBranch = ({ host = 'github.com', slug = 'acme/app', kind = 'github', state, fork = false } = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'loop-review-')))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  for (const [name, body] of [['gh', FAKE_GH], ['glab', FAKE_GH], ['pnpm', FAKE_PNPM]]) {
    writeFileSync(join(bin, name), body)
    chmodSync(join(bin, name), 0o755)
  }
  const remote = join(root, 'remotes', host, `${slug}.git`)
  mkdirSync(remote, { recursive: true })
  const env = {
    ...process.env,
    ...GIT_ENV,
    PATH: `${bin}:${process.env.PATH}`,
    LOOP_REVIEW_CACHE: join(root, 'cache'),
    FAKE_META: join(root, 'meta.json'),
    FAKE_CLONE_SRC: remote,
    FAKE_PNPM_LOG: join(root, 'pnpm.log'),
    FAKE_CLI_LOG: join(root, 'cli.log')
  }
  const meta = kind === 'github'
    ? { state: state ?? 'OPEN', title: 'Add feat', headRefName: 'feat', headRefOid: 'x', baseRefName: 'main', isCrossRepository: fork, url: '' }
    : { state: state ?? 'opened', title: 'Add feat', source_branch: 'feat', sha: 'x', target_branch: 'main', source_project_id: 1, target_project_id: fork ? 2 : 1 }
  writeFileSync(env.FAKE_META, JSON.stringify(meta))
  const git = (cwd, script) => execFileSync('bash', ['-ec', script], { cwd, env, encoding: 'utf8' }).trim()
  git(root, `git init -q --bare -b main "${remote}"
    git clone -q "${remote}" seed && cd seed
    echo '{"name":"app","packageManager":"pnpm@9.0.0"}' > package.json
    printf 'export const allow = name => name !== "get"\\n' > index.js
    echo node_modules > .gitignore
    git add . && git commit -qm seed && git push -q origin main
    git switch -qc feat && echo feat > feat.txt && git add feat.txt && git commit -qm feat && git push -q origin feat`)
  const work = join(root, 'work')
  git(root, `git clone -q "${remote}" work`)
  const url = kind === 'github'
    ? `https://${host}/${slug}/pull/7`
    : `https://${host}/${slug}/-/merge_requests/7`
  const setup = (cwd = work, extra = {}) => {
    const result = spawnSync('python3', [SETUP, url], { cwd, env: { ...env, ...extra }, encoding: 'utf8' })
    const values = Object.fromEntries(
      result.stdout.split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      })
    )
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, ...values }
  }
  const pnpmRuns = () => (existsSync(env.FAKE_PNPM_LOG) ? readFileSync(env.FAKE_PNPM_LOG, 'utf8').trim().split('\n') : [])
  const pushRemote = script => git(join(root, 'seed'), `git switch -q feat && ${script} && git push -q origin feat`)
  const review = join(root, 'cache', host, slug, '7')
  return { root, work, env, git, setup, pnpmRuns, pushRemote, remote, review }
}

const dirtyFeatureTree = f => f.git(f.work, 'git switch -q feat && echo wip >> feat.txt')

test('the tree the feature was written in is reused in place, fast-forwarded and installed once', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat && mkdir node_modules')
  f.pushRemote('echo two > two.txt && git add two.txt && git commit -qm two')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.TREE_KIND, 'feature')
  assert.equal(out.TREE, f.work)
  assert.equal(out.BRANCH, 'feat')
  assert.equal(out.PUSH, 'git push origin HEAD:refs/heads/feat')
  assert.equal(out.PULL, 'git pull --rebase origin feat')
  assert.equal(out.UNPUSHED, '0')
  assert.equal(out.INSTALL, 'pnpm install', 'an unstamped node_modules is not trusted')
  assert.ok(existsSync(join(f.work, 'two.txt')), 'fast-forwarded to the remote head')
  assert.equal(f.git(f.work, 'git worktree list | wc -l'), '1', 'no worktree was added')
  assert.equal(f.setup().INSTALL, 'reused')
  assert.equal(f.pnpmRuns().length, 1)
})

test('a feature branch with no upstream is still reused, and PULL names the head branch', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q --no-track -c feat origin/feat')
  const out = f.setup()
  assert.equal(out.TREE_KIND, 'feature', out.stdout)
  assert.equal(out.PULL, 'git pull --rebase origin feat')
  assert.equal(f.git(f.work, 'git config branch.feat.merge || true'), '', 'its config is not rewritten')
})

test('a linked worktree on the head branch is found from any checkout of the repository', t => {
  const f = repositoryWithFeatureBranch()
  const linked = join(f.root, 'linked')
  f.git(f.work, `git worktree add -q "${linked}" feat`)
  const out = f.setup(f.work)
  assert.equal(out.TREE_KIND, 'feature', out.stdout)
  assert.equal(out.TREE, linked)
})

test('a dirty feature tree is left alone and the review gets its own tree, with node_modules cloned', t => {
  const f = repositoryWithFeatureBranch()
  dirtyFeatureTree(f)
  f.git(f.work, 'pnpm install >/dev/null && rm "$FAKE_PNPM_LOG"')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.TREE_KIND, 'review')
  assert.equal(out.BRANCH, 'loop-review/7')
  assert.equal(out.TREE, f.review)
  assert.equal(out.PUSH, 'git push origin HEAD:refs/heads/feat')
  assert.match(out.INSTALL, /^cloned from .*work, then pnpm install$/, 'an unstamped sibling is copied, then installed over')
  assert.ok(existsSync(join(out.TREE, 'node_modules', 'marker')))
  assert.equal(f.git(f.work, 'git branch --show-current'), 'feat')
  assert.equal(f.git(f.work, 'git status --porcelain'), 'M feat.txt', 'the uncommitted work is untouched')
})

test('a sibling installed for exactly these dependencies is cloned with no install', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat')
  assert.equal(f.setup().INSTALL, 'pnpm install')
  dirtyFeatureTree(f)
  const out = f.setup()
  assert.equal(out.TREE_KIND, 'review', out.stdout)
  assert.equal(out.INSTALL, `cloned from ${f.work}`)
  assert.equal(f.pnpmRuns().length, 1, 'only the first, stamped install ran')
})

test('a second run reuses the review tree, keeps its unpushed fixes and only fetches', t => {
  const f = repositoryWithFeatureBranch()
  dirtyFeatureTree(f)
  const first = f.setup()
  assert.equal(first.INSTALL, 'pnpm install', first.stdout)
  f.git(first.TREE, 'echo fix > fix.txt && git add fix.txt && git commit -qm fix')
  const second = f.setup()
  assert.equal(second.STATUS, 'ready', second.stdout)
  assert.equal(second.TREE_KIND, 'review')
  assert.equal(second.TREE, first.TREE)
  assert.equal(second.UNPUSHED, '1', 'a BLOCKED run\'s committed fixes are resumed, not refused')
  assert.equal(second.INSTALL, 'reused')
  assert.equal(f.pnpmRuns().length, 1)
})

test('a loop-review worktree outside the cache, from an older run, is reused where it is', t => {
  const f = repositoryWithFeatureBranch()
  const old = join(f.root, 'tmp-review')
  f.git(f.work, `git worktree add -q -b loop-review/7 "${old}" origin/feat`)
  f.git(old, 'echo fix > fix.txt && git add fix.txt && git commit -qm fix')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.TREE, old)
  assert.equal(out.TREE_KIND, 'review')
  assert.equal(out.UNPUSHED, '1')
  assert.ok(!existsSync(f.review))
})

test('a review tree behind the remote is fast-forwarded', t => {
  const f = repositoryWithFeatureBranch()
  dirtyFeatureTree(f)
  f.setup()
  f.pushRemote('echo two > two.txt && git add two.txt && git commit -qm two')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.ok(existsSync(join(out.TREE, 'two.txt')))
})

test('a review tree that diverged from the remote stops the run with the pull to run', t => {
  const f = repositoryWithFeatureBranch()
  dirtyFeatureTree(f)
  f.setup()
  f.git(f.review, 'echo fix > fix.txt && git add fix.txt && git commit -qm fix')
  f.pushRemote('echo two > two.txt && git add two.txt && git commit -qm two')
  const out = f.setup()
  assert.equal(out.STATUS, 'blocked')
  assert.match(out.REASON, /diverged .* run `git pull --rebase origin feat` there/)
})

test('a review tree in the middle of a rebase is reported as that, not as a stray directory', t => {
  const f = repositoryWithFeatureBranch()
  dirtyFeatureTree(f)
  f.setup()
  f.git(f.review, `echo a > feat.txt && git commit -qam a
    git branch -q other origin/feat && git switch -q other && echo b > feat.txt && git commit -qam b
    git switch -q loop-review/7 && ! git rebase -q other >/dev/null 2>&1`)
  const out = f.setup()
  assert.equal(out.STATUS, 'blocked')
  assert.match(out.REASON, /has a rebase-merge in progress: finish or abort it/)
})

test('local commits in the feature tree are never published: the review uses its own tree', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat && echo mine > mine.txt && git add mine.txt && git commit -qm mine')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.TREE_KIND, 'review')
  assert.ok(!existsSync(join(out.TREE, 'mine.txt')))
  assert.equal(out.UNPUSHED, '0')
})

test('a local head branch checked out nowhere is neither taken over nor retargeted', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git branch -q feat origin/feat && git config branch.feat.merge refs/heads/main')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.BRANCH, 'loop-review/7')
  assert.equal(f.git(f.work, 'git config branch.feat.merge'), 'refs/heads/main')
  f.git(f.work, 'git switch -q feat')
})

test('a loop-review branch whose worktree was removed gets its tree back with its commits', t => {
  const f = repositoryWithFeatureBranch()
  dirtyFeatureTree(f)
  f.setup()
  f.git(f.review, 'echo fix > fix.txt && git add fix.txt && git commit -qm fix')
  f.git(f.work, `git worktree remove "${f.review}"`)
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.UNPUSHED, '1')
  assert.ok(existsSync(join(out.TREE, 'fix.txt')))
})

test('a file a killed mutation left changed is restored before the tree is judged', t => {
  const f = repositoryWithFeatureBranch()
  dirtyFeatureTree(f)
  f.setup()
  f.git(f.review, 'echo mutated > index.js && mkdir -p "$(git rev-parse --git-path loop-review)" && echo index.js > "$(git rev-parse --git-path loop-review)/active-mutation"')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(f.git(f.review, 'git status --porcelain --untracked-files=no'), '')
})

test('a dependency change in any workspace package installs again', t => {
  const f = repositoryWithFeatureBranch()
  dirtyFeatureTree(f)
  f.setup()
  f.pushRemote(`mkdir -p packages/a && echo '{"name":"a"}' > packages/a/package.json && git add packages && git commit -qm pkg`)
  const out = f.setup()
  assert.equal(out.INSTALL, 'pnpm install', out.stdout)
  assert.equal(f.pnpmRuns().length, 2)
})

test('a lockfile the install rewrites is restored, so the tree stays clean', t => {
  const f = repositoryWithFeatureBranch()
  f.pushRemote('echo lock > pnpm-lock.yaml && git add pnpm-lock.yaml && git commit -qm lock')
  f.git(f.work, 'git switch -q feat')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.match(out.INSTALL, /restored pnpm-lock\.yaml/)
  assert.equal(f.git(f.work, 'git status --porcelain --untracked-files=no'), '')
  assert.equal(f.setup().INSTALL, 'reused')
})

test('a failed install is one REASON line with the log tail after it', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat')
  const out = f.setup(f.work, { FAKE_PNPM_FAIL: '1' })
  assert.equal(out.STATUS, 'blocked')
  assert.match(out.REASON, /^`pnpm install` exited 1, log .*install\.log$/)
  assert.match(out.stdout, /--- detail\nERR_PNPM boom\nsecond line/)
})

test('outside any clone of the repository, one cached clone is made and reused', t => {
  const f = repositoryWithFeatureBranch()
  const elsewhere = join(f.root, 'elsewhere')
  mkdirSync(elsewhere)
  const out = f.setup(elsewhere)
  assert.equal(out.STATUS, 'ready', out.stdout + out.stderr)
  assert.equal(out.TREE_KIND, 'review')
  assert.ok(existsSync(join(f.root, 'cache', 'github.com', 'acme', 'app', '_clone', '.git')))
  assert.match(readFileSync(f.env.FAKE_CLI_LOG, 'utf8'), /gh GH_HOST=github.com .*repo clone github.com\/acme\/app/)
  assert.equal(f.setup(elsewhere).TREE, out.TREE)
})

test('a self-hosted GitLab merge request in a nested group is read from its own host', t => {
  const f = repositoryWithFeatureBranch({ host: 'gitlab.example.com', slug: 'microlink/tools/app', kind: 'gitlab' })
  f.git(f.work, 'git switch -q feat')
  const out = f.setup()
  assert.equal(out.STATUS, 'ready', out.stdout)
  assert.equal(out.TREE_KIND, 'feature')
  assert.equal(out.PR, 'https://gitlab.example.com/microlink/tools/app/-/merge_requests/7')
  assert.match(readFileSync(f.env.FAKE_CLI_LOG, 'utf8'),
    /glab GH_HOST= GITLAB_HOST=gitlab.example.com api --hostname gitlab.example.com projects\/microlink%2Ftools%2Fapp\/merge_requests\/7/)
})

test('a GitHub fork pull request is checked out with gh and pushed to the fork', t => {
  const f = repositoryWithFeatureBranch({ fork: true })
  const fork = join(f.root, 'remotes', 'fork.git')
  f.git(f.root, `git clone -q --bare "${f.remote}" "${fork}"`)
  const out = f.setup(f.work, { FAKE_FORK_SRC: fork })
  assert.equal(out.STATUS, 'ready', out.stdout + out.stderr)
  assert.equal(out.TREE_KIND, 'review')
  assert.equal(out.PUSH, `git push ${fork} HEAD:refs/heads/feat`)
})

test('a GitLab fork merge request is refused with what to do instead', t => {
  const f = repositoryWithFeatureBranch({ host: 'gitlab.com', slug: 'microlink/app', kind: 'gitlab', fork: true })
  const out = f.setup()
  assert.equal(out.STATUS, 'blocked')
  assert.match(out.REASON, /fork/)
})

test('a closed pull request stops before touching any tree', t => {
  const f = repositoryWithFeatureBranch({ state: 'MERGED' })
  const out = f.setup()
  assert.equal(out.STATUS, 'blocked')
  assert.match(out.REASON, /is MERGED, not open/)
  assert.ok(!existsSync(f.review))
})

test('an input that is not a pull request is refused', t => {
  const f = repositoryWithFeatureBranch()
  const result = spawnSync('python3', [SETUP, 'https://github.com/acme/app'], { cwd: f.work, env: f.env, encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stdout, /REASON=.*is not a pull request URL/)
})

test('the diff stat is plain text even when git colors are forced on', t => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'git switch -q feat && git config color.ui always')
  const out = f.setup()
  assert.match(out.stdout, /--- diff stat\n feat\.txt \| 1 \+\n/)
  assert.doesNotMatch(out.stdout, /\x1b\[/)
})

test('remote URLs match the pull request host and path in every common spelling', t => {
  const locate = url => JSON.parse(execFileSync('python3', ['-c',
    `import json, sys; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); import setup; print(json.dumps(setup.remote_location(sys.argv[1])))`, url],
  { encoding: 'utf8' }))
  assert.deepEqual(locate('git@github.com:Acme/App.git'), ['github.com', 'acme/app'])
  assert.deepEqual(locate('https://token@github.com/acme/app'), ['github.com', 'acme/app'])
  assert.deepEqual(locate('ssh://git@gitlab.com:2222/microlink/tools/app.git'), ['gitlab.com', 'microlink/tools/app'])
  assert.deepEqual(locate('https://gitlab.example.com:8443/g/p.git'), ['gitlab.example.com', 'g/p'])
  assert.deepEqual(locate('/srv/git/github.com/acme/app.git'), [null, '/srv/git/github.com/acme/app'])
})

test('run.sh prints one line on success and the tail on failure, keeping the exit code', t => {
  const f = repositoryWithFeatureBranch()
  const logs = join(f.root, 'logs')
  const env = { ...f.env, LOOP_REVIEW_LOGS: logs, LOOP_REVIEW_TAIL: '2' }
  const pass = spawnSync(RUN, ['unit', 'bash', '-c', 'seq 1 500'], { cwd: f.work, env, encoding: 'utf8' })
  assert.equal(pass.status, 0)
  assert.match(pass.stdout, /^PASS unit \(\d+s\) log=.*unit\.log\n$/)
  assert.equal(readFileSync(join(logs, 'unit.log'), 'utf8').split('\n').length, 501)
  const fail = spawnSync(RUN, ['unit test', 'bash', '-c', 'seq 1 500; exit 3'], { cwd: f.work, env, encoding: 'utf8' })
  assert.equal(fail.status, 3)
  assert.deepEqual(fail.stdout.trim().split('\n').slice(1), ['499', '500'])
  assert.match(fail.stdout, /^FAIL unit test exit=3/)
})

test('run.sh stops a command at the time limit', t => {
  const f = repositoryWithFeatureBranch()
  const env = { ...f.env, LOOP_REVIEW_LOGS: join(f.root, 'logs'), LOOP_REVIEW_TIMEOUT: '1' }
  const hang = spawnSync(RUN, ['hang', 'sleep', '30'], { cwd: f.work, env, encoding: 'utf8', timeout: 15000 })
  assert.equal(hang.status, 124)
  assert.match(hang.stdout, /^FAIL hang timed out after 1s/)
  assert.equal(hang.stderr, '')
})

const ALLOW_GET = `node -e "import('./index.js').then(m => process.exit(m.allow('get') ? 1 : 0))"`

const mutateIn = (f, spec, extra = {}) =>
  spawnSync('python3', [MUTATE, '-'], { cwd: f.work, env: { ...f.env, ...extra }, input: spec, encoding: 'utf8' })

const esmRepository = () => {
  const f = repositoryWithFeatureBranch()
  f.git(f.work, 'echo \'{"type":"module"}\' > package.json && git commit -qam esm')
  return f
}

test('mutate.py reports caught, survived and skipped mutations and restores every file', t => {
  const f = esmRepository()
  const before = readFileSync(join(f.work, 'index.js'), 'utf8')
  const result = mutateIn(f, [
    `index.js\t1\t!== "get"\t=== "get"\t${ALLOW_GET}`,
    'index.js\t1\t"get"\t"set"\ttrue',
    'index.js\t9\tnothing\there\ttrue'
  ].join('\n'))
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const rows = result.stdout.trimEnd().split('\n')
  assert.match(rows[0], /^ {2}1 CAUGHT {3}index\.js:1/)
  assert.match(rows[1], /^ {2}2 SURVIVED index\.js:1/)
  assert.match(rows[2], /^ {2}3 SKIPPED {2}index\.js:9/)
  assert.equal(rows[3], '1/3 caught')
  assert.equal(readFileSync(join(f.work, 'index.js'), 'utf8'), before)
})

test('mutate.py refuses a command that already fails on the unmutated tree', t => {
  const f = esmRepository()
  const result = mutateIn(f, 'index.js\t1\t!== "get"\t=== "get"\tnode --test does/not/exist.js')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /fails before any mutation/)
  assert.equal(result.stdout, '')
})

test('mutate.py counts a test that hangs under a mutation as caught', t => {
  const f = esmRepository()
  const hangs = `node -e "import('./index.js').then(m => m.allow('get') ? setInterval(() => {}, 1000) : process.exit(0))"`
  const result = mutateIn(f, `index.js\t1\t!== "get"\t=== "get"\t${hangs}`, { LOOP_REVIEW_TIMEOUT: '2' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /CAUGHT {3}index\.js:1 .*timed out/)
})

test('mutate.py refuses untracked files, line 0 and a no-op replacement before changing anything', t => {
  const f = esmRepository()
  f.git(f.work, 'echo "x = 1" > new.py')
  for (const spec of ['new.py\t1\t1\t2\ttrue', 'index.js\t0\tget\tset\ttrue', 'index.js\t1\tget\tget\ttrue']) {
    const result = mutateIn(f, spec)
    assert.equal(result.status, 2, spec)
  }
  assert.equal(readFileSync(join(f.work, 'new.py'), 'utf8'), 'x = 1\n')
})

test('mutate.py refuses to run over uncommitted changes', t => {
  const f = esmRepository()
  f.git(f.work, 'echo change >> index.js')
  const result = mutateIn(f, 'index.js\t1\tget\tset\ttrue')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /commit or restore tracked changes first/)
  assert.match(readFileSync(join(f.work, 'index.js'), 'utf8'), /change/)
})

test('mutate.py leaves a file someone edited during the run alone and stops', t => {
  const f = esmRepository()
  const result = mutateIn(f, `index.js\t1\t"get"\t"set"\tgrep -q '"set"' index.js && echo '// mine' >> index.js; true`)
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stderr, /changed while row 1 ran; it was not restored/)
  assert.match(readFileSync(join(f.work, 'index.js'), 'utf8'), /\/\/ mine/)
})

test('mutate.py undoes a mutation an interrupted run left behind', t => {
  const f = esmRepository()
  f.git(f.work, 'echo broken > index.js && mkdir -p .git/loop-review && echo index.js > .git/loop-review/active-mutation')
  const result = mutateIn(f, `index.js\t1\t!== "get"\t=== "get"\t${ALLOW_GET}`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /^restored index\.js, which an interrupted run left mutated/)
})
