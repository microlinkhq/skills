import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { lowCtr, parseCount, parseCsvLine, parseNumber, parseRows, stripOrigin, strikingDistance } from './gsc.mjs'
import { inboundIndex, listSources, normalizeRoute } from './inbound.mjs'
import { planEdits } from './apply-edits.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.join(HERE, '..', 'templates', 'internal-links.test.mjs')

const withTempDir = run => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seo-link-building-'))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const writeTree = (root, files) => {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
}

test('parseCsvLine keeps commas inside quoted cells', () => {
  assert.deepEqual(parseCsvLine('"pdf, html",1,2,"3,5 %",4'), ['pdf, html', '1', '2', '3,5 %', '4'])
  assert.deepEqual(parseCsvLine('"say ""hi""",1'), ['say "hi"', '1'])
})

test('parseNumber reads dot and comma decimals and percentages', () => {
  assert.equal(parseNumber('2.47%'), 2.47)
  assert.equal(parseNumber('2,47 %'), 2.47)
  assert.equal(parseNumber('7.9'), 7.9)
  assert.equal(parseNumber('1200'), 1200)
  assert.equal(parseCount('1,234'), 1234)
  assert.equal(parseCount('1.234.567'), 1234567)
})

test('parseRows ignores the localized header and a BOM', () => {
  const rows = parseRows('﻿Páginas principales,Clics,Impresiones,CTR,Posición\nhttps://a.test/x,10,1000,1%,12.3\n\n')
  assert.deepEqual(rows, [{ key: 'https://a.test/x', clicks: 10, impressions: 1000, ctr: 1, position: 12.3 }])
})

const ROWS = [
  { key: '/top', clicks: 50, impressions: 5000, ctr: 1, position: 3 },
  { key: '/good-ctr', clicks: 900, impressions: 9000, ctr: 10, position: 2 },
  { key: '/near', clicks: 5, impressions: 2000, ctr: 0.25, position: 14 },
  { key: '/nearer', clicks: 5, impressions: 3000, ctr: 0.2, position: 10.6 },
  { key: '/edge-out', clicks: 1, impressions: 4000, ctr: 0, position: 20.6 },
  { key: '/small', clicks: 1, impressions: 10, ctr: 10, position: 15 }
]

test('strikingDistance keeps positions 11 to 20 above the impression floor, biggest first', () => {
  assert.deepEqual(strikingDistance(ROWS).map(row => row.key), ['/nearer', '/near'])
  assert.deepEqual(strikingDistance(ROWS, { minImpressions: 1 }).map(row => row.key), ['/nearer', '/near', '/small'])
})

test('lowCtr keeps first-page rows under the CTR ceiling and sizes one CTR point', () => {
  const hits = lowCtr(ROWS)
  assert.deepEqual(hits.map(row => row.key), ['/top'])
  assert.equal(hits[0].clicksPerCtrPoint, 50)
})

test('stripOrigin turns a full URL into a route', () => {
  assert.equal(stripOrigin('https://a.test/blog/x', 'https://a.test/'), '/blog/x')
  assert.equal(stripOrigin('https://a.test', 'https://a.test'), '/')
  assert.equal(stripOrigin('query text', 'https://a.test'), 'query text')
  assert.equal(stripOrigin('https://www.a.test/x', 'https://a.test'), '/x')
  assert.equal(stripOrigin('https://a.test/x', 'https://www.a.test'), '/x')
  assert.equal(stripOrigin('https://a.testing/x', 'https://a.test'), 'https://a.testing/x')
})

test('inboundIndex counts each linking file once per route, across link shapes', () =>
  withTempDir(dir => {
    writeTree(dir, {
      'src/a.md': '[x](/blog/post/) and [y](/blog/post#h)\n[ref]: /pricing\n',
      'src/b.jsx': "<a href='/blog/post'>x</a>\nconst l = { href: '/pricing' }\n",
      'src/c.md': '[abs](https://www.a.test/blog/post) [cdn](//cdn.test/blog/post)\n',
      'src/d.jsx': '<Link to="/blog/post">x</Link>\n<a href={\'/pricing\'}>p</a>',
      'src/e.md': '```md\n[x](/blog/post)\n```\n  [ref]: /pricing\n[w](</faq>)\n',
      'src/f.md': '```sh\nls\n```\n\n```js\nrun()\n```\n\nsee [docs](/docs)\n',
      'src/node_modules/d.md': '[x](/blog/post)\n'
    })
    const index = inboundIndex(listSources(path.join(dir, 'src')), { origin: 'https://a.test', root: dir })
    assert.deepEqual([...index.get('/blog/post')].sort(), ['src/a.md', 'src/b.jsx', 'src/c.md', 'src/d.jsx'])
    assert.deepEqual([...index.get('/pricing')].sort(), ['src/a.md', 'src/b.jsx', 'src/d.jsx', 'src/e.md'])
    assert.deepEqual([...index.get('/faq')], ['src/e.md'])
    assert.deepEqual([...index.get('/docs')], ['src/f.md'])
    assert.equal(normalizeRoute('/x/'), '/x')
  }))

test('planEdits applies edits in order and reports anything not matching exactly once', () => {
  const files = { 'a.md': 'one headless browser here, one there', 'b.md': 'twice twice' }
  const { contents, failures } = planEdits(
    [
      { file: 'a.md', from: 'headless browser', to: '[headless browser](/hb)' },
      { file: 'a.md', from: 'there', to: 'over [there](/t)' },
      { file: 'b.md', from: 'twice', to: 'x' },
      { file: 'b.md', from: 'missing', to: 'x' }
    ],
    file => files[file]
  )
  assert.equal(contents.get('a.md'), 'one [headless browser](/hb) here, one over [there](/t)')
  assert.deepEqual(failures.map(({ file, count }) => [file, count]), [['b.md', 2], ['b.md', 0]])
})

test('planEdits refuses an edit that would rewrite text an earlier edit inserted', () => {
  const { contents, failures } = planEdits(
    [{ file: 'a', from: 'a', to: '[a](/x)' }, { file: 'a', from: 'a', to: 'Q' }],
    () => 'ab'
  )
  assert.equal(failures.length, 1)
  assert.equal(contents.get('a'), '[a](/x)b')
})

test('planEdits refuses an empty from', () => {
  const { failures } = planEdits([{ file: 'a', from: '', to: 'X' }], () => 'ab')
  assert.equal(failures.length, 1)
})

test('planEdits treats $ in the replacement literally', () => {
  const { contents } = planEdits([{ file: 'a', from: 'price', to: '$& $1' }], () => 'price')
  assert.equal(contents.get('a'), '$& $1')
})

test('apply-edits writes nothing when one edit fails', () =>
  withTempDir(dir => {
    writeTree(dir, { 'a.md': 'alpha beta' })
    const edits = path.join(dir, 'edits.json')
    writeFileSync(edits, JSON.stringify([
      { file: path.join(dir, 'a.md'), from: 'alpha', to: 'A' },
      { file: path.join(dir, 'a.md'), from: 'gamma', to: 'G' }
    ]))
    const run = spawnSync(process.execPath, [path.join(HERE, 'apply-edits.mjs'), edits])
    assert.equal(run.status, 1)
    assert.equal(readFileSync(path.join(dir, 'a.md'), 'utf8'), 'alpha beta')
  }))

const runTemplate = (dir, host = 'a.test') => {
  const { NODE_TEST_CONTEXT, ...env } = process.env
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', TEMPLATE], {
    env: { ...env, SITE_ROOT: dir, SITE_HOST: host },
    encoding: 'utf8'
  })
}

const HEALTHY_SITE = {
  'src/pages/index.jsx': "export default () => <a href='/pricing'>Pricing</a>",
  'src/pages/pricing.jsx': "export default () => <a href='/blog/post'>Post</a>",
  'src/content/blog/post.md': '[home](/) [pricing](/pricing/) ![](/img/a.png)',
  'static/img/a.png': '',
  'vercel.json': JSON.stringify({
    redirects: [
      { source: '/old-home', destination: '/' },
      { source: '/docs/:path*', destination: '/blog/post' },
      { source: '/conditional', destination: '/', has: [{ type: 'host' }] }
    ]
  })
}

test('template passes on a healthy site', () =>
  withTempDir(dir => {
    writeTree(dir, { ...HEALTHY_SITE, 'src/content/blog/post.md': '[home](/) [pricing](/pricing/) ![](/img/a.png)' })
    const run = runTemplate(dir)
    assert.equal(run.status, 0, run.stdout + run.stderr)
  }))

const RESOLVE_CHECK = 'every internal link resolves'
const REDIRECT_CHECK = 'no internal link points at a redirect'
const ABSOLUTE_CHECK = 'internal page links are relative'

const failedChecks = stdout =>
  [RESOLVE_CHECK, REDIRECT_CHECK, ABSOLUTE_CHECK].filter(check =>
    stdout.split('\n').some(line => line.startsWith('not ok') && line.includes(check))
  )

for (const [name, link, expected, file = 'src/content/blog/post.md'] of [
  ['a dead link', '[gone](/nowhere)', [RESOLVE_CHECK]],
  ['a dead JSX href in braces', "<a href={'/nowhere'}>x</a>", [RESOLVE_CHECK]],
  ['a dead Link to prop', '<Link to="/nowhere">x</Link>', [RESOLVE_CHECK]],
  ['a dead link with wrapped text', '[two\nlines](/nowhere)', [RESOLVE_CHECK]],
  ['a dead link around an image and text', '[![i](/img/a.png) More](/nowhere)', [RESOLVE_CHECK]],
  ['a dead relative link', '[rel](../nowhere)', [RESOLVE_CHECK]],
  ['an absolute link to the bare own domain', '<a href="https://a.test">home</a>', [ABSOLUTE_CHECK]],
  ['an absolute reference definition', '[ref]: https://a.test/pricing', [ABSOLUTE_CHECK]],
  ['an absolute template-literal href', '<a href={`https://a.test/pricing`}>x</a>', [ABSOLUTE_CHECK], 'src/components/card.jsx'],
  ['a link to a static redirect', '[old](/old-home)', [REDIRECT_CHECK]],
  ['a link under a dynamic redirect', '[old](/docs/a/b)', [REDIRECT_CHECK]],
  ['an absolute link to the own domain', '[abs](https://a.test/pricing)', [ABSOLUTE_CHECK]],
  ['a dead link behind a linked image', '[![](/img/a.png)](/nowhere)', [RESOLVE_CHECK]]
]) {
  test(`template fails on ${name}`, () =>
    withTempDir(dir => {
      writeTree(dir, { ...HEALTHY_SITE, [file]: `[home](/)\n${link}\n` })
      const run = runTemplate(dir)
      assert.equal(run.status, 1, run.stdout)
      assert.deepEqual(failedChecks(run.stdout), expected)
    }))
}

test('template skips interpolated links and story files', () =>
  withTempDir(dir => {
    writeTree(dir, {
      ...HEALTHY_SITE,
      'src/content/blog/post.md': '[home](/)',
      'src/components/card.jsx': 'const a = <a href={`/features/${slug}`}>x</a>\nconst b = { href: `/blog/${slug}` }',
      'src/components/card.stories.jsx': "const a = <a href='/old-home'>x</a>"
    })
    const run = runTemplate(dir)
    assert.equal(run.status, 0, run.stdout)
  }))

test('template ignores Netlify rewrites and links inside code fences', () =>
  withTempDir(dir => {
    writeTree(dir, {
      ...HEALTHY_SITE,
      'static/_redirects': '/*  /index.html  200\n/legacy  /pricing  301\n',
      'src/content/blog/post.md': '[home](/)\n```md\n[sample](/nowhere)\n```\n'
    })
    assert.equal(runTemplate(dir).status, 0)
    writeTree(dir, { 'src/content/blog/post.md': '[gone](/nowhere) [legacy](/legacy)' })
    assert.deepEqual(failedChecks(runTemplate(dir).stdout), [RESOLVE_CHECK, REDIRECT_CHECK])
  }))

test('template matches Vercel regex sources', () =>
  withTempDir(dir => {
    writeTree(dir, {
      ...HEALTHY_SITE,
      'vercel.json': JSON.stringify({ redirects: [{ source: '/old/(.*)', destination: '/' }] }),
      'src/content/blog/post.md': '[old](/old/x)'
    })
    assert.deepEqual(failedChecks(runTemplate(dir).stdout), [REDIRECT_CHECK])
  }))

test('template allows an absolute link to a static file', () =>
  withTempDir(dir => {
    writeTree(dir, { ...HEALTHY_SITE, 'src/content/blog/post.md': '[img](https://a.test/img/a.png)' })
    assert.equal(runTemplate(dir).status, 0)
  }))

test('template does not treat a conditional redirect source as a page', () =>
  withTempDir(dir => {
    writeTree(dir, { ...HEALTHY_SITE, 'src/content/blog/post.md': '[c](/conditional)' })
    assert.deepEqual(failedChecks(runTemplate(dir).stdout), [RESOLVE_CHECK])
  }))
