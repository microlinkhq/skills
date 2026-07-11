#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const MAX_FILES = 200
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

const SKILL_ENTRY = /(^|\/)skill\.md$/i

const skillDirOf = entry =>
  entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : ''

export const parseRef = input => {
  const value = String(input).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(value)) {
    const parts = value.split('/').filter(Boolean)
    if (parts.length < 2) {
      throw new Error(`Cannot parse skill reference: ${input}`)
    }
    return {
      owner: parts[0],
      repo: parts[1],
      skill: parts.slice(2).join('/') || undefined
    }
  }
  const url = new URL(value)
  const host = url.hostname.replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  if (host === 'skills.sh') {
    if (parts.length < 2) {
      throw new Error(`Cannot parse skills.sh URL: ${input}`)
    }
    return {
      owner: parts[0],
      repo: parts[1],
      skill: parts.slice(2).join('/') || undefined
    }
  }
  if (host === 'github.com') {
    if (parts.length < 2) {
      throw new Error(`Cannot parse GitHub URL: ${input}`)
    }
    const [owner, repo, kind, branch, ...rest] = parts
    if ((kind === 'tree' || kind === 'blob') && branch) {
      let path = rest.join('/')
      if (SKILL_ENTRY.test(path)) path = skillDirOf(path)
      return { owner, repo, branch, path: path || undefined }
    }
    return { owner, repo }
  }
  if (host === 'raw.githubusercontent.com') {
    if (parts.length < 3) {
      throw new Error(`Cannot parse raw GitHub URL: ${input}`)
    }
    const [owner, repo, branch, ...rest] = parts
    let path = rest.join('/')
    if (SKILL_ENTRY.test(path)) path = skillDirOf(path)
    return { owner, repo, branch, path: path || undefined }
  }
  throw new Error(`Unsupported host: ${url.hostname}`)
}

export const pickSkillEntry = (paths, { skill, path } = {}) => {
  const entries = paths.filter(p => SKILL_ENTRY.test(p))
  if (entries.length === 0) {
    throw new Error('No SKILL.md found in repository')
  }
  const available = () =>
    entries.map(e => skillDirOf(e) || '(root)').join(', ')
  if (path) {
    const match =
      entries.find(e => skillDirOf(e) === path) ??
      entries
        .filter(e => e.startsWith(`${path}/`))
        .sort((a, b) => a.length - b.length)[0]
    if (match) return match
    throw new Error(`No SKILL.md under "${path}". Available: ${available()}`)
  }
  if (skill) {
    const target = skill.toLowerCase()
    const matches = entries.filter(e => {
      const dir = skillDirOf(e).toLowerCase()
      return dir === target || dir.endsWith(`/${target}`)
    })
    if (matches.length > 0) {
      return matches.sort(
        (a, b) => a.split('/').length - b.split('/').length
      )[0]
    }
    throw new Error(`Skill "${skill}" not found. Available: ${available()}`)
  }
  if (entries.length === 1) return entries[0]
  const rootEntry = entries.find(e => !e.includes('/'))
  if (rootEntry) return rootEntry
  throw new Error(`Multiple skills found, specify one. Available: ${available()}`)
}

const ghHeaders = () => {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  return {
    'user-agent': 'run-skill',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  }
}

const ghJson = async url => {
  const res = await fetch(url, {
    headers: { ...ghHeaders(), accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`)
  return res.json()
}

const main = async () => {
  const args = process.argv.slice(2)
  const flags = { out: undefined, list: false }
  const positional = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') flags.out = args[++i]
    else if (args[i] === '--list') flags.list = true
    else positional.push(args[i])
  }
  const [ref] = positional
  if (!ref) {
    console.error(
      'Usage: fetch-skill.mjs <skills.sh url | github url | owner/repo[/skill]> [--out <dir>] [--list]'
    )
    process.exit(1)
  }
  const parsed = parseRef(ref)
  const branch =
    parsed.branch ??
    (await ghJson(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`))
      .default_branch
  const tree = await ghJson(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  )
  const blobs = tree.tree.filter(node => node.type === 'blob')
  const paths = blobs.map(node => node.path)
  if (flags.list) {
    console.log(
      JSON.stringify(
        {
          owner: parsed.owner,
          repo: parsed.repo,
          branch,
          skills: paths
            .filter(p => SKILL_ENTRY.test(p))
            .map(p => skillDirOf(p) || '(root)')
        },
        null,
        2
      )
    )
    return
  }
  const entry = pickSkillEntry(paths, parsed)
  const dir = skillDirOf(entry)
  const inScope = blobs.filter(node =>
    dir === '' ? true : node.path === entry || node.path.startsWith(`${dir}/`)
  )
  const ordered = [...inScope].sort((a, b) =>
    a.path === entry ? -1 : b.path === entry ? 1 : a.path.localeCompare(b.path)
  )
  const selected = []
  const skipped = []
  let total = 0
  for (const node of ordered) {
    if (
      selected.length >= MAX_FILES ||
      total + (node.size ?? 0) > MAX_TOTAL_BYTES
    ) {
      skipped.push(node.path)
      continue
    }
    selected.push(node)
    total += node.size ?? 0
  }
  const root = join(
    flags.out ?? join(tmpdir(), 'run-skill'),
    parsed.owner,
    parsed.repo
  )
  for (const node of selected) {
    const res = await fetch(
      `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${node.path}`,
      { headers: ghHeaders() }
    )
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${node.path}`)
    const local = join(root, node.path)
    await mkdir(dirname(local), { recursive: true })
    await writeFile(local, Buffer.from(await res.arrayBuffer()))
  }
  console.log(
    JSON.stringify(
      {
        name: dir.split('/').pop() || parsed.repo,
        owner: parsed.owner,
        repo: parsed.repo,
        branch,
        skillMd: join(root, entry),
        dir: join(root, dir),
        files: selected.map(node => node.path),
        skipped,
        truncatedTree: Boolean(tree.truncated)
      },
      null,
      2
    )
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}
