import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import {
  branchName,
  collect,
  collectionFailures,
  dedupeKey,
  mergeClones,
  isGitLab,
  isNoise,
  parseArgs,
  pullRequestNumber,
  resolveReviews,
  toMarkdown,
  webUrl
} from './collect.mjs'
import { checkLinks, probeUrl } from './check-links.mjs'
import { upload } from './upload.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = readdirSync(HERE).filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs')).sort()
const ME = 'Weekly Tester'
const MY_EMAIL = 'me+work@example.com'
const SOMEONE_ELSE = 'Someone Else'
const range = { since: '2026-11-10', until: '2026-11-17', authors: [ME] }

const withTempDir = async run => {
  const dir = mkdtempSync(path.join(tmpdir(), 'weekly-summary-'))
  try {
    return await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const makeRepo = (root, name, remote, defaultBranch = 'main') => {
  const repo = path.join(root, name)
  mkdirSync(repo)
  const run = (args, env = {}) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } }).trim()
  run(['init', '-q', '-b', defaultBranch])
  run(['config', 'commit.gpgsign', 'false'])
  run(['config', 'user.name', ME])
  run(['config', 'user.email', MY_EMAIL])
  run(['remote', 'add', 'origin', remote])

  const commit = (subject, date, { author = ME, keepStaged = false, file = 'file.txt', stamp = `${date}T12:00:00Z` } = {}) => {
    if (!keepStaged) {
      writeFileSync(path.join(repo, file), `${subject}\n`)
      run(['add', file])
    }
    run(['commit', '-q', '-m', subject], {
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: author === ME ? MY_EMAIL : 'else@example.com',
      GIT_COMMITTER_NAME: author,
      GIT_COMMITTER_EMAIL: author === ME ? MY_EMAIL : 'else@example.com',
      GIT_AUTHOR_DATE: stamp,
      GIT_COMMITTER_DATE: stamp
    })
  }
  const push = branch => {
    run(['update-ref', `refs/remotes/origin/${branch}`, `refs/heads/${branch}`])
    if (branch === defaultBranch) run(['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${defaultBranch}`])
  }
  const squashInto = (branch, subject, date) => {
    run(['switch', '-q', defaultBranch])
    run(['merge', '-q', '--squash', branch])
    commit(subject, date, { keepStaged: true })
    push(defaultBranch)
  }
  return { repo, run, commit, push, squashInto }
}

const seedWorkspace = root => {
  const api = makeRepo(root, 'api', 'git@github.com:acme/api.git')
  api.commit('feat: before the week', '2026-11-09')
  api.commit('feat: cache values with brotli (#12)', '2026-11-11')
  api.commit('chore(release): 1.2.0', '2026-11-11')
  api.commit('build(deps): bump left-pad', '2026-11-12')
  api.commit('fix: someone else', '2026-11-12', { author: SOMEONE_ELSE })
  api.commit('feat: on the meeting day', '2026-11-17')
  api.push('main')
  api.run(['switch', '-q', '-c', 'me/monitor', 'HEAD~1'])
  api.commit('feat: metadata monitor', '2026-11-14', { file: 'monitor.txt' })
  api.push('me/monitor')
  api.run(['switch', '-q', 'main'])

  const quiet = makeRepo(root, 'quiet', 'https://github.com/acme/quiet.git')
  quiet.commit('feat: long ago', '2026-01-01')
  quiet.push('main')

  mkdirSync(path.join(root, 'not-a-repo'))
  return api
}

const subjectsWithState = repo => repo.commits.map(commit => [commit.subject, commit.merged, commit.unpushed])

test('collect keeps my commits in range and drops noise, other authors and repos without work', () =>
  withTempDir(root => {
    seedWorkspace(root)
    const repos = collect({ root, ...range })
    assert.deepEqual(repos.map(repo => repo.name), ['api'])
    assert.equal(repos[0].url, 'https://github.com/acme/api')
    assert.deepEqual(subjectsWithState(repos[0]), [
      ['feat: cache values with brotli (#12)', true, false],
      ['feat: metadata monitor', false, false]
    ])
  }))

test('collect names the pushed branch of unmerged work and links pull requests', () =>
  withTempDir(root => {
    seedWorkspace(root)
    const [merged, unmerged] = collect({ root, ...range })[0].commits
    assert.equal(merged.review, 'https://github.com/acme/api/pull/12')
    assert.deepEqual(unmerged.branches, ['me/monitor'])
    assert.equal(unmerged.review, null)
  }))

test('a commit on local main that was never pushed is unpushed, not merged', () =>
  withTempDir(root => {
    const api = seedWorkspace(root)
    api.commit('feat: local only', '2026-11-15')
    const commit = collect({ root, ...range })[0].commits.find(item => item.subject === 'feat: local only')
    assert.deepEqual([commit.merged, commit.unpushed, commit.branches], [false, true, ['main']])
  }))

test('stashes and refs outside branches and origin are ignored', () =>
  withTempDir(root => {
    const api = seedWorkspace(root)
    writeFileSync(path.join(api.repo, 'file.txt'), 'dirty\n')
    api.run(['stash', '-q'], { GIT_COMMITTER_DATE: '2026-11-15T12:00:00Z', GIT_AUTHOR_DATE: '2026-11-15T12:00:00Z' })
    api.run(['switch', '-q', '-c', 'scratch'])
    api.commit('feat: on a tool ref only', '2026-11-15')
    api.run(['update-ref', 'refs/orca/pull/1', 'HEAD'])
    api.run(['switch', '-q', 'main'])
    api.run(['branch', '-q', '-D', 'scratch'])
    const subjects = collect({ root, ...range })[0].commits.map(commit => commit.subject)
    assert.ok(!subjects.some(subject => /WIP on|index on|tool ref/.test(subject)), subjects.join(', '))
  }))

test('a squash-merged branch counts as merged and shows once, with its request number', () =>
  withTempDir(root => {
    const repo = makeRepo(root, 'api', 'git@gitlab.com:acme/api.git')
    repo.commit('feat: base', '2026-11-09')
    repo.push('main')
    repo.run(['switch', '-q', '-c', 'me/steps'])
    repo.commit('fix: first step', '2026-11-11')
    repo.commit('fix: both steps', '2026-11-12')
    repo.push('me/steps')
    repo.squashInto('me/steps', 'fix: both steps (#7)', '2026-11-13')
    repo.run(['switch', '-q', '-c', 'me/open'])
    repo.commit('feat: still open', '2026-11-14', { file: 'open.txt' })
    repo.push('me/open')

    const [api] = collect({ root, ...range })
    assert.deepEqual(subjectsWithState(api), [
      ['fix: first step', true, false],
      ['fix: both steps (#7)', true, false],
      ['feat: still open', false, false]
    ])
    assert.equal(api.commits[1].review, 'https://gitlab.com/acme/api/-/merge_requests/7')
  }))

test('new work on a branch reused after its squash merge stays unmerged', () =>
  withTempDir(root => {
    const repo = makeRepo(root, 'site', 'git@github.com:acme/site.git')
    repo.commit('feat: base', '2026-11-09')
    repo.push('main')
    repo.run(['switch', '-q', '-c', 'me/x'])
    repo.commit('feat: first round', '2026-11-11')
    repo.push('me/x')
    repo.squashInto('me/x', 'feat: first round (#3)', '2026-11-12')
    repo.run(['switch', '-q', 'me/x'])
    repo.commit('feat: follow up', '2026-11-14', { file: 'follow.txt' })
    repo.push('me/x')
    repo.commit('feat: follow up, unpushed', '2026-11-15', { file: 'more.txt' })

    const commits = collect({ root, ...range })[0].commits
    const state = subject => {
      const commit = commits.find(item => item.subject === subject)
      return [commit.merged, commit.unpushed]
    }
    assert.deepEqual(state('feat: first round (#3)'), [true, false])
    assert.deepEqual(state('feat: follow up'), [false, false])
    assert.deepEqual(state('feat: follow up, unpushed'), [false, true])
  }))

test('collect merges two clones of the same remote into one repo', () =>
  withTempDir(root => {
    const first = makeRepo(root, 'site', 'git@github.com:acme/site.git')
    first.commit('feat: shared', '2026-11-11')
    first.commit('feat: only in the first clone', '2026-11-12')
    first.push('main')
    const second = makeRepo(root, 'site-copy', 'https://github.com/acme/site.git')
    second.commit('feat: shared', '2026-11-11')
    second.commit('feat: only in the second clone', '2026-11-13')
    second.push('main')

    const repos = collect({ root, ...range })
    assert.equal(repos.length, 1)
    assert.deepEqual(repos[0].commits.map(commit => commit.subject), [
      'feat: shared',
      'feat: only in the first clone',
      'feat: only in the second clone'
    ])
  }))

test('--author matches an email with regex characters literally', () =>
  withTempDir(root => {
    seedWorkspace(root)
    const repos = collect({ root, ...range, authors: [MY_EMAIL] })
    assert.equal(repos[0].commits.length, 2)
    assert.equal(collect({ root, ...range, authors: ['me.work'] }).length, 0)
  }))

test('collect matches any of several authors', () =>
  withTempDir(root => {
    seedWorkspace(root)
    const [api] = collect({ root, ...range, authors: [ME, SOMEONE_ELSE] })
    assert.ok(api.commits.some(commit => commit.subject === 'fix: someone else'))
  }))

const pendingCommit = (subject, branches, committedAt = '2026-11-12T12:00:00Z') => ({
  subject,
  date: committedAt.slice(0, 10),
  committedAt,
  merged: false,
  unpushed: false,
  branches,
  review: null
})

test('resolveReviews trusts a request merged after the commit, one lookup per pushed branch', async () => {
  const repos = [
    {
      name: 'site',
      url: 'https://github.com/acme/site',
      commits: [
        pendingCommit('fix: squashed after review', ['me/fix']),
        pendingCommit('fix: another commit on it', ['me/fix']),
        pendingCommit('feat: under review', ['me/open']),
        pendingCommit('feat: abandoned', ['me/closed']),
        pendingCommit('feat: after the old merge', ['me/reused'], '2026-11-14T12:00:00Z'),
        { ...pendingCommit('feat: never pushed', ['me/local']), unpushed: true },
        { ...pendingCommit('fix: remote branch deleted after merge', ['me/deleted']), unpushed: true },
        { ...pendingCommit('feat: local after the merge', ['me/deleted'], '2026-11-14T12:00:00Z'), unpushed: true },
        { ...pendingCommit('feat: local on main', ['main']), unpushed: true }
      ]
    }
  ]
  const asked = []
  const answers = {
    'me/fix': { state: 'merged', url: 'https://github.com/acme/site/pull/3', mergedAt: '2026-11-13T00:00:00Z' },
    'me/open': { state: 'open', url: 'https://github.com/acme/site/pull/4', mergedAt: null },
    'me/closed': { state: 'closed', url: 'https://github.com/acme/site/pull/5', mergedAt: null },
    'me/reused': { state: 'merged', url: 'https://github.com/acme/site/pull/2', mergedAt: '2026-11-13T00:00:00Z' },
    'me/deleted': { state: 'merged', url: 'https://github.com/acme/site/pull/6', mergedAt: '2026-11-13T00:00:00Z' }
  }
  const failures = await resolveReviews(repos, async (url, branch) => {
    asked.push(branch)
    return answers[branch] ?? null
  })
  assert.deepEqual(failures, [])
  assert.deepEqual(asked.sort(), ['me/closed', 'me/deleted', 'me/fix', 'me/local', 'me/open', 'me/reused'])
  const [squashed, another, open, closed, reused, local, deleted, afterMerge, onMain] = repos[0].commits
  assert.deepEqual([deleted.merged, deleted.unpushed, deleted.review], [true, false, 'https://github.com/acme/site/pull/6'])
  assert.deepEqual([afterMerge.merged, afterMerge.unpushed], [false, true])
  assert.deepEqual([onMain.merged, onMain.unpushed], [false, true])
  assert.deepEqual([squashed.merged, squashed.branches, squashed.review], [true, [], 'https://github.com/acme/site/pull/3'])
  assert.equal(another.merged, true)
  assert.deepEqual([open.merged, open.open, open.review], [false, true, 'https://github.com/acme/site/pull/4'])
  assert.deepEqual([closed.merged, closed.open, closed.review], [false, undefined, null])
  assert.equal(reused.merged, false)
  assert.equal(local.merged, false)
  const markdown = toMarkdown(repos, range)
  assert.match(markdown, /feat: under review \[open: me\/open\] https:\/\/github\.com\/acme\/site\/pull\/4/)
  assert.match(markdown, /feat: never pushed \[unpushed: me\/local\]/)
})

test('resolveReviews reports a failed lookup instead of reading it as no request', async () => {
  const repos = [{ name: 'site', url: 'https://github.com/acme/site', commits: [pendingCommit('feat: x', ['me/x'])] }]
  const failures = await resolveReviews(repos, async () => {
    throw new Error('gh: authentication required\nmore')
  })
  assert.deepEqual(failures, ['site me/x: gh: authentication required'])
  assert.match(toMarkdown(repos, range), /feat: x \[unmerged: me\/x, lookup failed\]/)
})

test('toMarkdown groups by repo and says when nothing matched', () =>
  withTempDir(root => {
    seedWorkspace(root)
    const markdown = toMarkdown(collect({ root, ...range }), range)
    assert.match(markdown, /^## api \(2\) https:\/\/github\.com\/acme\/api$/m)
    assert.match(markdown, /- 2026-11-11 feat: cache values with brotli \(#12\) \[merged\] https:\/\/github\.com\/acme\/api\/pull\/12/)
    assert.match(markdown, /- 2026-11-14 feat: metadata monitor \[unmerged: me\/monitor\]/)
    assert.ok(toMarkdown([], range).endsWith('No commits in this range.'))
  }))

test('the CLI prints usage without arguments and fails on a missing --since', () => {
  const script = path.join(HERE, 'collect.mjs')
  const usage = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(usage.status, 1)
  assert.match(usage.stdout, /^Usage:/)
  const missing = spawnSync(process.execPath, [script, '--until', '2026-11-17'], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /--since YYYY-MM-DD is required/)
})

test('parseArgs reads flags and rejects impossible or reversed dates', () => {
  const options = parseArgs(['--since', '2026-11-10', '--until', '2026-11-17', '--author', 'a', '--author', 'b', '--json', '--offline'])
  assert.deepEqual([options.authors, options.json, options.offline], [['a', 'b'], true, true])
  assert.throws(() => parseArgs(['--since', '11/10/2026']), /--since/)
  assert.throws(() => parseArgs(['--since', '2026-13-45']), /--since/)
  assert.throws(() => parseArgs(['--since', '2026-11-10', '--until', '2026-02-30']), /--until/)
  assert.throws(() => parseArgs(['--since', '2026-11-10', '--until', '2026-11-10']), /before --until/)
  assert.throws(() => parseArgs(['--since', '2026-11-17', '--until', '2026-11-10']), /before --until/)
  const today = new Date()
  const pad = number => String(number).padStart(2, '0')
  assert.equal(parseArgs(['--since', '2020-01-01']).until, `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`)
  assert.equal(parseArgs(['--since', '2026-11-10', '--until', '2026-11-17', '--root', 'repos']).root, path.resolve('repos'))
  assert.throws(() => parseArgs(['--since', '2026-11-10', '--nope']), /unknown argument/)
  assert.throws(() => parseArgs(['--since']), /needs a value/)
})

test('isNoise drops releases, dependency bumps and data updates, keeps real work', () => {
  for (const subject of ['chore(release): 3.97.3', 'chore: release 1.2.0', 'chore(deps): update x', 'build(deps): bump jsdom', 'build(deps-dev): bump y', 'build(update): emails', 'build: contributors', "Merge branch 'main'", 'Merge pull request #9 from a/b', "Merge remote-tracking branch 'origin/main'"]) {
    assert.equal(isNoise(subject), true, subject)
  }
  for (const subject of ['build: update dependencies and collapse duplicate versions', 'feat(cluster): take adobe-citations live', 'chore(skills): triage findings']) {
    assert.equal(isNoise(subject), false, subject)
  }
})

test('pullRequestNumber and dedupeKey read a trailing (#N) only', () => {
  assert.equal(pullRequestNumber('feat: x (#2404)'), 2404)
  assert.equal(pullRequestNumber('feat: x  (#2404) '), 2404)
  assert.equal(pullRequestNumber('fix: see #12 for context'), null)
  assert.equal(dedupeKey('feat: x (#2404)'), 'feat: x')
  assert.equal(dedupeKey('feat: x  (#2404) '), 'feat: x')
  assert.equal(dedupeKey('fix: see #12 for context'), 'fix: see #12 for context')
})

test('webUrl, isGitLab and branchName read remotes and refs', () => {
  assert.equal(webUrl('git@github.com:microlinkhq/skills.git'), 'https://github.com/microlinkhq/skills')
  assert.equal(webUrl('https://github.com/Kikobeats/splashy.git'), 'https://github.com/Kikobeats/splashy')
  assert.equal(webUrl('ssh://git@gitlab.com:22/group/sub/project.git'), 'https://gitlab.com/group/sub/project')
  assert.equal(webUrl('http://github.com/acme/api.git'), 'https://github.com/acme/api')
  assert.equal(webUrl('git@github.com:acme/api'), 'https://github.com/acme/api')
  assert.equal(webUrl('https://github.com/acme/api.git/'), 'https://github.com/acme/api')
  assert.equal(webUrl('https://git@github.com/acme/api.git'), 'https://github.com/acme/api')
  assert.equal(webUrl('ssh://git@gitlab.com/group/sub/project.git'), 'https://gitlab.com/group/sub/project')
  assert.equal(webUrl(''), null)
  assert.equal(isGitLab('https://gitlab.com/a/b'), true)
  assert.equal(isGitLab('https://code.gitlab.example.org/a/b'), true)
  assert.equal(isGitLab('https://github.example.com/a/b'), false)
  assert.equal(branchName('origin/Kikobeats/input'), 'Kikobeats/input')
  assert.equal(branchName('remotes/origin/me/fix'), 'me/fix')
  assert.equal(branchName('mr/2043'), 'mr/2043')
})

const withServer = async (handler, run) => {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    return await run(origin)
  } finally {
    server.close()
  }
}

test('checkLinks follows redirects, flags non-2xx answers and sign-in walls', () =>
  withServer(
    (req, res) => {
      if (req.url === '/moved') return res.writeHead(301, { location: '/ok' }).end()
      if (req.url === '/dashboard') return res.writeHead(302, { location: '/login?next=/dashboard' }).end()
      res.writeHead(req.url === '/ok' || req.url.startsWith('/login') ? 200 : 404).end()
    },
    async origin => {
      const results = await checkLinks([`${origin}/ok`, `${origin}/moved`, `${origin}/private`, `${origin}/dashboard`])
      assert.deepEqual(results.map(result => result.ok), [true, true, false, false])
      assert.equal(results[1].finalUrl, `${origin}/ok`)
      assert.equal(results[3].reason, 'redirects to sign-in')
    }
  ))

test('checkLinks reports an unreachable host as a failure', async () => {
  const [badPort] = await checkLinks(['http://127.0.0.1:1/'])
  assert.deepEqual([badPort.ok, badPort.status, badPort.reason], [false, 0, 'TypeError'])
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const [refused] = await checkLinks([`http://127.0.0.1:${port}/`])
  assert.equal(refused.reason, 'ECONNREFUSED')
})

test('probeUrl checks npm packages through the registry, which answers bots', () => {
  assert.equal(probeUrl('https://www.npmjs.com/package/splashy'), 'https://registry.npmjs.org/splashy')
  assert.equal(probeUrl('https://npmjs.com/package/splashy'), 'https://registry.npmjs.org/splashy')
  assert.equal(probeUrl('https://www.npmjs.com/package/splashy/'), 'https://registry.npmjs.org/splashy')
  assert.equal(probeUrl('https://www.npmjs.com/package/@microlink/mql'), 'https://registry.npmjs.org/@microlink%2Fmql')
  assert.equal(probeUrl('https://microlink.io/blog'), 'https://microlink.io/blog')
})

test('upload sends the file with every returned header and fails without an image source', () =>
  withTempDir(dir =>
    withServer(
      (req, res) => {
        const chunks = []
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('latin1')
          const ok = req.headers.authorization === 'Bearer secret' && req.headers['notion-version'] === 'x' && body.includes('filename="shot.png"') && body.includes('PNGDATA')
          res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' })
          if (req.url === '/empty') return res.end(JSON.stringify({ status: 'uploaded' }))
          res.end(JSON.stringify(ok ? { status: 'uploaded', markdown_source: 'file-upload://abc' } : { status: 'bad' }))
        })
      },
      async origin => {
        const file = path.join(dir, 'shot.png')
        writeFileSync(file, 'PNGDATA')
        const headers = JSON.stringify({ authorization: 'Bearer secret', 'Notion-Version': 'x' })
        assert.equal(await upload(`${origin}/send`, headers, file), '<image source="file-upload://abc" />')
        await assert.rejects(upload(`${origin}/send`, JSON.stringify({ authorization: 'Bearer wrong' }), file), /upload failed with 400/)
        await assert.rejects(upload(`${origin}/empty`, headers, file), /no markdown_source/)
        await assert.rejects(upload(`${origin}/send`, 'not json', file), /upload_headers as JSON/)
      }
    )
  ))

test('the range includes a commit at since midnight and excludes one at until midnight', () =>
  withTempDir(root => {
    const repo = makeRepo(root, 'edge', 'git@github.com:acme/edge.git')
    repo.commit('at since midnight', '2026-11-10', { stamp: '2026-11-10T00:00:00' })
    repo.commit('at until midnight', '2026-11-17', { stamp: '2026-11-17T00:00:00' })
    repo.push('main')
    const subjects = collect({ root, ...range })[0].commits.map(commit => commit.subject)
    assert.deepEqual(subjects, ['at since midnight'])
  }))

test('origin/HEAD is the default branch when it is not main', () =>
  withTempDir(root => {
    const repo = makeRepo(root, 'app', 'git@github.com:acme/app.git')
    repo.commit('feat: base', '2026-11-09')
    repo.push('main')
    repo.run(['switch', '-q', '-c', 'develop'])
    repo.commit('feat: on develop', '2026-11-12', { file: 'dev.txt' })
    repo.push('develop')
    repo.run(['switch', '-q', 'main'])
    repo.commit('feat: only on main', '2026-11-13', { file: 'main.txt' })
    repo.push('main')
    repo.run(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop'])
    const commits = collect({ root, ...range })[0].commits
    const state = subject => {
      const commit = commits.find(item => item.subject === subject)
      return [commit.merged, commit.unpushed]
    }
    assert.deepEqual(state('feat: on develop'), [true, false])
    assert.deepEqual(state('feat: only on main'), [false, false])
  }))

test('origin/master is the default branch when origin/HEAD is absent', () =>
  withTempDir(root => {
    const repo = makeRepo(root, 'legacy', 'git@github.com:acme/legacy.git', 'master')
    repo.commit('feat: on master', '2026-11-12')
    repo.push('master')
    repo.run(['symbolic-ref', '-d', 'refs/remotes/origin/HEAD'])
    const commit = collect({ root, ...range })[0].commits[0]
    assert.deepEqual([commit.merged, commit.branches], [true, []])
  }))

test('unmerged copies of one subject keep every branch and the request number', () =>
  withTempDir(root => {
    const repo = makeRepo(root, 'site', 'git@github.com:acme/site.git')
    repo.commit('feat: base', '2026-11-09')
    repo.push('main')
    repo.run(['switch', '-q', '-c', 'me/old'])
    repo.commit('feat: shared (#4)', '2026-11-11', { file: 'old.txt' })
    repo.push('me/old')
    repo.run(['switch', '-q', 'main'])
    repo.run(['switch', '-q', '-c', 'me/new'])
    repo.commit('feat: shared', '2026-11-12', { file: 'new.txt' })
    repo.push('me/new')
    const commit = collect({ root, ...range })[0].commits.find(item => item.subject.startsWith('feat: shared'))
    assert.equal(commit.merged, false)
    assert.deepEqual(commit.branches.sort(), ['me/new', 'me/old'])
    assert.equal(commit.review, 'https://github.com/acme/site/pull/4')
  }))

test('a squash without a request number keeps the number from the branch commit', () =>
  withTempDir(root => {
    const repo = makeRepo(root, 'site', 'git@github.com:acme/site.git')
    repo.commit('feat: base', '2026-11-09')
    repo.push('main')
    repo.run(['switch', '-q', '-c', 'me/steps'])
    repo.commit('feat: shared (#4)', '2026-11-11', { file: 'a.txt' })
    repo.push('me/steps')
    repo.squashInto('me/steps', 'feat: shared', '2026-11-13')
    const commit = collect({ root, ...range })[0].commits.find(item => item.subject.startsWith('feat: shared'))
    assert.equal(commit.merged, true)
    assert.equal(commit.subject, 'feat: shared (#4)')
    assert.equal(commit.review, 'https://github.com/acme/site/pull/4')
  }))

test('a merged copy keeps the request number written on the newer unmerged copy', () =>
  withTempDir(root => {
    const repo = makeRepo(root, 'site', 'git@github.com:acme/site.git')
    repo.commit('feat: shared', '2026-11-11')
    repo.push('main')
    repo.run(['switch', '-q', '-c', 'me/new'])
    repo.commit('feat: shared (#4)', '2026-11-12', { file: 'new.txt' })
    repo.push('me/new')
    const commit = collect({ root, ...range })[0].commits.find(item => item.subject.startsWith('feat: shared'))
    assert.equal(commit.merged, true)
    assert.equal(commit.subject, 'feat: shared (#4)')
  }))

test('clones keep the merged copy and a request number from either side', () =>
  withTempDir(root => {
    const first = makeRepo(root, 'site', 'git@github.com:acme/site.git')
    first.commit('feat: base', '2026-11-09')
    first.push('main')
    first.run(['switch', '-q', '-c', 'me/wip'])
    first.commit('feat: landed elsewhere', '2026-11-12', { file: 'wip.txt' })
    first.push('me/wip')
    first.run(['switch', '-q', 'main'])
    first.commit('feat: numbered', '2026-11-11', { file: 'num.txt' })
    first.push('main')
    const second = makeRepo(root, 'site-copy', 'https://github.com/acme/site.git')
    second.commit('feat: landed elsewhere', '2026-11-12')
    second.commit('feat: numbered (#8)', '2026-11-13', { file: 'num.txt' })
    second.push('main')
    const commits = collect({ root, ...range })[0].commits
    const landed = commits.find(commit => commit.subject.startsWith('feat: landed'))
    const numbered = commits.find(commit => commit.subject.startsWith('feat: numbered'))
    assert.equal(landed.merged, true)
    assert.equal(numbered.subject, 'feat: numbered (#8)')
    assert.equal(numbered.review, 'https://github.com/acme/site/pull/8')
  }))

test('resolveReviews treats a merged request without a time as landed only once it is pushed', async () => {
  const repos = [{
    name: 'site',
    url: 'https://github.com/acme/site',
    commits: [
      pendingCommit('feat: pushed', ['me/pushed']),
      { ...pendingCommit('feat: still local', ['me/local-after']), unpushed: true },
      { ...pendingCommit('feat: on master', ['master']), unpushed: true }
    ]
  }]
  const asked = []
  await resolveReviews(repos, async (url, branch) => {
    asked.push(branch)
    return { state: 'merged', url: `https://github.com/acme/site/pull/${branch}`, mergedAt: null }
  })
  assert.deepEqual(asked.sort(), ['me/local-after', 'me/pushed'])
  assert.equal(repos[0].commits[0].merged, true)
  assert.equal(repos[0].commits[1].merged, false)
  assert.equal(repos[0].commits[2].merged, false)
})

test('resolveReviews asks the forge with a capped number of lookups at once', async () => {
  const branches = Array.from({ length: 10 }, (_, index) => `me/${index}`)
  const repos = [{
    name: 'site',
    url: 'https://github.com/acme/site',
    commits: branches.map(branch => pendingCommit(branch, [branch]))
  }]
  let inflight = 0
  let max = 0
  let timer
  let release
  const gate = new Promise(resolve => { release = resolve })
  await resolveReviews(repos, async () => {
    inflight += 1
    max = Math.max(max, inflight)
    clearTimeout(timer)
    timer = setTimeout(release, 30)
    await gate
    inflight -= 1
    return null
  })
  assert.equal(max, 6)
})

const execFileAsync = promisify(execFile)

const runCli = (script, args, env = {}) =>
  spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

const runCliAsync = async (script, args, env = {}) => {
  try {
    const result = await execFileAsync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
    return { status: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return { status: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

test('the collect CLI prints help, defaults the author, and can stay offline or emit JSON', () =>
  withTempDir(root => {
    const help = runCli('collect.mjs', ['--help', '--since'])
    assert.equal(help.status, 0)
    assert.match(help.stdout, /^Usage:/)
    const bare = runCli('collect.mjs', [])
    assert.equal(bare.status, 1)
    assert.match(bare.stdout, /^Usage:/)
    seedWorkspace(root)
    const config = path.join(root, 'gitconfig')
    const offlineArgs = ['--root', root, '--since', '2026-11-10', '--until', '2026-11-17', '--offline']
    writeFileSync(config, '')
    const missing = runCli('collect.mjs', offlineArgs, { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' })
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /no --author/)
    writeFileSync(config, '[user]\n\temail = me+work@example.com\n')
    const byEmail = runCli('collect.mjs', offlineArgs, { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' })
    assert.equal(byEmail.status, 0, byEmail.stderr)
    assert.match(byEmail.stdout, /feat: cache values with brotli/)
    writeFileSync(config, '[user]\n\tname = Weekly Tester\n')
    const byName = runCli('collect.mjs', offlineArgs, { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' })
    assert.match(byName.stdout, /feat: metadata monitor/)
    const bin = path.join(root, 'bin')
    mkdirSync(bin)
    const gh = path.join(bin, 'gh')
    writeFileSync(gh, '#!/bin/sh\necho fail >&2\nexit 1\n')
    chmodSync(gh, 0o755)
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` }
    const offline = runCli('collect.mjs', ['--root', root, '--since', '2026-11-10', '--until', '2026-11-17', '--author', ME, '--offline'], env)
    assert.equal(offline.status, 0, offline.stderr)
    assert.doesNotMatch(offline.stderr, /lookup failed/)
    const online = runCli('collect.mjs', ['--root', root, '--since', '2026-11-10', '--until', '2026-11-17', '--author', ME], env)
    assert.match(online.stderr, /lookup failed/)
    const json = runCli('collect.mjs', ['--root', root, '--since', '2026-11-10', '--until', '2026-11-17', '--author', ME, '--json', '--offline'])
    assert.equal(JSON.parse(json.stdout)[0].name, 'api')
  }))

test('lookupReview reads GitHub and GitLab answers, including the branches those commands leave out', () =>
  withTempDir(dir => {
    const bin = path.join(dir, 'bin')
    mkdirSync(bin)
    const log = path.join(dir, 'log')
    writeFileSync(log, '')
    const fake = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const command = process.argv[1].endsWith('glab') ? 'glab' : 'gh'
appendFileSync(process.env.LOOKUP_LOG, command + ' ' + process.argv.slice(2).join(' ') + '\\n')
process.stdout.write(process.env[command === 'glab' ? 'GLAB_RESPONSE' : 'GH_RESPONSE'] ?? '[]')
`
    for (const command of ['gh', 'glab']) {
      const file = path.join(bin, command)
      writeFileSync(file, fake)
      chmodSync(file, 0o755)
    }
    const href = pathToFileURL(path.join(HERE, 'collect.mjs')).href
    const code = `
import { readFileSync, writeFileSync } from 'node:fs'
import { lookupReview } from ${JSON.stringify(href)}
const cases = JSON.parse(readFileSync(0, 'utf8'))
const results = []
for (const item of cases) {
  process.env.GH_RESPONSE = item.gh ?? '[]'
  process.env.GLAB_RESPONSE = item.glab ?? '[]'
  writeFileSync(process.env.LOOKUP_LOG, '')
  results.push({ review: await lookupReview(item.url, item.branch), log: readFileSync(process.env.LOOKUP_LOG, 'utf8') })
}
console.log(JSON.stringify(results))
`
    const cases = [
      {
        url: 'https://github.com/acme/site',
        branch: 'me/fix',
        gh: JSON.stringify([
          { number: 1, state: 'OPEN', url: 'https://github.com/acme/site/pull/1', isCrossRepository: true, mergedAt: '2026-11-01T00:00:00Z' },
          { number: 2, state: 'MERGED', url: 'https://github.com/acme/site/pull/2', isCrossRepository: false },
          { number: 9, state: 'OPEN', url: 'https://github.com/acme/site/pull/9', isCrossRepository: false }
        ])
      },
      { url: 'https://github.com/acme/site', branch: 'me/none', gh: '[]' },
      {
        url: 'https://gitlab.com/acme/site',
        branch: 'mr/12',
        glab: JSON.stringify({ iid: 12, state: 'opened', source_project_id: 5, target_project_id: 5 })
      },
      {
        url: 'https://gitlab.com/acme/site',
        branch: 'mr/3',
        glab: JSON.stringify({ iid: 3, state: 'opened', source_project_id: 9, target_project_id: 1, web_url: 'https://gitlab.com/fork/site/-/merge_requests/3' })
      },
      {
        url: 'https://gitlab.com/acme/site',
        branch: 'me/feat',
        glab: JSON.stringify([
          { source_project_id: 5, target_project_id: 5 },
          { iid: 4, state: 'merged', source_project_id: 5, target_project_id: 5, web_url: 'https://gitlab.com/acme/site/-/merge_requests/4', merged_at: '2026-11-13T00:00:00Z' },
          { iid: 8, state: 'opened', source_project_id: 5, target_project_id: 5, web_url: 'https://gitlab.com/acme/site/-/merge_requests/8' }
        ])
      },
      {
        url: 'https://gitlab.com/acme/site',
        branch: 'me/closed',
        glab: JSON.stringify([{ iid: 5, state: 'closed', source_project_id: 5, target_project_id: 5, web_url: 'https://gitlab.com/acme/site/-/merge_requests/5' }])
      }
    ]
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
      input: JSON.stringify(cases),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, LOOKUP_LOG: log }
    })
    assert.equal(child.status, 0, child.stderr)
    const [github, empty, view, fork, list, closed] = JSON.parse(child.stdout)
    assert.deepEqual(github.review, [
      { state: 'merged', url: 'https://github.com/acme/site/pull/2', mergedAt: null },
      { state: 'open', url: 'https://github.com/acme/site/pull/9', mergedAt: null }
    ])
    assert.match(github.log, /--limit 5/)
    assert.match(github.log, /--head me\/fix/)
    assert.match(github.log, /--repo github.com\/acme\/site/)
    assert.deepEqual(empty.review, [])
    assert.deepEqual(view.review, [{ state: 'open', url: 'https://gitlab.com/acme/site/-/merge_requests/12', mergedAt: null }])
    assert.match(view.log, /mr view 12/)
    assert.doesNotMatch(view.log, /mr list/)
    assert.deepEqual(fork.review, [])
    assert.deepEqual(list.review, [
      { state: 'merged', url: 'https://gitlab.com/acme/site/-/merge_requests/4', mergedAt: '2026-11-13T00:00:00Z' },
      { state: 'open', url: 'https://gitlab.com/acme/site/-/merge_requests/8', mergedAt: null }
    ])
    assert.match(list.log, /mr list/)
    assert.match(list.log, /--source-branch me\/feat/)
    assert.equal(closed.review[0].state, 'closed')
    assert.equal(closed.review[0].mergedAt, null)
  }))

test('checkLinks treats every sign-in path as a wall, and a direct visit as the page itself', () =>
  withServer(
    (req, res) => {
      const walls = { '/app': '/auth/start', '/go': '/sso?next=1', '/menu': '/session', '/in': '/log-in', '/up': '/sign-in', '/join': '/signin', '/auth/dashboard': '/login', '/login?from=app': '/login?next=1' }
      if (walls[req.url]) return res.writeHead(302, { location: walls[req.url] }).end()
      res.writeHead(200).end()
    },
    async origin => {
      const paths = ['/app', '/go', '/menu', '/in', '/up', '/join', '/auth/dashboard', '/login?from=app']
      const results = await checkLinks(paths.map(pathname => origin + pathname))
      assert.deepEqual(results.map(result => result.reason), Array(paths.length).fill('redirects to sign-in'))
      const [direct] = await checkLinks([`${origin}/login`])
      assert.equal(direct.ok, true)
      assert.equal(direct.reason, null)
    }
  ))

test('checkLinks caps how many fetches run at once', async () => {
  let inflight = 0
  let max = 0
  let timer
  let release
  const gate = new Promise(resolve => { release = resolve })
  await withServer(
    (req, res) => {
      inflight += 1
      max = Math.max(max, inflight)
      clearTimeout(timer)
      timer = setTimeout(release, 50)
      gate.then(() => {
        inflight -= 1
        res.writeHead(200).end()
      })
    },
    async origin => {
      const results = await checkLinks(Array.from({ length: 12 }, (_, index) => `${origin}/${index}`))
      assert.equal(results.every(result => result.ok), true)
      assert.equal(max, 8)
    }
  )
})

test('checkLinks gives up when a host never answers', () =>
  withServer(
    req => setTimeout(() => req.destroy(), 21_000),
    async origin => {
      const started = Date.now()
      const outcome = await Promise.race([
        checkLinks([`${origin}/hang`]).then(results => results[0]),
        new Promise(resolve => setTimeout(() => resolve('slow'), 20_000))
      ])
      assert.notEqual(outcome, 'slow')
      assert.equal(outcome.reason, 'TimeoutError')
      assert.ok(Date.now() - started < 20_000)
    }
  ))

test('check-links exits 0 for help and a live page, and 1 for no arguments or a failure', () =>
  withServer(
    (req, res) => res.writeHead(req.url === '/missing' ? 404 : 200).end(),
    async origin => {
      const help = runCli('check-links.mjs', ['--help'])
      assert.equal(help.status, 0)
      assert.match(help.stdout, /^Usage:/)
      const bare = runCli('check-links.mjs', [])
      assert.equal(bare.status, 1)
      assert.match(bare.stdout, /^Usage:/)
      const ok = await runCliAsync('check-links.mjs', [`${origin}/ok`])
      assert.equal(ok.status, 0, ok.stderr + ok.stdout)
      assert.match(ok.stdout, /^OK/)
      const missing = await runCliAsync('check-links.mjs', [`${origin}/missing`])
      assert.equal(missing.status, 1)
      assert.match(missing.stdout, /^FAIL/)
    }
  ))

test('upload sends each file type, rejects a non-object header list, and rejects an unfinished upload', () =>
  withTempDir(dir =>
    withServer(
      (req, res) => {
        const chunks = []
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('latin1')
          if (req.url === '/text') {
            res.writeHead(200, { 'content-type': 'text/plain' })
            return res.end('nope')
          }
          if (req.url === '/pending') {
            res.writeHead(200, { 'content-type': 'application/json' })
            return res.end(JSON.stringify({ status: 'pending', markdown_source: 'file-upload://nope' }))
          }
          const type = decodeURIComponent(req.url.slice(1))
          const ok = body.includes(`Content-Type: ${type}`)
          res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' })
          res.end(JSON.stringify(ok ? { status: 'uploaded', markdown_source: 'file-upload://typed' } : { status: 'bad' }))
        })
      },
      async origin => {
        const file = path.join(dir, 'shot.bin')
        writeFileSync(file, 'DATA')
        const headers = JSON.stringify({ authorization: 'Bearer secret' })
        for (const value of ['[]', 'null', '42', '"x"']) {
          await assert.rejects(upload(`${origin}/send`, value, file), /upload_headers as JSON/)
        }
        for (const [ext, type] of [['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.txt', 'application/octet-stream']]) {
          const image = path.join(dir, `shot${ext}`)
          writeFileSync(image, 'DATA')
          assert.equal(await upload(`${origin}/${encodeURIComponent(type)}`, headers, image), '<image source="file-upload://typed" />')
        }
        await assert.rejects(upload(`${origin}/text`, headers, file), /upload failed|no markdown_source/)
        await assert.rejects(upload(`${origin}/pending`, headers, file), /upload failed with 200/)
      }
    )
  ))

test('upload prints usage unless it is given the url, the headers and the file', () => {
  const bare = runCli('upload.mjs', [])
  assert.equal(bare.status, 1)
  assert.match(bare.stdout, /^Usage:/)
})

test('a pushed copy wins over a newer unpushed copy of the same subject', () =>
  withTempDir(async root => {
    const repo = makeRepo(root, 'site', 'git@github.com:acme/site.git')
    repo.commit('feat: base', '2026-11-09')
    repo.push('main')
    repo.run(['switch', '-q', '-c', 'me/old'])
    repo.commit('feat: shared', '2026-11-11', { file: 'old.txt' })
    repo.push('me/old')
    const pushedHash = repo.run(['rev-parse', 'HEAD'])
    repo.run(['switch', '-q', 'main'])
    repo.run(['switch', '-q', '-c', 'me/new'])
    repo.commit('feat: shared', '2026-11-15', { file: 'new.txt' })
    const repos = collect({ root, ...range })
    const commit = repos[0].commits.find(item => item.subject === 'feat: shared')
    assert.equal(commit.unpushed, false)
    assert.deepEqual(commit.branches, ['me/old'])
    assert.equal(commit.date, '2026-11-11')
    assert.equal(commit.hash, pushedHash)
    await resolveReviews(repos, async () => [{ state: 'merged', url: 'https://github.com/acme/site/pull/4', mergedAt: '2026-11-13T00:00:00Z' }])
    assert.equal(commit.merged, true)
    assert.equal(commit.review, 'https://github.com/acme/site/pull/4')
  }))

test('clones keep a pushed copy ahead of an unpushed one', () =>
  withTempDir(root => {
    const local = makeRepo(root, 'site', 'git@github.com:acme/site.git')
    local.commit('feat: base', '2026-11-09')
    local.push('main')
    local.run(['switch', '-q', '-c', 'me/local'])
    local.commit('feat: shared', '2026-11-12', { file: 'local.txt' })
    const pushed = makeRepo(root, 'site-copy', 'https://github.com/acme/site.git')
    pushed.commit('feat: base', '2026-11-09')
    pushed.push('main')
    pushed.run(['switch', '-q', '-c', 'me/topic'])
    pushed.commit('feat: shared', '2026-11-11', { file: 'topic.txt' })
    pushed.push('me/topic')
    const commit = collect({ root, ...range })[0].commits.find(item => item.subject === 'feat: shared')
    assert.equal(commit.unpushed, false)
    assert.deepEqual(commit.branches, ['me/topic'])
    assert.equal(commit.date, '2026-11-11')
  }))

test('an older unpushed copy does not join a pushed copy of the same subject', () =>
  withTempDir(root => {
    const repo = makeRepo(root, 'site', 'git@github.com:acme/site.git')
    repo.commit('feat: base', '2026-11-09')
    repo.push('main')
    repo.run(['switch', '-q', '-c', 'me/old'])
    repo.commit('feat: shared', '2026-11-11', { file: 'old.txt' })
    repo.run(['switch', '-q', 'main'])
    repo.run(['switch', '-q', '-c', 'me/new'])
    repo.commit('feat: shared', '2026-11-12', { file: 'new.txt' })
    repo.push('me/new')
    const commit = collect({ root, ...range })[0].commits.find(item => item.subject === 'feat: shared')
    assert.equal(commit.unpushed, false)
    assert.deepEqual(commit.branches, ['me/new'])
  }))

test('an unmerged copy keeps its review when the numbered copy has none', () => {
  const [repo] = mergeClones([
    {
      name: 'site',
      url: 'https://github.com/acme/site',
      commits: [{ subject: 'feat: shared', merged: false, unpushed: false, branches: ['me/a'], review: 'https://github.com/acme/site/pull/3' }]
    },
    {
      name: 'site-copy',
      url: 'https://github.com/acme/site',
      commits: [{ subject: 'feat: shared (#9)', merged: false, unpushed: false, branches: ['me/a'], review: null }]
    }
  ])
  assert.equal(repo.commits[0].subject, 'feat: shared (#9)')
  assert.equal(repo.commits[0].review, 'https://github.com/acme/site/pull/3')
})

test('collect reports a repository whose git log fails and still returns the others', () =>
  withTempDir(root => {
    seedWorkspace(root)
    mkdirSync(path.join(root, 'broken', '.git'), { recursive: true })
    const repos = collect({ root, ...range })
    assert.deepEqual(repos.map(repo => repo.name), ['api'])
    collect({ root, ...range })
    assert.equal(collectionFailures.length, 1)
    assert.match(collectionFailures[0], /^broken:.*fatal/)
    const cli = runCli('collect.mjs', ['--root', root, '--since', range.since, '--until', range.until, '--author', ME, '--offline'])
    assert.equal(cli.status, 0, cli.stderr)
    assert.match(cli.stderr, /collect\.mjs: broken:.*fatal/)
  }))

test('a git log that exits without stderr still names the repository', () =>
  withTempDir(root => {
    seedWorkspace(root)
    mkdirSync(path.join(root, 'broken', '.git'), { recursive: true })
    const bin = path.join(root, 'bin')
    mkdirSync(bin)
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
const args = process.argv.slice(2)
if (args[0] === 'log' && process.cwd().endsWith('/broken')) process.exit(1)
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' })
process.exit(result.status ?? 1)
`)
    chmodSync(path.join(bin, 'git'), 0o755)
    const cli = runCli('collect.mjs', ['--root', root, '--since', range.since, '--until', range.until, '--author', ME, '--offline'], {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`
    })
    assert.equal(cli.status, 0, cli.stderr)
    assert.match(cli.stderr, /collect\.mjs: broken: Command failed/)
  }))

test('resolveReviews keeps an older merge when the branch has a newer open request', async () => {
  const repos = [{
    name: 'site',
    url: 'https://github.com/acme/site',
    commits: [
      pendingCommit('fix: already landed', ['me/reused'], '2026-11-12T12:00:00Z'),
      pendingCommit('feat: new round', ['me/reused'], '2026-11-15T12:00:00Z')
    ]
  }]
  await resolveReviews(repos, async () => [
    { state: 'open', url: 'https://github.com/acme/site/pull/9', mergedAt: null },
    { state: 'merged', url: 'https://github.com/acme/site/pull/4', mergedAt: '2026-11-13T00:00:00Z' }
  ])
  const [landed, next] = repos[0].commits
  assert.deepEqual([landed.merged, landed.review], [true, 'https://github.com/acme/site/pull/4'])
  assert.deepEqual([next.merged, next.open, next.review], [false, true, 'https://github.com/acme/site/pull/9'])
})

test('an npm package whose name looks like a sign-in page is still the package', () => {
  const href = pathToFileURL(path.join(HERE, 'check-links.mjs')).href
  const code = `
import { checkLinks } from ${JSON.stringify(href)}
let requested
globalThis.fetch = async target => {
  requested = String(target)
  return { url: 'https://registry.npmjs.org/login', status: 200, ok: true, body: { cancel: async () => {} } }
}
const [result] = await checkLinks(['https://www.npmjs.com/package/login'])
console.log(JSON.stringify({ result, requested }))
`
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  const { result, requested } = JSON.parse(child.stdout)
  assert.equal(requested, 'https://registry.npmjs.org/login')
  assert.equal(result.ok, true)
  assert.equal(result.reason, null)
})

test('importing a script with no process entry does not crash', () => {
  for (const file of SCRIPTS) {
    const href = pathToFileURL(path.join(HERE, file)).href
    const child = spawnSync(process.execPath, ['--input-type=module'], { input: `import ${JSON.stringify(href)}\n`, encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
  }
})

test('every script runs when its skill folder is a symlink, as skills add installs it', () => {
  const documented = [...readFileSync(path.join(HERE, '..', 'SKILL.md'), 'utf8').matchAll(/scripts\/([\w.-]+\.mjs)/g)]
    .map(match => match[1])
    .filter(name => !name.endsWith('.test.mjs'))
  assert.deepEqual(SCRIPTS, [...new Set(documented)].sort())
  const linkDir = mkdtempSync(path.join(tmpdir(), 'skill-symlink-'))
  const linked = path.join(linkDir, 'scripts')
  symlinkSync(HERE, linked)
  const modes = new Set()
  try {
    for (const script of SCRIPTS) {
      for (const flags of [[], ['--preserve-symlinks-main']]) {
        modes.add(flags[0] ?? 'plain')
        const run = spawnSync(process.execPath, [...flags, path.join(linked, script)], { encoding: 'utf8' })
        assert.equal(run.status, 1, `${script} ${flags}`)
        assert.match(run.stdout + run.stderr, /Usage:/, `${script} ${flags}`)
      }
    }
  } finally {
    rmSync(linkDir, { recursive: true, force: true })
  }
  assert.deepEqual([...modes].sort(), ['--preserve-symlinks-main', 'plain'])
})

test('every script imports cleanly from a script read on stdin', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: HERE,
    encoding: 'utf8',
    input: `${SCRIPTS.map(script => `await import('./${script}')`).join('\n')}\nconsole.log('imported')`
  })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, 'imported\n')
})

test('a file named - is stdin, and node ./- is still the script', () => {
  const linkDir = mkdtempSync(path.join(tmpdir(), 'skill-stdin-'))
  try {
    for (const script of SCRIPTS) {
      const dash = path.join(linkDir, '-')
      symlinkSync(path.join(HERE, script), dash)
      const imported = spawnSync(process.execPath, ['--input-type=module', '-'], {
        cwd: linkDir,
        encoding: 'utf8',
        input: `await import(${JSON.stringify(path.join(HERE, script))})\nconsole.log('imported')\n`
      })
      assert.equal(imported.status, 0, `${script}\n${imported.stdout}\n${imported.stderr}`)
      assert.equal(imported.stdout, 'imported\n', script)
      const direct = spawnSync(process.execPath, ['./-'], { cwd: linkDir, encoding: 'utf8' })
      assert.equal(direct.status, 1, `${script} ./-`)
      assert.match(direct.stdout + direct.stderr, /Usage:/, `${script} ./-`)
      rmSync(dash)
    }
  } finally {
    rmSync(linkDir, { recursive: true, force: true })
  }
})
