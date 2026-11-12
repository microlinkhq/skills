import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = path.resolve(process.env.SITE_ROOT ?? process.cwd())
const SITE_HOST = process.env.SITE_HOST ?? 'example.com'

const ROUTE_SOURCES = [
  { dir: 'src/pages', extension: /\.(jsx?|tsx?|astro)$/ },
  { dir: 'src/content', extension: /\.mdx?$/ }
]
const LINK_SOURCES = [
  { dir: 'src/content', extension: /\.mdx?$/ },
  { dir: 'src/pages', extension: /\.(jsx?|tsx?|astro)$/ },
  { dir: 'src/components', extension: /\.(jsx?|tsx?|astro)$/ }
]
const EXCLUDED_FILES = /\.(stories|test|spec)\.[jt]sx?$/
const STATIC_DIRS = ['static', 'public']
const EXTRA_ROUTES = []

const MARKDOWN_FILE = /\.mdx?$/
const FENCED_CODE = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm
const INLINE_CODE = /`[^`\n]*`/g
const INLINE_TARGET = /\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g
const REFERENCE_TARGET = /^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm
const ATTRIBUTE_TARGET = /\b(?:href|to)\s*=\s*\{?\s*(["'`])([^"'`]+?)\1(?!\s*\+)/g
const OBJECT_HREF_TARGET = /\b(?:href|to)\s*:\s*(["'`])([^"'`]+?)\1(?!\s*\+)/g
const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
const INTERPOLATED = /\$\{|\{\{/
const PATH_SUFFIX = /[?#].*$/
const TRAILING_SLASH = /(.)\/+$/
const DYNAMIC_SEGMENT = /[[:*(]/
const REDIRECT_STATUS = /^(?:30[12378])!?$/
const RULE_STATUS = /^(?:30[12378]|200|404)!?$/

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BARE_HOST = SITE_HOST.replace(/^www\./i, '')
const OWN_ORIGIN = new RegExp(String.raw`^(?:https?:)?\/\/(?:www\.)?${escapeRegExp(BARE_HOST)}(?=[/?#]|$)`, 'i')

const listFiles = (dir, extension) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return listFiles(full, extension)
      return entry.isFile() && extension.test(entry.name) ? [full] : []
    })
    : []

const toRoute = (dir, file, extension) =>
  path
    .relative(dir, file)
    .split(path.sep)
    .join('/')
    .replace(extension, '')
    .replace(/(^|\/)index$/, '')
    .replace(/^/, '/')

const safeDecode = value => {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

const normalize = link =>
  safeDecode(link.replace(PATH_SUFFIX, '')).replace(TRAILING_SLASH, '$1') || '/'

const relativeRoute = pathname =>
  pathname.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '') || '/'

const resolutionBase = (file, route) => {
  if (!route || route.endsWith('/')) return route
  return path.basename(file, path.extname(file)) === 'index' ? `${route}/` : route
}

const readVercelRedirects = () => {
  const file = path.join(ROOT, 'vercel.json')
  if (!existsSync(file)) return []
  return (JSON.parse(readFileSync(file, 'utf8')).redirects ?? [])
    .filter(redirect => !redirect.has && !redirect.missing)
    .map(redirect => ({ source: redirect.source, forced: true }))
}

const parseNetlifyLine = line => {
  const [source, , ...rest] = line.trim().split(/\s+/)
  let status
  const conditions = []
  for (const token of rest) {
    if (status === undefined && RULE_STATUS.test(token)) status = token
    else conditions.push(token)
  }
  return { source, status, conditional: conditions.length > 0, forced: status?.endsWith('!') ?? false }
}

const readNetlifyRedirects = () =>
  STATIC_DIRS.map(dir => path.join(ROOT, dir, '_redirects'))
    .filter(existsSync)
    .flatMap(file => readFileSync(file, 'utf8').split('\n'))
    .map(parseNetlifyLine)
    .filter(({ source, status, conditional }) =>
      source?.startsWith('/') && !conditional && (!status || REDIRECT_STATUS.test(status)))
    .map(({ source, forced }) => ({ source, forced }))

const redirectRules = [...readVercelRedirects(), ...readNetlifyRedirects()]

const escapeOutsideGroups = source => {
  let depth = 0
  let result = ''
  for (const char of source) {
    if (char === '(') depth++
    if (char === ')') depth--
    result += char === '.' && depth === 0 ? '\\.' : char
  }
  return result
}

const toRedirectPattern = source =>
  new RegExp(
    `^${escapeOutsideGroups(source)
      .replace(/\/:\w+\*/g, '(?:/.*)?')
      .replace(/\/\*$/, '(?:/.*)?')
      .replace(/:\w+\(([^)]*)\)/g, '($1)')
      .replace(/:\w+(?!\w*[*(])/g, '[^/]+')}$`
  )

const staticRules = new Map()
const dynamicRules = []
for (const { source, forced } of redirectRules) {
  if (DYNAMIC_SEGMENT.test(source)) dynamicRules.push({ pattern: toRedirectPattern(source), forced })
  else staticRules.set(normalize(source), (staticRules.get(normalize(source)) ?? false) || forced)
}

const isRedirect = link => {
  const route = normalize(link)
  const forced = []
  if (staticRules.has(route)) forced.push(staticRules.get(route))
  for (const rule of dynamicRules) if (rule.pattern.test(route)) forced.push(rule.forced)
  if (!forced.length) return false
  if (forced.some(Boolean)) return true
  return !isStaticFile(route)
}

const routedFiles = new Map(
  ROUTE_SOURCES.flatMap(({ dir, extension }) =>
    listFiles(path.join(ROOT, dir), extension).map(file => [
      file,
      toRoute(path.join(ROOT, dir), file, extension)
    ])
  )
)

const knownRoutes = new Set(['/', ...EXTRA_ROUTES, ...routedFiles.values()])

const isStaticFile = route =>
  STATIC_DIRS.some(dir => {
    const base = path.join(ROOT, dir)
    const file = path.join(base, route)
    const relative = path.relative(base, file)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return false
    return existsSync(file) && !existsSync(path.join(file, '/'))
  })

const resolves = link => {
  const route = normalize(link)
  return knownRoutes.has(route) || isRedirect(link) || isStaticFile(route)
}

const stripCode = source => source.replace(FENCED_CODE, '').replace(INLINE_CODE, '')

export const extractTargets = (source, { markdown = false } = {}) => {
  const text = markdown ? stripCode(source) : source
  return [
    ...[...text.matchAll(INLINE_TARGET)].map(match => match[1]),
    ...[...text.matchAll(REFERENCE_TARGET)].map(match => match[1]),
    ...[...text.matchAll(ATTRIBUTE_TARGET)].map(match => match[2]),
    ...[...text.matchAll(OBJECT_HREF_TARGET)].map(match => match[2])
  ]
}

const classify = (target, route) => {
  if (INTERPOLATED.test(target) || target.startsWith('#')) return null
  if (OWN_ORIGIN.test(target)) {
    const suffix = target.replace(OWN_ORIGIN, '')
    return { link: suffix.startsWith('/') ? suffix : `/${suffix}`, absolute: true }
  }
  if (EXTERNAL.test(target)) return null
  if (target.startsWith('/')) return { link: target, absolute: false }
  if (!route) return null
  const pathname = new URL(target, `https://${SITE_HOST}${route}`).pathname
  const link = isStaticFile(normalize(pathname)) ? pathname : relativeRoute(pathname)
  return { link, absolute: false }
}

const sourceFiles = LINK_SOURCES.flatMap(({ dir, extension }) =>
  listFiles(path.join(ROOT, dir), extension)
).filter(file => !EXCLUDED_FILES.test(file))

const internalLinks = sourceFiles.flatMap(file => {
  const route = routedFiles.get(file)
  return extractTargets(readFileSync(file, 'utf8'), { markdown: MARKDOWN_FILE.test(file) })
    .map(target => classify(target, resolutionBase(file, route)))
    .filter(Boolean)
    .map(found => ({ file: path.relative(ROOT, file), ...found }))
})

const linksIn = (sample, route) =>
  extractTargets(sample, { markdown: true })
    .map(target => classify(target, route))
    .filter(Boolean)
    .map(({ link }) => link)

test('the scan finds internal links', () => {
  assert.ok(internalLinks.length > 0, `no internal links found under ${ROOT}`)
})

test('every internal link resolves to a page, static file or redirect', () => {
  assert.deepEqual(internalLinks.filter(({ link }) => !resolves(link)), [])
})

test('no internal link points at a redirect instead of its destination', () => {
  assert.deepEqual(internalLinks.filter(({ link }) => isRedirect(link)), [])
})

test('internal page links are relative, not absolute to the own domain', () => {
  assert.deepEqual(
    internalLinks.filter(({ absolute, link }) => absolute && !isStaticFile(normalize(link))),
    []
  )
})

test('link extraction handles the shapes that hide links', () => {
  assert.deepEqual(linksIn('[![](/img/a.png)](/blog/x)'), ['/img/a.png', '/blog/x'])
  assert.deepEqual(linksIn('[![i](/img/a.png) More](/blog/x)'), ['/img/a.png', '/blog/x'])
  assert.deepEqual(linksIn('[![](https://cdn.test/a.png)](/blog/x)'), ['/blog/x'])
  assert.deepEqual(linksIn('[a](/blog/x "Title")'), ['/blog/x'])
  assert.deepEqual(linksIn('[two\nlines](/blog/x)'), ['/blog/x'])
  assert.deepEqual(linksIn('[a](</blog/x>)'), ['/blog/x'])
  assert.deepEqual(linksIn('[a](//cdn.test/x)'), [])
  assert.deepEqual(linksIn(`<a href="https://${SITE_HOST}/pricing">`), ['/pricing'])
  assert.deepEqual(linksIn(`<a href="https://${SITE_HOST}">`), ['/'])
  assert.deepEqual(linksIn(`[f](https://${SITE_HOST}#features) [q](https://${SITE_HOST}?ref=x)`), ['/#features', '/?ref=x'])
  assert.deepEqual(linksIn(`[ref]: https://www.${BARE_HOST}/pricing`), ['/pricing'])
  assert.deepEqual(linksIn('  [ref]: /pricing'), ['/pricing'])
  assert.deepEqual(linksIn("href: '/pricing'"), ['/pricing'])
  assert.deepEqual(linksIn("<a href={'/pricing'}>"), ['/pricing'])
  assert.deepEqual(linksIn('<Link to="/pricing">'), ['/pricing'])
  assert.deepEqual(linksIn(`[a](https://${SITE_HOST}.evil.test/x)`), [])
  assert.deepEqual(linksIn('[a](../gone)', '/blog/post'), ['/gone'])
  assert.deepEqual(linksIn('[a](../gone)'), [])
  assert.equal(relativeRoute('/blog/post.md'), '/blog/post')
  assert.equal(relativeRoute('/guide/index.md'), '/guide')
  assert.equal(relativeRoute('/index.md'), '/')
  assert.deepEqual(linksIn('[a](/readme.md)'), ['/readme.md'])
  assert.deepEqual(linksIn("to: '/pricing'"), ['/pricing'])
  assert.deepEqual(extractTargets('const a = { href: "/pricing" }\nconst b = { to: `/docs` }'), ['/pricing', '/docs'])
  assert.deepEqual(linksIn('```md\n[a](/in-fence)\n```\n`[b](/in-span)`'), [])
  assert.deepEqual(linksIn('```sh\nls\n```\n\n```js\nrun()\n```\n\n[c](/after-fences)'), ['/after-fences'])
})

test('own-domain schemes count as absolute internal links', () => {
  const found = sample =>
    extractTargets(sample, { markdown: true })
      .map(target => classify(target, '/'))
      .filter(Boolean)
  assert.deepEqual(found(`[a](http://${SITE_HOST}/pricing)`), [{ link: '/pricing', absolute: true }])
  assert.deepEqual(found(`[a](//${SITE_HOST}/pricing)`), [{ link: '/pricing', absolute: true }])
  assert.deepEqual(found(`[a](//www.${BARE_HOST}/x)`), [{ link: '/x', absolute: true }])
})

test('normalization and static lookups stay inside the site', () => {
  assert.equal(normalize('/a/b/?q=1#h'), '/a/b')
  assert.doesNotThrow(() => resolves('/%'))
  assert.equal(isStaticFile('/../package.json'), false)
})

test('redirect sources compile the way the host matches them', () => {
  assert.ok(toRedirectPattern('/old/(.*)').test('/old/x'))
  assert.ok(toRedirectPattern('/docs/:path*').test('/docs/a/b'))
  assert.ok(toRedirectPattern('/blog/*').test('/blog/a'))
  assert.ok(!toRedirectPattern('/blog/*').test('/blogx'))
  assert.ok(!toRedirectPattern('/v1.0/:name').test('/v1X0/intro'))
  assert.ok(toRedirectPattern('/posts/:path(\\d{1,})').test('/posts/123'))
  assert.ok(!toRedirectPattern('/posts/:path(\\d{1,})').test('/posts/abc'))
  assert.deepEqual(parseNetlifyLine('/*  /index.html  200'), { source: '/*', status: '200', conditional: false, forced: false })
  assert.deepEqual(parseNetlifyLine('/old /pricing 301!'), { source: '/old', status: '301!', conditional: false, forced: true })
  assert.deepEqual(parseNetlifyLine('/old /pricing 301 Country=us'), { source: '/old', status: '301', conditional: true, forced: false })
  for (const status of ['301', '302', '303', '307', '308', '301!', '302!']) {
    assert.equal(REDIRECT_STATUS.test(status), true, status)
  }
  for (const status of ['200', '200!', '404', '300', '304']) {
    assert.equal(REDIRECT_STATUS.test(status), false, status)
  }
})
