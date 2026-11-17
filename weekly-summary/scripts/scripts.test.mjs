import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  branchName,
  collect,
  dedupeKey,
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

const makeRepo = (root, name, remote) => {
  const repo = path.join(root, name)
  mkdirSync(repo)
  const run = (args, env = {}) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } }).trim()
  run(['init', '-q', '-b', 'main'])
  run(['config', 'commit.gpgsign', 'false'])
  run(['config', 'user.name', ME])
  run(['config', 'user.email', MY_EMAIL])
  run(['remote', 'add', 'origin', remote])

  const commit = (subject, date, { author = ME, keepStaged = false, file = 'file.txt' } = {}) => {
    if (!keepStaged) {
      writeFileSync(path.join(repo, file), `${subject}\n`)
      run(['add', file])
    }
    const stamp = `${date}T12:00:00Z`
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
    if (branch === 'main') run(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
  }
  const squashInto = (branch, subject, date) => {
    run(['switch', '-q', 'main'])
    run(['merge', '-q', '--squash', branch])
    commit(subject, date, { keepStaged: true })
    push('main')
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
  assert.throws(() => parseArgs(['--since', '2026-11-17', '--until', '2026-11-10']), /before --until/)
  assert.throws(() => parseArgs(['--since', '2026-11-10', '--nope']), /unknown argument/)
  assert.throws(() => parseArgs(['--since']), /needs a value/)
})

test('isNoise drops releases, dependency bumps and data updates, keeps real work', () => {
  for (const subject of ['chore(release): 3.97.3', 'chore(deps): update x', 'build(deps): bump jsdom', 'build(deps-dev): bump y', 'build(update): emails', 'build: contributors', "Merge branch 'main'"]) {
    assert.equal(isNoise(subject), true, subject)
  }
  for (const subject of ['build: update dependencies and collapse duplicate versions', 'feat(cluster): take adobe-citations live', 'chore(skills): triage findings']) {
    assert.equal(isNoise(subject), false, subject)
  }
})

test('pullRequestNumber and dedupeKey read a trailing (#N) only', () => {
  assert.equal(pullRequestNumber('feat: x (#2404)'), 2404)
  assert.equal(pullRequestNumber('fix: see #12 for context'), null)
  assert.equal(dedupeKey('feat: x (#2404)'), 'feat: x')
  assert.equal(dedupeKey('fix: see #12 for context'), 'fix: see #12 for context')
})

test('webUrl, isGitLab and branchName read remotes and refs', () => {
  assert.equal(webUrl('git@github.com:microlinkhq/skills.git'), 'https://github.com/microlinkhq/skills')
  assert.equal(webUrl('https://github.com/Kikobeats/splashy.git'), 'https://github.com/Kikobeats/splashy')
  assert.equal(webUrl('ssh://git@gitlab.com:22/group/sub/project.git'), 'https://gitlab.com/group/sub/project')
  assert.equal(webUrl(''), null)
  assert.equal(isGitLab('https://gitlab.com/a/b'), true)
  assert.equal(isGitLab('https://code.gitlab.example.org/a/b'), true)
  assert.equal(isGitLab('https://github.example.com/a/b'), false)
  assert.equal(branchName('origin/Kikobeats/input'), 'Kikobeats/input')
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
  const [result] = await checkLinks(['http://127.0.0.1:1/'])
  assert.deepEqual([result.ok, result.status], [false, 0])
})

test('probeUrl checks npm packages through the registry, which answers bots', () => {
  assert.equal(probeUrl('https://www.npmjs.com/package/splashy'), 'https://registry.npmjs.org/splashy')
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
