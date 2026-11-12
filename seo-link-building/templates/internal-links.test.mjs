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
const ATTRIBUTE_TARGET = /\b(?:href|to)\s*=\s*\{?\s*(["'`])([^"'`]+?)\1/g
const OBJECT_HREF_TARGET = /\bhref\s*:\s*(["'`])([^"'`]+?)\1/g
const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
const INTERPOLATED = /\$\{|\{\{/
const PATH_SUFFIX = /[?#].*$/
const TRAILING_SLASH = /(.)\/+$/
const DYNAMIC_SEGMENT = /[[:*(]/
const REDIRECT_STATUS = /^(?:30[1278])!?$/

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const OWN_ORIGIN = new RegExp(String.raw`^(?:https?:)?\/\/(?:www\.)?${escapeRegExp(SITE_HOST)}(?=[/?#]|$)`, 'i')

const listFiles = (dir, extension) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && extension.test(entry.name))
      .map(entry => path.join(entry.parentPath ?? entry.path, entry.name))
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

const readVercelRedirects = () => {
  const file = path.join(ROOT, 'vercel.json')
  if (!existsSync(file)) return []
  return (JSON.parse(readFileSync(file, 'utf8')).redirects ?? [])
    .filter(redirect => !redirect.has && !redirect.missing)
    .map(redirect => redirect.source)
}

const parseNetlifyLine = line => {
  const [source, , status] = line.trim().split(/\s+/)
  return { source, status }
}

const readNetlifyRedirects = () =>
  STATIC_DIRS.map(dir => path.join(ROOT, dir, '_redirects'))
    .filter(existsSync)
    .flatMap(file => readFileSync(file, 'utf8').split('\n'))
    .map(parseNetlifyLine)
    .filter(({ source, status }) => source?.startsWith('/') && (!status || REDIRECT_STATUS.test(status)))
    .map(({ source }) => source)

const redirectSources = [...readVercelRedirects(), ...readNetlifyRedirects()]

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
      .replace(/:\w+(?!\w*[*(])/g, '[^/]+')}$`
  )

const staticRedirects = new Set(
  redirectSources.filter(source => !DYNAMIC_SEGMENT.test(source)).map(normalize)
)
const dynamicRedirects = redirectSources
  .filter(source => DYNAMIC_SEGMENT.test(source))
  .map(toRedirectPattern)

const isRedirect = link => {
  const route = normalize(link)
  return staticRedirects.has(route) || dynamicRedirects.some(pattern => pattern.test(route))
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
    return { link: target.replace(OWN_ORIGIN, '') || '/', absolute: true }
  }
  if (EXTERNAL.test(target)) return null
  if (target.startsWith('/')) return { link: target, absolute: false }
  if (!route) return null
  const resolved = new URL(target, `https://${SITE_HOST}${route}`)
  return { link: resolved.pathname, absolute: false }
}

const sourceFiles = LINK_SOURCES.flatMap(({ dir, extension }) =>
  listFiles(path.join(ROOT, dir), extension)
).filter(file => !EXCLUDED_FILES.test(file))

const internalLinks = sourceFiles.flatMap(file => {
  const route = routedFiles.get(file)
  return extractTargets(readFileSync(file, 'utf8'), { markdown: MARKDOWN_FILE.test(file) })
    .map(target => classify(target, route))
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

test('internal links are relative, not absolute to the own domain', () => {
  assert.deepEqual(internalLinks.filter(({ absolute }) => absolute), [])
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
  assert.deepEqual(linksIn(`[ref]: https://www.${SITE_HOST}/pricing`), ['/pricing'])
  assert.deepEqual(linksIn('  [ref]: /pricing'), ['/pricing'])
  assert.deepEqual(linksIn("href: '/pricing'"), ['/pricing'])
  assert.deepEqual(linksIn("<a href={'/pricing'}>"), ['/pricing'])
  assert.deepEqual(linksIn('<Link to="/pricing">'), ['/pricing'])
  assert.deepEqual(linksIn(`[a](https://${SITE_HOST}.evil.test/x)`), [])
  assert.deepEqual(linksIn('[a](../gone)', '/blog/post'), ['/gone'])
  assert.deepEqual(linksIn('[a](../gone)'), [])
  assert.deepEqual(linksIn('```md\n[a](/in-fence)\n```\n`[b](/in-span)`'), [])
  assert.deepEqual(linksIn('```sh\nls\n```\n\n```js\nrun()\n```\n\n[c](/after-fences)'), ['/after-fences'])
})

test('normalization and static lookups stay inside the site', () => {
  assert.equal(normalize('/a/b/?q=1#h'), '/a/b')
  assert.doesNotThrow(() => resolves('/%'))
  assert.equal(isStaticFile('/../package.json'), false)
})

test('redirect sources compile the way the host matches them', () => {
  assert.ok(toRedirectPattern('/old/(.*)').test('/old/x'))
  assert.ok(toRedirectPattern('/docs/:path*').test('/docs/a/b'))
  assert.ok(!toRedirectPattern('/v1.0/:name').test('/v1X0/intro'))
  assert.deepEqual(parseNetlifyLine('/*  /index.html  200'), { source: '/*', status: '200' })
})
