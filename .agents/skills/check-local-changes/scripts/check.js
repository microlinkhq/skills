#!/usr/bin/env node
'use strict'

/**
 * Validates uncommitted changes in the microlinkhq/skills repo.
 *
 * Failures (exit 1) are scoped to files touched by the working tree so the
 * check stays green on pre-existing drift, which is reported as warnings.
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
const README = path.join(ROOT, 'README.md')

const IGNORED_DIRS = new Set(['node_modules', '.git', '.agents', '.claude'])
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_DESCRIPTION = 1024

const failures = []
const warnings = []

const changedPaths = () =>
  execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const entry = line.slice(3)
      // renames are reported as "old -> new"; the new path is what gets committed
      const arrow = entry.indexOf(' -> ')
      return arrow === -1 ? entry : entry.slice(arrow + 4)
    })

const parseFrontmatter = file => {
  const content = fs.readFileSync(file, 'utf8')
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const fields = {}
  for (const line of match[1].split('\n')) {
    const sep = line.indexOf(':')
    if (sep > 0 && !/^\s/.test(line)) {
      fields[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
    }
  }
  return fields
}

const skillDirs = () =>
  fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && !IGNORED_DIRS.has(d.name))
    .map(d => d.name)

const readmeSections = () => {
  const content = fs.readFileSync(README, 'utf8')
  return [...content.matchAll(/^### (.+)$/gm)].map(m => m[1].trim())
}

const readmeAddedSections = () => {
  const diff = execSync('git diff HEAD -- README.md', { cwd: ROOT, encoding: 'utf8' })
  return [...diff.matchAll(/^\+### (.+)$/gm)].map(m => m[1].trim())
}

const checkSkill = name => {
  const skillFile = path.join(ROOT, name, 'SKILL.md')

  if (!fs.existsSync(skillFile)) {
    failures.push(`${name}/SKILL.md is missing`)
    return
  }

  const fields = parseFrontmatter(skillFile)
  if (!fields) {
    failures.push(`${name}/SKILL.md has no YAML frontmatter`)
    return
  }

  if (!fields.name) failures.push(`${name}/SKILL.md frontmatter is missing \`name\``)
  else if (fields.name !== name) {
    failures.push(`${name}/SKILL.md frontmatter name is \`${fields.name}\`, expected \`${name}\``)
  }
  if (fields.name && !KEBAB_CASE.test(fields.name)) {
    failures.push(`${name}/SKILL.md name \`${fields.name}\` is not kebab-case`)
  }

  if (!fields.description) {
    failures.push(`${name}/SKILL.md frontmatter is missing \`description\``)
  } else if (fields.description.length > MAX_DESCRIPTION) {
    failures.push(
      `${name}/SKILL.md description is ${fields.description.length} chars (max ${MAX_DESCRIPTION})`
    )
  }

  const readme = fs.readFileSync(README, 'utf8')
  if (!readme.includes(`### ${name}`)) {
    failures.push(`README.md has no \`### ${name}\` section`)
  } else if (!readme.includes(`skills add microlinkhq/skills/${name}`)) {
    failures.push(`README.md \`### ${name}\` section has no install command`)
  }
}

const main = () => {
  const changed = changedPaths()

  if (changed.length === 0) {
    console.log('working tree is clean — nothing to check')
    return
  }

  const junk = changed.filter(p => /(^|\/)(\.DS_Store|node_modules(\/|$))/.test(p))
  for (const p of junk) failures.push(`junk file staged for commit: ${p}`)

  const touchedSkills = [
    ...new Set(
      changed
        .map(p => p.split('/')[0].replace(/\/$/, ''))
        .filter(top => !IGNORED_DIRS.has(top) && !top.startsWith('.'))
        .filter(top => {
          try {
            return fs.statSync(path.join(ROOT, top)).isDirectory()
          } catch {
            return false
          }
        })
    )
  ]

  for (const name of touchedSkills) checkSkill(name)

  const dirs = skillDirs()
  const sections = readmeSections()
  const addedSections = changed.includes('README.md') ? readmeAddedSections() : []

  for (const section of sections) {
    if (dirs.includes(section)) continue
    const message = `README.md lists \`${section}\` but the directory does not exist`
    ;(addedSections.includes(section) ? failures : warnings).push(message)
  }

  for (const dir of dirs) {
    if (sections.includes(dir)) continue
    if (!fs.existsSync(path.join(ROOT, dir, 'SKILL.md'))) {
      warnings.push(`\`${dir}/\` has no SKILL.md and no README entry — dead directory?`)
    } else if (!touchedSkills.includes(dir)) {
      warnings.push(`\`${dir}/\` has a SKILL.md but no README.md entry`)
    }
  }

  console.log(`checked ${changed.length} changed path(s), ${touchedSkills.length} skill(s): ${touchedSkills.join(', ') || 'none'}`)

  for (const w of warnings) console.log(`⚠ ${w}`)
  for (const f of failures) console.error(`✗ ${f}`)

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s)`)
    process.exit(1)
  }

  console.log('✓ all checks passed')
}

main()
