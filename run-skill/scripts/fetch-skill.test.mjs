import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRef, pickSkillEntry } from './fetch-skill.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = readdirSync(HERE).filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs')).sort()

test('parseRef: skills.sh URL with skill', () => {
  assert.deepEqual(
    parseRef('https://www.skills.sh/addyosmani/web-quality-skills/seo'),
    { owner: 'addyosmani', repo: 'web-quality-skills', skill: 'seo' }
  )
})

test('parseRef: skills.sh URL without www and with trailing slash', () => {
  assert.deepEqual(parseRef('https://skills.sh/vercel-labs/skills/'), {
    owner: 'vercel-labs',
    repo: 'skills',
    skill: undefined
  })
})

test('parseRef: github repo URL', () => {
  assert.deepEqual(parseRef('https://github.com/microlinkhq/skills'), {
    owner: 'microlinkhq',
    repo: 'skills'
  })
})

test('parseRef: github tree URL with branch and path', () => {
  assert.deepEqual(
    parseRef('https://github.com/microlinkhq/skills/tree/master/optimo'),
    { owner: 'microlinkhq', repo: 'skills', branch: 'master', path: 'optimo' }
  )
})

test('parseRef: github blob URL pointing at SKILL.md', () => {
  assert.deepEqual(
    parseRef(
      'https://github.com/microlinkhq/skills/blob/master/optimo/SKILL.md'
    ),
    { owner: 'microlinkhq', repo: 'skills', branch: 'master', path: 'optimo' }
  )
})

test('parseRef: raw github URL pointing at root SKILL.md', () => {
  assert.deepEqual(
    parseRef('https://raw.githubusercontent.com/foo/bar/main/SKILL.md'),
    { owner: 'foo', repo: 'bar', branch: 'main', path: undefined }
  )
})

test('parseRef: owner/repo/skill shorthand', () => {
  assert.deepEqual(parseRef('microlinkhq/skills/optimo'), {
    owner: 'microlinkhq',
    repo: 'skills',
    skill: 'optimo'
  })
})

test('parseRef: owner-only shorthand throws', () => {
  assert.throws(() => parseRef('microlinkhq'), /Cannot parse skill reference/)
})

test('parseRef: unsupported host throws', () => {
  assert.throws(
    () => parseRef('https://gitlab.com/foo/bar'),
    /Unsupported host/
  )
})

test('pickSkillEntry: matches skill by directory name at any depth', () => {
  const paths = [
    'README.md',
    'skills/seo/SKILL.md',
    'skills/perf/SKILL.md',
    'skills/seo/references/checklist.md'
  ]
  assert.equal(
    pickSkillEntry(paths, { skill: 'seo' }),
    'skills/seo/SKILL.md'
  )
})

test('pickSkillEntry: prefers shallowest match on name collision', () => {
  const paths = ['seo/SKILL.md', 'archive/seo/SKILL.md']
  assert.equal(pickSkillEntry(paths, { skill: 'seo' }), 'seo/SKILL.md')
})

test('pickSkillEntry: skill name matching is case-insensitive', () => {
  const paths = ['skills/SEO/SKILL.md']
  assert.equal(pickSkillEntry(paths, { skill: 'seo' }), 'skills/SEO/SKILL.md')
})

test('pickSkillEntry: explicit path wins', () => {
  const paths = ['optimo/SKILL.md', 'commit/SKILL.md']
  assert.equal(pickSkillEntry(paths, { path: 'optimo' }), 'optimo/SKILL.md')
})

test('pickSkillEntry: path resolves nested single entry', () => {
  const paths = ['packages/a/SKILL.md', 'packages/b/SKILL.md']
  assert.equal(
    pickSkillEntry(paths, { path: 'packages/a' }),
    'packages/a/SKILL.md'
  )
})

test('pickSkillEntry: single entry needs no selector', () => {
  assert.equal(pickSkillEntry(['nested/dir/SKILL.md'], {}), 'nested/dir/SKILL.md')
})

test('pickSkillEntry: root SKILL.md wins when no selector given', () => {
  const paths = ['SKILL.md', 'examples/demo/SKILL.md']
  assert.equal(pickSkillEntry(paths, {}), 'SKILL.md')
})

test('pickSkillEntry: ambiguous without selector throws listing skills', () => {
  const paths = ['a/SKILL.md', 'b/SKILL.md']
  assert.throws(() => pickSkillEntry(paths, {}), /Available: a, b/)
})

test('pickSkillEntry: unknown skill throws listing skills', () => {
  const paths = ['a/SKILL.md', 'b/SKILL.md']
  assert.throws(
    () => pickSkillEntry(paths, { skill: 'zzz' }),
    /Skill "zzz" not found. Available: a, b/
  )
})

test('pickSkillEntry: no SKILL.md at all throws', () => {
  assert.throws(() => pickSkillEntry(['README.md'], {}), /No SKILL.md found/)
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

test('importing a script with no process entry does not crash', () => {
  for (const script of SCRIPTS) {
    const child = spawnSync(process.execPath, ['--throw-deprecation', '--input-type=module'], {
      encoding: 'utf8',
      input: `await import(${JSON.stringify(path.join(HERE, script))})\n`
    })
    assert.equal(child.status, 0, `${script}\n${child.stderr}`)
  }
})

test('a missing argv path does not crash the import', () => {
  for (const script of SCRIPTS) {
    const child = spawnSync(process.execPath, ['-e', `await import(${JSON.stringify(path.join(HERE, script))})`, '/no/such/file'], { encoding: 'utf8' })
    assert.equal(child.status, 0, `${script}\n${child.stderr}`)
    assert.doesNotMatch(child.stdout + child.stderr, /Usage:/, script)
  }
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
