#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE_EXTENSION = /\.(md|mdx|js|jsx|ts|tsx|astro|vue|svelte|html)$/
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.cache', 'public', 'dist', 'build', '.next'])
const DEFAULT_DIRS = ['src', 'content', 'app', 'pages', 'docs']
const MAX_LISTED_SOURCES = 6

const USAGE = `Usage:
  inbound.mjs [--dir DIR ...] [--origin URL] /route [/route ...]

Run it from the repo root. Counts the source files that link to each route. Without --dir it scans
${DEFAULT_DIRS.join(', ')} under the current directory, when they exist.`

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const sitePrefix = origin => {
  if (!origin) return ''
  const host = new URL(origin).host.replace(/^www\./, '')
  return String.raw`(?:(?:https?:)?\/\/(?:www\.)?${escapeRegExp(host)})?`
}

export const linkPattern = origin => {
  const site = sitePrefix(origin)
  return new RegExp(
    String.raw`(?:\]\(\s*<?|\b(?:href|to)\s*=\s*\{?\s*["'\x60]|\bhref\s*:\s*["'\x60]|^ {0,3}\[[^\]\n]+\]:\s*<?)${site}(\/(?!\/)[^)"'\x60\s#?>]*)`,
    'gm'
  )
}

const FENCED_CODE = /^([ \t]*)(\x60{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm
const MARKDOWN_FILE = /\.mdx?$/

const readLinkable = file => {
  const source = readFileSync(file, 'utf8')
  return MARKDOWN_FILE.test(file) ? source.replace(FENCED_CODE, '') : source
}

export const normalizeRoute = route => route.replace(/(.)\/+$/, '$1')

export const listSources = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (SKIPPED_DIRS.has(entry.name)) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSources(full)
    return SOURCE_EXTENSION.test(entry.name) ? [full] : []
  })

export const inboundIndex = (files, { origin, root = process.cwd() } = {}) => {
  const pattern = linkPattern(origin)
  const index = new Map()
  for (const file of files) {
    for (const [, link] of readLinkable(file).matchAll(pattern)) {
      const route = normalizeRoute(link)
      if (!index.has(route)) index.set(route, new Set())
      index.get(route).add(path.relative(root, file))
    }
  }
  return index
}

const main = args => {
  const dirs = []
  const routes = []
  let origin
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') dirs.push(args[++i])
    else if (args[i] === '--origin') origin = args[++i]
    else routes.push(args[i])
  }
  if (!routes.length) {
    console.error(USAGE)
    process.exit(1)
  }
  const scanned = (dirs.length ? dirs : DEFAULT_DIRS).filter(dir => existsSync(dir))
  const index = inboundIndex(scanned.flatMap(listSources), { origin })
  for (const route of routes) {
    const sources = [...(index.get(normalizeRoute(route)) ?? [])]
    console.log(`${sources.length}\t${route}\t${sources.slice(0, MAX_LISTED_SOURCES).join(', ')}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
