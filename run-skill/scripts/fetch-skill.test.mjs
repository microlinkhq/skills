import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRef, pickSkillEntry } from './fetch-skill.mjs'

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
