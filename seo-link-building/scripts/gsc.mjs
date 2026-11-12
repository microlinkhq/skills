#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const STRIKING_MIN_POSITION = 10.5
const STRIKING_MAX_POSITION = 20.5
const TOP_MAX_POSITION = 10.5
const DEFAULT_MIN_IMPRESSIONS = 500
const DEFAULT_MAX_CTR = 3

const USAGE = `Usage:
  gsc.mjs striking <file.csv> [--min-impressions N] [--origin URL]
  gsc.mjs ctr      <file.csv> [--min-impressions N] [--max-ctr PCT] [--origin URL]

<file.csv> is a Search Console Performance export table (pages or queries),
in any UI language: columns are read by position (key, clicks, impressions, CTR, position).`

export const parseCsvLine = line => {
  const cells = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted && char === '"' && line[i + 1] === '"') {
      cell += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells
}

export const parseCount = value => Number(String(value).replace(/\D/g, ''))

export const parseNumber = value =>
  Number(
    String(value)
      .replace(/[%\s ]/g, '')
      .replace(',', '.')
  )

export const parseRows = csv =>
  csv
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .slice(1)
    .filter(line => line.trim())
    .map(line => {
      const [key, clicks, impressions, ctr, position] = parseCsvLine(line)
      return {
        key,
        clicks: parseCount(clicks),
        impressions: parseCount(impressions),
        ctr: parseNumber(ctr),
        position: parseNumber(position)
      }
    })

const byImpressions = (a, b) => b.impressions - a.impressions

export const strikingDistance = (rows, { minImpressions = DEFAULT_MIN_IMPRESSIONS } = {}) =>
  rows
    .filter(
      row =>
        row.position >= STRIKING_MIN_POSITION &&
        row.position <= STRIKING_MAX_POSITION &&
        row.impressions >= minImpressions
    )
    .sort(byImpressions)

export const lowCtr = (
  rows,
  { minImpressions = DEFAULT_MIN_IMPRESSIONS, maxCtr = DEFAULT_MAX_CTR } = {}
) =>
  rows
    .filter(
      row =>
        row.position < TOP_MAX_POSITION &&
        row.impressions >= minImpressions &&
        row.ctr <= maxCtr
    )
    .sort(byImpressions)
    .map(row => ({ ...row, clicksPerCtrPoint: Math.round(row.impressions / 100) }))

const bareHost = url => url.host.replace(/^www\./, '')

export const stripOrigin = (key, origin) => {
  if (!origin || !URL.canParse(key)) return key
  const url = new URL(key)
  if (bareHost(url) !== bareHost(new URL(origin))) return key
  return url.pathname
}

const readFlag = (args, name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

const main = args => {
  const [mode, file] = args
  if (!['striking', 'ctr'].includes(mode) || !file) {
    console.error(USAGE)
    process.exit(1)
  }
  const minImpressions = Number(readFlag(args, '--min-impressions', DEFAULT_MIN_IMPRESSIONS))
  const maxCtr = Number(readFlag(args, '--max-ctr', DEFAULT_MAX_CTR))
  if (!Number.isFinite(minImpressions) || !Number.isFinite(maxCtr)) {
    console.error(USAGE)
    process.exit(1)
  }
  const origin = readFlag(args, '--origin')
  const rows = parseRows(readFileSync(file, 'utf8'))
  const hits =
    mode === 'striking'
      ? strikingDistance(rows, { minImpressions })
      : lowCtr(rows, { minImpressions, maxCtr })
  const columns =
    mode === 'striking'
      ? ['impressions', 'clicks', 'position', 'key']
      : ['impressions', 'ctr', 'position', 'clicksPerCtrPoint', 'key']
  console.log(columns.join('\t'))
  for (const row of hits) {
    console.log(
      columns
        .map(column => (column === 'key' ? stripOrigin(row.key, origin) : row[column]))
        .join('\t')
    )
  }
  console.error(`${hits.length} of ${rows.length} rows`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
