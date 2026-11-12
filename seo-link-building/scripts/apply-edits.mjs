#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const USAGE = `Usage:
  apply-edits.mjs <edits.json> [--dry-run]

<edits.json> is an array of { "file", "from", "to" }. Every "from" must be a
non-empty string and every "to" a string, occur exactly once in the original
file and at the moment it is applied, and not touch text an earlier edit
inserted. A file that cannot be read is a failed edit. If any edit fails,
nothing is written.`

const countOccurrences = (source, needle) => source.split(needle).length - 1

export const planEdits = (edits, read = file => readFileSync(file, 'utf8')) => {
  const originals = new Map()
  const contents = new Map()
  const inserted = new Map()
  const failures = []
  for (const { file, from, to } of edits) {
    const key = path.normalize(file)
    if (!originals.has(key)) {
      let text
      try {
        text = read(key)
      } catch {
        failures.push({ file: key, from, count: 0 })
        continue
      }
      originals.set(key, text)
      contents.set(key, text)
      inserted.set(key, [])
    }
    const needle = typeof from === 'string' ? from : ''
    const source = contents.get(key)
    const count = needle ? countOccurrences(source, needle) : 0
    const originalCount = needle ? countOccurrences(originals.get(key), needle) : 0
    const index = needle ? source.indexOf(needle) : -1
    const ranges = inserted.get(key)
    const overlaps = index >= 0 && ranges.some(([start, stop]) => index < stop && index + needle.length > start)
    if (needle.length === 0 || typeof to !== 'string' || count !== 1 || originalCount !== 1 || overlaps) {
      failures.push({ file: key, from, count: Math.max(count, originalCount) })
      continue
    }
    const end = index + needle.length
    const delta = to.length - needle.length
    contents.set(key, source.slice(0, index) + to + source.slice(end))
    inserted.set(key, [
      ...ranges.flatMap(([start, stop]) => {
        if (stop <= index) return [[start, stop]]
        if (start >= end) return [[start + delta, stop + delta]]
        return []
      }),
      [index, index + to.length]
    ])
  }
  return { contents, failures }
}

const main = args => {
  const [editsFile] = args
  if (!editsFile) {
    console.error(USAGE)
    process.exit(1)
  }
  const edits = JSON.parse(readFileSync(editsFile, 'utf8'))
  const { contents, failures } = planEdits(edits)
  for (const { file, from, count } of failures) {
    console.error(`SKIP ${count}x ${file}: ${String(from ?? '').slice(0, 80)}`)
  }
  if (failures.length) {
    console.error(`${failures.length} of ${edits.length} edits did not match exactly once; nothing written`)
    process.exit(1)
  }
  if (!args.includes('--dry-run')) {
    for (const [file, content] of contents) writeFileSync(file, content)
  }
  console.log(`${edits.length} edits ${args.includes('--dry-run') ? 'would apply' : 'applied'} across ${contents.size} files`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
