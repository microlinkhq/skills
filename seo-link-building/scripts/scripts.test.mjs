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
  { key: '/small', clicks: 1, impressions: 10, ctr: 10, position: 15 },
  { key: '/at-min', clicks: 1, impressions: 500, ctr: 1, position: 10.5 },
  { key: '/at-max', clicks: 1, impressions: 600, ctr: 1, position: 20.5 },
  { key: '/below-min', clicks: 1, impressions: 700, ctr: 3, position: 10.49 },
  { key: '/imp-under', clicks: 1, impressions: 499, ctr: 1, position: 12 },
  { key: '/round', clicks: 1, impressions: 550, ctr: 1, position: 2 },
  { key: '/ctr-floor', clicks: 1, impressions: 500, ctr: 1, position: 4 },
  { key: '/ctr-over', clicks: 1, impressions: 800, ctr: 3.01, position: 4 }
]

test('strikingDistance keeps positions 10.5 to 20.5 above the impression floor, biggest first', () => {
  assert.deepEqual(strikingDistance(ROWS).map(row => row.key), ['/nearer', '/near', '/at-max', '/at-min'])
  assert.deepEqual(strikingDistance(ROWS, { minImpressions: 1 }).map(row => row.key), [
    '/nearer', '/near', '/at-max', '/at-min', '/imp-under', '/small'
  ])
})

test('lowCtr keeps first-page rows under the CTR ceiling and sizes one CTR point', () => {
  const hits = lowCtr(ROWS)
  assert.deepEqual(hits.map(row => row.key), ['/top', '/below-min', '/round', '/ctr-floor'])
  assert.equal(hits.find(row => row.key === '/top').clicksPerCtrPoint, 50)
  assert.equal(hits.find(row => row.key === '/round').clicksPerCtrPoint, 6)
})

test('stripOrigin turns a full URL into a route', () => {
  assert.equal(stripOrigin('https://a.test/blog/x', 'https://a.test/'), '/blog/x')
  assert.equal(stripOrigin('https://a.test', 'https://a.test'), '/')
  assert.equal(stripOrigin('query text', 'https://a.test'), 'query text')
  assert.equal(stripOrigin('https://www.a.test/x', 'https://a.test'), '/x')
  assert.equal(stripOrigin('https://a.test/x', 'https://www.a.test'), '/x')
  assert.equal(stripOrigin('https://a.testing/x', 'https://a.test'), 'https://a.testing/x')
  assert.equal(stripOrigin('https://a.test/x'), 'https://a.test/x')
  assert.equal(stripOrigin('http://a.test/x', 'https://a.test'), '/x')
  assert.equal(stripOrigin('https://a.test/x?q=1#h', 'https://a.test'), '/x')
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
      'src/node_modules/d.md': '[x](/blog/post)\n',
      'src/g.mdx': '[x](/blog/post)\n',
      'src/h.js': "export const h = { href: '/pricing' }\n",
      'src/i.ts': "export const h = { href: '/docs' }\n",
      'src/j.tsx': '<Link to="/faq">x</Link>\n',
      'src/k.astro': '<a href="/blog/post">x</a>\n',
      'src/l.vue': '<a href="/pricing">x</a>\n',
      'src/m.svelte': '<a href="/faq">x</a>\n',
      'src/n.html': '<a href="/docs">x</a>\n',
      'src/o.md': 'see `[x](/secret)` and [y](/blog/post)\n',
      'src/p.md': '~~~\n[x](/secret)\n~~~\n',
      'src/q.jsx': 'const a = <a href={`/blog/post`}>x</a>\n',
      'src/r.md': '[a](HTTPS://WWW.a.test/Blog/Post)\n',
      'src/s.jsx': "export const nav = { to: '/faq' }\n",
      'src/t.jsx': 'export const nav = { href: "/docs", to: `/faq` }\n',
      'src/public/p.md': '[x](/secret)\n',
      'src/.git/x.md': '[x](/secret)\n',
      'src/.cache/x.md': '[x](/secret)\n',
      'src/dist/x.md': '[x](/secret)\n',
      'src/build/x.md': '[x](/secret)\n',
      'src/.next/x.md': '[x](/secret)\n'
    })
    const index = inboundIndex(listSources(path.join(dir, 'src')), { origin: 'https://a.test', root: dir })
    assert.deepEqual([...index.get('/blog/post')].sort(), [
      'src/a.md', 'src/b.jsx', 'src/c.md', 'src/d.jsx', 'src/g.mdx', 'src/k.astro', 'src/o.md', 'src/q.jsx'
    ])
    assert.deepEqual([...index.get('/pricing')].sort(), ['src/a.md', 'src/b.jsx', 'src/d.jsx', 'src/e.md', 'src/h.js', 'src/l.vue'])
    assert.deepEqual([...index.get('/faq')].sort(), ['src/e.md', 'src/j.tsx', 'src/m.svelte', 'src/s.jsx', 'src/t.jsx'])
    assert.deepEqual([...index.get('/docs')].sort(), ['src/f.md', 'src/i.ts', 'src/n.html', 'src/t.jsx'])
    assert.deepEqual([...index.get('/Blog/Post')], ['src/r.md'])
    assert.equal(index.get('/secret'), undefined)
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

test('planEdits refuses a later edit when the phrase was not unique in the original', () => {
  const { contents, failures } = planEdits(
    [
      { file: 'a', from: 'say hello and ', to: 'say ' },
      { file: 'a', from: 'hello', to: 'hi' }
    ],
    () => 'say hello and hello'
  )
  assert.equal(contents.get('a'), 'say hello')
  assert.deepEqual(failures.map(({ count }) => count), [2])
})

test('planEdits treats path aliases as one file', () => {
  const { contents, failures } = planEdits(
    [
      { file: 'a.md', from: 'alpha', to: 'A' },
      { file: './a.md', from: 'beta', to: 'B' }
    ],
    () => 'alpha beta'
  )
  assert.equal(failures.length, 0)
  assert.equal(contents.size, 1)
  assert.equal(contents.get('a.md'), 'A B')
})

test('planEdits refuses an edit whose match crosses text an earlier edit inserted', () => {
  const { contents, failures } = planEdits(
    [
      { file: 'a', from: 'ab', to: 'a' },
      { file: 'a', from: 'ab', to: 'X' }
    ],
    () => 'abb'
  )
  assert.equal(contents.get('a'), 'ab')
  assert.equal(failures.length, 1)
})

test('planEdits refuses a non-string replacement and a file it cannot read', () => {
  const { contents, failures } = planEdits(
    [{ file: 'a', from: 'a' }, { file: 'missing', from: 'a', to: 'b' }],
    file => {
      if (file === 'missing') throw new Error('ENOENT')
      return 'ab'
    }
  )
  assert.equal(contents.get('a'), 'ab')
  assert.equal(failures.length, 2)
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
  'src/pages/index.jsx': "export default () => <a href='/pricing'>Pricing</a><a href='/plain'>p</a><a href='/typed'>t</a><a href='/view'>v</a><a href='/astro-page'>a</a><a href='/guide'>g</a><a href='/img/b.png'>i</a>",
  'src/pages/pricing.jsx': "export default () => <a href='/blog/post'>Post</a>",
  'src/pages/plain.js': "export default () => <a href='/pricing'>p</a>",
  'src/pages/typed.ts': "export default () => <a href='/pricing'>p</a>",
  'src/pages/view.tsx': "export default () => <a href='/pricing'>p</a>",
  'src/pages/astro-page.astro': "<a href='/pricing'>p</a>\n",
  'src/content/blog/post.md': '[home](/) [pricing](/pricing/) ![](/img/a.png)',
  'src/content/guide.mdx': '[home](/)\n',
  'static/img/a.png': '',
  'public/img/b.png': '',
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
  ['an absolute link with a hash after the bare domain', '[f](https://a.test#top)', [ABSOLUTE_CHECK]],
  ['an absolute reference definition', '[ref]: https://a.test/pricing', [ABSOLUTE_CHECK]],
  ['an absolute template-literal href', '<a href={`https://a.test/pricing`}>x</a>', [ABSOLUTE_CHECK], 'src/components/card.jsx'],
  ['a link to a static redirect', '[old](/old-home)', [REDIRECT_CHECK]],
  ['a link under a dynamic redirect', '[old](/docs/a/b)', [REDIRECT_CHECK]],
  ['an absolute link to the own domain', '[abs](https://a.test/pricing)', [ABSOLUTE_CHECK]],
  ['a dead link behind a linked image', '[![](/img/a.png)](/nowhere)', [RESOLVE_CHECK]],
  ['a dead object to', "const a = { to: '/nowhere' }", [RESOLVE_CHECK], 'src/components/card.jsx']
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
      'src/components/card.jsx': "const a = <a href={`/features/${slug}`}>x</a>\nconst b = { href: `/blog/${slug}` }\nconst c = <a href={'/old-home' + slug}>x</a>\nconst d = { href: '/old-home' + slug }",
      'src/components/card.stories.jsx': "const a = <a href='/old-home'>x</a>",
      'src/components/card.test.js': "const a = <a href='/old-home'>x</a>",
      'src/components/card.test.jsx': "const a = <a href='/old-home'>x</a>",
      'src/components/card.spec.tsx': "const a = <a href='/old-home'>x</a>"
    })
    const run = runTemplate(dir)
    assert.equal(run.status, 0, run.stdout)
  }))

test('template ignores Netlify rewrites and links inside code fences', () =>
  withTempDir(dir => {
    writeTree(dir, {
      ...HEALTHY_SITE,
      'static/_redirects': '/*  /index.html  200\n/legacy  /pricing  301\n',
      'src/content/blog/post.md': '[home](/)\n```md\n[sample](/nowhere)\n```\n~~~\n[gone](/nowhere)\n~~~\n'
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

test('template flags an apex link when the host is www', () =>
  withTempDir(dir => {
    writeTree(dir, { ...HEALTHY_SITE, 'src/content/blog/post.md': '[a](https://a.test/pricing)' })
    assert.deepEqual(failedChecks(runTemplate(dir, 'www.a.test').stdout), [ABSOLUTE_CHECK])
  }))

test('template lets a static file shadow an unforced Netlify redirect', () =>
  withTempDir(dir => {
    writeTree(dir, {
      ...HEALTHY_SITE,
      'public/manual.pdf': 'x',
      'static/_redirects': '/manual.pdf /pricing 301\n',
      'src/content/blog/post.md': '[m](/manual.pdf)'
    })
    assert.equal(runTemplate(dir).status, 0)
    writeTree(dir, { 'static/_redirects': '/manual.pdf /pricing 301!\n' })
    assert.deepEqual(failedChecks(runTemplate(dir).stdout), [REDIRECT_CHECK])
  }))

test('template allows an absolute link to a static file', () =>
  withTempDir(dir => {
    writeTree(dir, { ...HEALTHY_SITE, 'src/content/blog/post.md': '[img](https://a.test/img/a.png/) [q](https://a.test/img/a.png?v=1#x)' })
    assert.equal(runTemplate(dir).status, 0)
  }))

test('template does not treat a conditional redirect source as a page', () =>
  withTempDir(dir => {
    writeTree(dir, {
      ...HEALTHY_SITE,
      'vercel.json': JSON.stringify({
        redirects: [
          { source: '/old-home', destination: '/' },
          { source: '/docs/:path*', destination: '/blog/post' },
          { source: '/conditional', destination: '/', has: [{ type: 'host' }] },
          { source: '/gated', destination: '/', missing: [{ type: 'cookie', key: 'session' }] }
        ]
      }),
      'src/content/blog/post.md': '[c](/conditional) [g](/gated)'
    })
    assert.deepEqual(failedChecks(runTemplate(dir).stdout), [RESOLVE_CHECK])
  }))

for (const file of [
  'src/content/page.mdx',
  'src/pages/page.js',
  'src/pages/page.ts',
  'src/pages/page.tsx',
  'src/pages/extra.jsx',
  'src/pages/page.astro',
  'src/components/widget.js',
  'src/components/widget.ts',
  'src/components/widget.tsx',
  'src/components/widget.astro'
]) {
  test(`template scans links in ${file}`, () =>
    withTempDir(dir => {
      const source = file.endsWith('.mdx') ? '[gone](/nowhere)' : "<a href='/nowhere'>x</a>"
      writeTree(dir, { ...HEALTHY_SITE, 'src/content/blog/post.md': '[home](/)', [file]: source })
      const run = runTemplate(dir)
      assert.equal(run.status, 1, run.stdout)
      assert.deepEqual(failedChecks(run.stdout), [RESOLVE_CHECK])
    }))
}

test('template resolves index routes and markdown-relative links', () =>
  withTempDir(dir => {
    writeTree(dir, {
      ...HEALTHY_SITE,
      'src/content/blog/index.md': '[p](post) [q](./other.md)',
      'src/content/blog/post.md': '[home](/)\n[g](../guide/index.md)',
      'src/content/blog/other.md': '[home](/)',
      'src/content/guide/index.md': '[home](/)',
      'static/readme.md': 'hi'
    })
    const run = runTemplate(dir)
    assert.equal(run.status, 0, run.stdout + run.stderr)
    writeTree(dir, { 'src/content/blog/post.md': '[home](/)\n[r](../../readme.md)' })
    assert.equal(runTemplate(dir).status, 0)
  }))

test('template treats a Netlify 303 as a redirect', () =>
  withTempDir(dir => {
    writeTree(dir, {
      ...HEALTHY_SITE,
      'static/_redirects': '/old /pricing 303\n',
      'src/content/blog/post.md': '[old](/old)'
    })
    assert.deepEqual(failedChecks(runTemplate(dir).stdout), [REDIRECT_CHECK])
  }))

test('template does not treat a conditional Netlify rule as a redirect', () =>
  withTempDir(dir => {
    writeTree(dir, {
      ...HEALTHY_SITE,
      'static/_redirects': '/old /pricing 301 Country=us\n',
      'src/content/blog/post.md': '[old](/old)'
    })
    assert.deepEqual(failedChecks(runTemplate(dir).stdout), [RESOLVE_CHECK])
  }))

test('apply-edits dry-run writes nothing and a real run writes', () =>
  withTempDir(dir => {
    const file = path.join(dir, 'a.md')
    writeFileSync(file, 'alpha beta')
    const edits = path.join(dir, 'edits.json')
    writeFileSync(edits, JSON.stringify([{ file, from: 'alpha', to: 'A' }]))
    const bin = path.join(HERE, 'apply-edits.mjs')
    const dry = spawnSync(process.execPath, [bin, edits, '--dry-run'], { encoding: 'utf8' })
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(dry.stdout, /would apply/)
    assert.equal(readFileSync(file, 'utf8'), 'alpha beta')
    const apply = spawnSync(process.execPath, [bin, edits], { encoding: 'utf8' })
    assert.equal(apply.status, 0, apply.stderr)
    assert.equal(readFileSync(file, 'utf8'), 'A beta')
    assert.equal(spawnSync(process.execPath, [bin], { encoding: 'utf8' }).status, 1)
  }))

test('apply-edits reports a missing from and a missing file without writing', () =>
  withTempDir(dir => {
    const file = path.join(dir, 'a.md')
    writeFileSync(file, 'alpha')
    const edits = path.join(dir, 'edits.json')
    writeFileSync(edits, JSON.stringify([
      { file, to: 'Z' },
      { file: path.join(dir, 'nope.md'), from: 'a', to: 'b' }
    ]))
    const run = spawnSync(process.execPath, [path.join(HERE, 'apply-edits.mjs'), edits], { encoding: 'utf8' })
    assert.equal(run.status, 1, run.stderr)
    assert.match(run.stderr, /nothing written/)
    assert.equal(readFileSync(file, 'utf8'), 'alpha')
  }))

test('gsc CLI filters striking and ctr rows', () =>
  withTempDir(dir => {
    const csv = path.join(dir, 'pages.csv')
    writeFileSync(csv, 'Page,Clicks,Impressions,CTR,Position\nhttps://www.a.test/blog/post,10,2000,1%,14\nhttps://a.test/top,100,5000,1%,3\n')
    const bin = path.join(HERE, 'gsc.mjs')
    const striking = spawnSync(process.execPath, [bin, 'striking', csv, '--origin', 'https://a.test'], { encoding: 'utf8' })
    assert.equal(striking.status, 0, striking.stderr)
    assert.match(striking.stdout, /\/blog\/post/)
    assert.doesNotMatch(striking.stdout, /\/top/)
    const ctr = spawnSync(process.execPath, [bin, 'ctr', csv, '--origin', 'https://a.test', '--max-ctr', '3'], { encoding: 'utf8' })
    assert.match(ctr.stdout, /\/top/)
    assert.doesNotMatch(ctr.stdout, /\/blog\/post/)
    const tight = spawnSync(process.execPath, [bin, 'ctr', csv, '--max-ctr', '0.5'], { encoding: 'utf8' })
    assert.doesNotMatch(tight.stdout, /\/top/)
    const lowImp = spawnSync(process.execPath, [bin, 'striking', csv, '--min-impressions', '5000'], { encoding: 'utf8' })
    assert.doesNotMatch(lowImp.stdout, /\/blog\/post/)
    assert.equal(spawnSync(process.execPath, [bin], { encoding: 'utf8' }).status, 1)
    assert.equal(spawnSync(process.execPath, [bin, 'nope', csv], { encoding: 'utf8' }).status, 1)
    assert.equal(spawnSync(process.execPath, [bin, 'striking', csv, '--min-impressions', 'nope'], { encoding: 'utf8' }).status, 1)
  }))

test('inbound CLI counts default directories and honors flags', () =>
  withTempDir(dir => {
    writeTree(dir, {
      'src/a.md': '[x](/from-src)\n',
      'content/a.md': '[x](/from-content)\n',
      'app/a.md': '[x](/from-app)\n',
      'pages/a.md': '[x](/from-pages)\n',
      'docs/a.md': '[x](/from-docs)\n',
      'other/a.md': '[x](/from-other)\n',
      'src/b.md': '[x](https://a.test/from-abs)\n'
    })
    const bin = path.join(HERE, 'inbound.mjs')
    const run = spawnSync(process.execPath, [
      bin, '--origin', 'https://a.test',
      '/from-src', '/from-content', '/from-app', '/from-pages', '/from-docs', '/from-other', '/from-abs'
    ], { cwd: dir, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    const lineFor = route => run.stdout.split('\n').find(line => line.startsWith(`1\t${route}\t`) || line.startsWith(`0\t${route}\t`))
    for (const route of ['/from-src', '/from-content', '/from-app', '/from-pages', '/from-docs', '/from-abs']) {
      assert.ok(lineFor(route)?.startsWith('1\t'), `${route}\n${run.stdout}`)
    }
    assert.ok(lineFor('/from-other')?.startsWith('0\t'), run.stdout)
    const custom = spawnSync(process.execPath, [bin, '--dir', 'other', '/from-other'], { cwd: dir, encoding: 'utf8' })
    assert.ok(custom.stdout.startsWith('1\t/from-other'), custom.stdout)
    assert.equal(spawnSync(process.execPath, [bin], { cwd: dir, encoding: 'utf8' }).status, 1)
  }))
