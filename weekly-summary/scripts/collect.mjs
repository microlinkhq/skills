#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)

const FIELD = '\x1f'
const REMOTE = 'origin'
const DEFAULT_BRANCH_CANDIDATES = [`${REMOTE}/HEAD`, `${REMOTE}/main`, `${REMOTE}/master`]
const GITLAB_MERGE_REQUEST_BRANCH = /^mr\/(\d+)$/
const TRAILING_REVIEW_NUMBER = /\s*\(#(\d+)\)\s*$/
const FORGE_CONCURRENCY = 6
const FORGE_CANDIDATES = 5
const NOISE = [
  /^chore\(release\)/,
  /^chore: release/,
  /^chore\(deps\)/,
  /^build\(deps(-dev)?\)/,
  /^build\(update\)/,
  /^build: contributors$/,
  /^Merge (branch|pull request|remote-tracking)/
]

const USAGE = `Usage:
  collect.mjs --since YYYY-MM-DD [--until YYYY-MM-DD] [--root DIR] [--author TEXT ...] [--json] [--offline]

Lists your non-merge commits on branches of every git repository directly under --root
(default: the current directory), committed from --since (inclusive) to --until
(exclusive, default: today, local time). --author matches a substring of the author name
or email and defaults to the global git user.name and user.email. Release bumps,
dependency bumps, generated data updates and merge commits are dropped, rebased and
squashed copies of a commit are shown once, and clones of the same remote are merged.

Each commit is marked:
  merged             on the default branch of ${REMOTE}, or on a pushed branch whose pull or
                     merge request was merged after the commit was made
  open: BRANCH       on a pushed branch whose pull or merge request is open
  unmerged: BRANCH   on a pushed branch with no open or merged request
  unpushed: BRANCH   only on a local branch
Git answers first; gh (GitHub) and glab (GitLab) are asked about each pushed branch that
git cannot settle, unless --offline. A failed lookup is reported on stderr, never read as
"no request".`

const gitText = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const git = (cwd, args) => {
  try {
    return gitText(cwd, args)
  } catch {
    return ''
  }
}

const gitLog = (cwd, args) => {
  try {
    return gitText(cwd, args)
  } catch (error) {
    const detail = error.stderr?.toString().trim().split('\n')[0]
    throw new Error(detail || error.message.split('\n')[0])
  }
}

const succeeds = (cwd, args) => {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export const isNoise = subject => NOISE.some(pattern => pattern.test(subject))

export const pullRequestNumber = subject => {
  const match = subject.match(TRAILING_REVIEW_NUMBER)
  return match ? Number(match[1]) : null
}

export const dedupeKey = subject => subject.replace(TRAILING_REVIEW_NUMBER, '')

const sameWork = (seen, commit) => {
  if (seen.unpushed && !commit.unpushed) {
    seen.unpushed = false
    seen.branches = [...commit.branches]
    seen.hash = commit.hash
    seen.date = commit.date
    seen.committedAt = commit.committedAt
  } else if (Boolean(seen.unpushed) === Boolean(commit.unpushed)) {
    seen.branches = [...new Set([...seen.branches, ...commit.branches])]
  }
  if (pullRequestNumber(commit.subject) && !pullRequestNumber(seen.subject)) {
    seen.subject = commit.subject
    if (commit.review) seen.review = commit.review
  }
}

export const webUrl = remote => {
  if (!remote) return null
  const match = remote.match(/^(?:git@([^:]+):|(?:https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/)(.+?)(?:\.git)?\/?$/)
  if (!match) return null
  return `https://${match[1] || match[2]}/${match[3]}`
}

export const isGitLab = url => new URL(url).host.split('.').includes('gitlab')

const reviewUrl = (remote, number) => {
  if (!remote || !number) return null
  return isGitLab(remote) ? `${remote}/-/merge_requests/${number}` : `${remote}/pull/${number}`
}

const isCalendarDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

const localToday = () => {
  const now = new Date()
  const pad = number => String(number).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export const parseArgs = argv => {
  const options = { root: process.cwd(), authors: [], json: false, offline: false, since: null, until: null }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    const value = () => {
      const next = argv[++index]
      if (next === undefined) throw new Error(`${flag} needs a value`)
      return next
    }
    if (flag === '--since') options.since = value()
    else if (flag === '--until') options.until = value()
    else if (flag === '--root') options.root = path.resolve(value())
    else if (flag === '--author') options.authors.push(value())
    else if (flag === '--json') options.json = true
    else if (flag === '--offline') options.offline = true
    else throw new Error(`unknown argument: ${flag}`)
  }
  if (!options.since || !isCalendarDate(options.since)) throw new Error('--since YYYY-MM-DD is required')
  options.until ??= localToday()
  if (!isCalendarDate(options.until)) throw new Error('--until must be a YYYY-MM-DD date')
  if (options.since >= options.until) throw new Error('--since must be before --until')
  return options
}

const defaultAuthors = () =>
  ['user.name', 'user.email'].map(key => git(process.cwd(), ['config', '--global', key])).filter(Boolean)

const defaultBranch = repo => DEFAULT_BRANCH_CANDIDATES.find(ref => succeeds(repo, ['rev-parse', '--verify', '--quiet', ref]))

export const branchName = ref => ref.replace(new RegExp(`^(remotes/)?${REMOTE}/`), '')

const refsHolding = (repo, hash) => {
  const refs = git(repo, ['for-each-ref', '--format=%(refname)', '--contains', hash, 'refs/heads', `refs/remotes/${REMOTE}`])
    .split('\n')
  return {
    pushed: [...new Set(refs.filter(ref => ref.startsWith('refs/remotes/')).map(ref => ref.slice(`refs/remotes/${REMOTE}/`.length)))],
    local: [...new Set(refs.filter(ref => ref.startsWith('refs/heads/')).map(ref => ref.slice('refs/heads/'.length)))]
  }
}

export const mergeAddsNothing = (repo, branch, base) => {
  const ref = `${REMOTE}/${branch}`
  const merged = git(repo, ['merge-tree', '--write-tree', base, ref]).split('\n')[0]
  return Boolean(merged) && merged === git(repo, ['rev-parse', `${base}^{tree}`])
}

const byDateThenSubject = (a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject)

const describeLocation = ({ pushed, local }) => {
  if (pushed.length > 0) return { branches: pushed, unpushed: false }
  return { branches: local, unpushed: true }
}

export const collectRepo = (repo, { since, until, authors }) => {
  const log = gitLog(repo, [
    'log', '--branches', `--remotes=${REMOTE}`, '--no-merges', '--fixed-strings',
    `--since=${since}T00:00:00`, `--until=${until}T00:00:00`,
    ...authors.map(author => `--author=${author}`),
    `--format=%H${FIELD}%cI${FIELD}%s`
  ])
  if (!log) return []

  const ends = new Date(`${until}T00:00:00`).getTime()
  const base = defaultBranch(repo)
  const remote = webUrl(git(repo, ['remote', 'get-url', REMOTE]))
  const landed = new Map()
  const isLanded = branch => {
    if (!landed.has(branch)) landed.set(branch, mergeAddsNothing(repo, branch, base))
    return landed.get(branch)
  }
  const byKey = new Map()

  for (const line of log.split('\n')) {
    const [hash, committedAt, subject] = line.split(FIELD)
    if (new Date(committedAt).getTime() >= ends) continue
    if (isNoise(subject)) continue
    const onBase = succeeds(repo, ['merge-base', '--is-ancestor', hash, base])
    const holding = onBase ? { pushed: [], local: [] } : refsHolding(repo, hash)
    const merged = onBase || holding.pushed.some(isLanded)
    const commit = {
      hash,
      date: committedAt.slice(0, 10),
      committedAt,
      subject,
      merged,
      ...(merged ? { branches: [], unpushed: false } : describeLocation(holding))
    }
    const key = dedupeKey(subject)
    const seen = byKey.get(key)
    if (!seen) {
      byKey.set(key, commit)
      continue
    }
    if (commit.merged && !seen.merged) {
      byKey.set(key, { ...commit, subject: pullRequestNumber(subject) ? subject : seen.subject })
    } else if (!commit.merged && !seen.merged) {
      sameWork(seen, commit)
    }
    const kept = byKey.get(key)
    if (pullRequestNumber(subject) && !pullRequestNumber(kept.subject)) kept.subject = subject
  }

  return [...byKey.values()]
    .map(commit => ({ ...commit, review: reviewUrl(remote, pullRequestNumber(commit.subject)) }))
    .sort(byDateThenSubject)
}

export const mergeClones = repos => {
  const byUrl = new Map()
  for (const repo of repos) {
    const key = repo.url ?? repo.name
    const seen = byUrl.get(key)
    if (!seen) {
      byUrl.set(key, { ...repo, commits: [...repo.commits] })
      continue
    }
    for (const commit of repo.commits) {
      const index = seen.commits.findIndex(existing => dedupeKey(existing.subject) === dedupeKey(commit.subject))
      if (index === -1) seen.commits.push(commit)
      else if (commit.merged && !seen.commits[index].merged) {
        const kept = seen.commits[index]
        const subject = pullRequestNumber(commit.subject) ? commit.subject : kept.subject
        seen.commits[index] = { ...commit, subject, review: pullRequestNumber(commit.subject) ? commit.review : kept.review }
      } else if (!commit.merged && !seen.commits[index].merged) {
        sameWork(seen.commits[index], commit)
      } else if (pullRequestNumber(commit.subject) && !pullRequestNumber(seen.commits[index].subject)) {
        seen.commits[index].subject = commit.subject
        seen.commits[index].review = commit.review
      }
    }
    seen.commits.sort(byDateThenSubject)
  }
  return [...byUrl.values()]
}

const forgeRepo = url => {
  const { host, pathname } = new URL(url)
  return `${host}${pathname}`
}

const readJson = async (command, args) => {
  const { stdout } = await run(command, args, { maxBuffer: 4 * 1024 * 1024 })
  return JSON.parse(stdout)
}

const normalizeState = state => {
  const value = String(state).toLowerCase()
  if (value === 'merged') return 'merged'
  if (value === 'open' || value === 'opened') return 'open'
  return 'closed'
}

export const lookupReview = async (url, branch) => {
  if (isGitLab(url)) {
    const number = branch.match(GITLAB_MERGE_REQUEST_BRANCH)?.[1]
    const found = number
      ? await readJson('glab', ['mr', 'view', number, '-R', url, '--output', 'json'])
      : await readJson('glab', ['mr', 'list', '-R', url, '--source-branch', branch, '--all', '--output', 'json'])
    const requests = (Array.isArray(found) ? found : [found]).filter(item => item?.iid && item.source_project_id === item.target_project_id)
    return requests.map(request => ({ state: normalizeState(request.state), url: request.web_url ?? reviewUrl(url, request.iid), mergedAt: request.merged_at ?? null }))
  }
  const found = await readJson('gh', [
    'pr', 'list', '--repo', forgeRepo(url), '--head', branch, '--state', 'all',
    '--json', 'number,state,url,mergedAt,isCrossRepository', '--limit', String(FORGE_CANDIDATES)
  ])
  return found.filter(item => !item.isCrossRepository).map(request => ({
    state: normalizeState(request.state),
    url: request.url,
    mergedAt: request.mergedAt ?? null
  }))
}

const mapWithConcurrency = async (items, limit, task) => {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const landedBefore = (review, commit) =>
  review.state === 'merged' &&
  (review.mergedAt ? new Date(review.mergedAt) >= new Date(commit.committedAt) : !commit.unpushed)

const DEFAULT_BRANCH_NAMES = new Set(['main', 'master'])

export const resolveReviews = async (repos, lookup = lookupReview) => {
  const pending = repos
    .filter(repo => repo.url)
    .flatMap(repo =>
      [...new Set(repo.commits.filter(commit => !commit.merged).flatMap(commit => commit.branches))]
        .filter(branch => !DEFAULT_BRANCH_NAMES.has(branch))
        .map(branch => ({ repo, branch }))
    )
  const failures = []
  const answers = await mapWithConcurrency(pending, FORGE_CONCURRENCY, async ({ repo, branch }) => {
    try {
      return await lookup(repo.url, branch)
    } catch (error) {
      failures.push(`${repo.name} ${branch}: ${error.message.split('\n')[0]}`)
      return { state: 'unknown' }
    }
  })
  const reviewOf = new Map(pending.map(({ repo, branch }, index) => [`${repo.url}\n${branch}`, answers[index]]))

  for (const repo of repos) {
    for (const commit of repo.commits) {
      if (commit.merged) continue
      const reviews = commit.branches.flatMap(branch => {
        const answer = reviewOf.get(`${repo.url}\n${branch}`)
        if (!answer) return []
        return Array.isArray(answer) ? answer : [answer]
      })
      const mergedReview = reviews.find(review => landedBefore(review, commit))
      if (mergedReview) {
        Object.assign(commit, { merged: true, unpushed: false, branches: [] })
        commit.review ??= mergedReview.url
        continue
      }
      if (commit.unpushed) continue
      const openReview = reviews.find(review => review.state === 'open')
      if (openReview) {
        commit.open = true
        commit.review ??= openReview.url
      }
      if (reviews.some(review => review.state === 'unknown')) commit.lookupFailed = true
    }
  }
  return failures
}

export let collectionFailures = []

export const collect = ({ root, since, until, authors }) => {
  collectionFailures = []
  return mergeClones(
    readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(path.join(root, entry.name, '.git')))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(entry => {
        const repo = path.join(root, entry.name)
        try {
          return {
            name: entry.name,
            url: webUrl(git(repo, ['remote', 'get-url', REMOTE])),
            commits: collectRepo(repo, { since, until, authors })
          }
        } catch (error) {
          collectionFailures.push(`${entry.name}: ${error.message}`)
          return null
        }
      })
      .filter(repo => repo && repo.commits.length > 0)
  ).sort((a, b) => b.commits.length - a.commits.length || a.name.localeCompare(b.name))
}

const describeState = commit => {
  if (commit.merged) return 'merged'
  const where = commit.branches.join(', ')
  if (commit.unpushed) return `unpushed: ${where}`
  if (commit.open) return `open: ${where}`
  return `unmerged: ${where}${commit.lookupFailed ? ', lookup failed' : ''}`
}

export const toMarkdown = (repos, { since, until }) => {
  const lines = [`# Commits from ${since} to ${until} (exclusive)`, '']
  for (const repo of repos) {
    lines.push(`## ${repo.name} (${repo.commits.length})${repo.url ? ` ${repo.url}` : ''}`)
    for (const commit of repo.commits) {
      lines.push(`- ${commit.date} ${commit.subject} [${describeState(commit)}]${commit.review ? ` ${commit.review}` : ''}`)
    }
    lines.push('')
  }
  if (repos.length === 0) lines.push('No commits in this range.')
  return lines.join('\n')
}

const main = async argv => {
  if (argv.length === 0 || argv.includes('--help')) {
    console.log(USAGE)
    return argv.length === 0 ? 1 : 0
  }
  const options = parseArgs(argv)
  if (options.authors.length === 0) options.authors = defaultAuthors()
  if (options.authors.length === 0) throw new Error('no --author given and no global git user.name or user.email')
  const repos = collect(options)
  for (const failure of collectionFailures) console.error(`collect.mjs: ${failure}`)
  const failures = options.offline ? [] : await resolveReviews(repos)
  for (const failure of failures) console.error(`collect.mjs: lookup failed for ${failure}`)
  console.log(options.json ? JSON.stringify(repos, null, 2) : toMarkdown(repos, options))
  return 0
}

const entry = process.argv[1]
if (entry !== '-' && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    console.error(`collect.mjs: ${error.message}`)
    process.exitCode = 1
  }
}
