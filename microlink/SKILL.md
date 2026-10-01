---
name: microlink
description: Complete Microlink product reference — return shapes, options, CLI, and when to run a method over HTTP or MCP. Use when the user mentions Microlink, microlink.io, api.microlink.io, screenshots, PDFs, markdown, scraping, embed URLs, the microlink CLI, or wiring Microlink into an assistant, or wants to report a Microlink bug or feedback. This file is enough to call any product. Installs @microlink/mcp when this session must execute a product.
---

# microlink.io

The Microlink API organized into products. Each method returns a **direct result**. This file is the full reference for every product: what it returns, which options it takes, and the shared browser parameters. Do not fetch another skill or call `microlink_docs` to learn a product.

`@microlink/mcp` is the assistant runtime for the same methods, not a separate product. Install the server when this session must execute a product (see [In the assistant](#in-the-assistant)).

## Quick Start

```js
import createClient from 'microlink.io'

const microlink = createClient()
const microlinkPro = createClient({ apiKey: process.env.MICROLINK_API_KEY })

const markdown = await microlink.markdown('https://example.com')
```

```bash
npm install microlink.io
npx microlink.io markdown https://example.com
```

Factory options merge into every call. Per-call options override them.

## Option Routing

Every product is `product(url, options)`. Keys are routed automatically:

- `headers` — real HTTP request headers (never in the URL). The API forwards `x-api-header-<name>` to the target as `<name>` (cookies, auth).
- Well-known capability keys nest under the product (`fullPage` → screenshot, `format` → pdf, `selector` → markdown).
- Everything else is a top-level API query param (`device`, `waitUntil`, `prerender`, `ttl`, `proxy`, …).

```js
await microlink.screenshot('https://example.com', {
  fullPage: true, // nests under screenshot
  device: 'iPhone 11' // top-level query param
})
```

## Products

An **asset** is `{ url, type, width, height, size, size_pretty }`. Playable assets add `duration` (seconds) and `duration_pretty`. `palette: true` adds `palette` (hex, dominant first), `background_color`, `color`, and `alternative_color` to image assets. A missing field is `null`.

| Need | Method |
| --- | --- |
| Link preview / metadata | `metadata(url)` |
| Markdown / HTML / text | `markdown` / `html` / `text` |
| Screenshot | `screenshot(url)` — `{ animated: true }` for a short video |
| PDF | `pdf(url)` |
| Brand logo | `logo(url)` |
| oEmbed iframe | `embed(url)` |
| Primary video / audio | `video(url)` / `audio(url)` |
| All links / images / videos / audios / emails | `links` / `images` / `videos` / `audios` / `emails` |
| Custom CSS rules | `extract(url, rules)` |
| Tech stack | `technologies(url)` |
| Lighthouse | `lighthouse(url)` |
| Google as structured data | `search(query)` — requires `apiKey` |
| Remote JavaScript | `function(url, code)` (`run` is an alias) |

### metadata(url, options)

Normalized fields from Open Graph, Twitter Cards, JSON-LD, and HTML:

`title`, `description`, `lang` (ISO 639-1), `author`, `publisher`, `date` (ISO 8601), `url`, `image` (asset), `logo` (asset). `video` and `audio` are off unless you pass `{ video: true }` or `{ audio: true }`, which adds that playable asset on the same object.

```js
const { title, description, image } = await microlink.metadata('https://vercel.com')
const { title: name, video } = await microlink.metadata(url, { video: true })
```

`meta` is `boolean`, or `{ logo: true | { square: true } }`. `palette: true` colors every image asset.

Pass `extract` rules as `data` to add fields, or to override a normalized one (`title`, `image`, `author`) when the detected value is wrong:

```js
const { title, price } = await microlink.metadata('https://example.com/product', {
  data: { price: { selector: '.price', attr: 'text', type: 'number' } }
})
```

### markdown / html / text

`markdown` and `text` resolve to `string | null`. `selector` scopes to the first match. `selectorAll` resolves to `string[]`, one string per match. `type` overrides normalization (same values as `extract`).

`markdown` keeps headings, links, lists, tables, and code, and drops nav, scripts, and styles. PDFs with a text layer and office files (`docx`, `xlsx`, `pptx`, `odt`, `rtf`, `epub`) convert the same way. `text` is the words only, with collapsed whitespace. `html` is rendered markup (inner HTML of `selector`). For the element including itself, use `extract` with `attr: 'outerHTML'`.

```js
const markdown = await microlink.markdown('https://example.com', { selector: 'article' })
const comments = await microlink.markdown(url, { selectorAll: '.comment' })
const html = await microlink.html('https://app.example.com', {
  prerender: true,
  styles: ['.banner { display: none }']
})
```

These three are `extract` rules with `attr: 'markdown' | 'html' | 'text'`. Use `extract` when one call must return Markdown plus other fields.

### screenshot(url, options)

Asset hosted on the Microlink CDN. The same call returns the same `url` until `ttl` expires.

| Key | | |
| --- | --- | --- |
| `fullPage` | boolean, default `false` | Entire scrollable page, not the viewport |
| `type` | `'png'` (default) or `'jpeg'` | Image format |
| `quality` | number, `0`–`100` | JPEG quality |
| `element` | string | CSS selector. Capture that element once it is visible |
| `omitBackground` | boolean, default `false` | Transparent background |
| `overlay` | object | `{ browser?: 'light' \| 'dark', background?: string }` |
| `codeScheme` | string, default `'atom-dark'` | Prism theme or remote CSS URL for JSON/text responses |
| `animated` | boolean, default `false` | Record a short MP4/WebM instead of a still |
| `palette` | boolean | Color fields on the screenshot asset |
| `optimizeForSpeed` | boolean, default `false` | Favor capture speed over size and fidelity |

```js
const { url } = await microlink.screenshot('https://example.com', {
  element: '#result',
  omitBackground: true
})
```

Put the hosted `url` in an `img`. For a URL that renders the image with no SDK call (`og:image`, a README), use an [embed URL](#embed-urls).

### pdf(url, options)

Asset `{ url, type, size, size_pretty }`. The page prints with `mediaType: 'print'`. Pass `mediaType: 'screen'` to print the screen layout.

| Key | | |
| --- | --- | --- |
| `format` | `'Letter'`, `'Legal'`, `'Tabloid'`, `'Ledger'`, `'A0'`–`'A6'` | Default `'A4'` |
| `landscape` | boolean | Landscape orientation |
| `margin` | string or `{ top, right, bottom, left }` | Each side is a string or number. Default `'0.35cm'` |
| `scale` | number `0.1`–`2` | Default `0.6` |
| `pageRanges` | string | e.g. `'1-5, 8, 11-13'` |
| `width` / `height` | string or number | Custom paper size, e.g. `'640px'` |
| `printBackground` | boolean | Include background graphics |

```js
const { url } = await microlink.pdf('https://example.com', {
  format: 'Letter',
  landscape: true,
  margin: { top: '1cm', right: '4mm', bottom: '1cm', left: '4mm' },
  pageRanges: '1-3'
})
```

### logo(url, options)

Asset or `null`. Detected from favicons, Apple touch icons, manifest icons, and structured data, then a logo service. `square: true` prefers a square variant (avatars, app icons). `palette: true` adds color fields. The same `logo` is on `metadata` when you also need title and description.

```js
const { url, palette, background_color } = await microlink.logo('https://stripe.com', {
  square: true,
  palette: true
})
```

### embed(url, options)

`{ html: string, scripts?: unknown[] }`. Each script is typically `{ src, async }`. `maxWidth` and `maxHeight` are pixels and are forwarded per the oEmbed spec, so support depends on the provider. The call resolves to `null` when the provider has no embed. Use `metadata` for a static card. Use `video` for a raw playable file.

```js
const { html, scripts } = await microlink.embed('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
  maxWidth: 350
})
```

### video(url) / audio(url)

Primary playable asset, or `null`. `video` includes `width` and `height`. `audio` does not. No method-specific keys. The same asset is `metadata(url, { video: true })` or `{ audio: true }` when you also want the other metadata fields. `videos` / `audios` sweep markup elements. `embed` returns the provider player.

```js
const { url, type, duration_pretty } = await microlink.video('https://vimeo.com/76979871')
```

### links / images / videos / audios / emails

`string[]`, absolute and deduped. Empty is `[]`. `links`, `images`, `videos`, and `audios` take `selector`, `selectorAll`, `attr`, and `type`. `emails` is typed with the shared options; those four keys still route, because the client treats it as a collection.

| Method | Default rule | Drops |
| --- | --- | --- |
| `links` | `selectorAll: 'a'`, `attr: 'href'`, `type: 'url'` | `mailto:`, `javascript:`, empty anchors |
| `images` | `selectorAll: 'img'`, `attr: 'src'`, `type: 'url'` | Non-URL `src`. Lazy galleries: `attr: 'data-src'` |
| `videos` | `selectorAll: ['video[src]', 'video source[src]']`, `attr: 'src'`, `type: 'url'` | Provider pages (YouTube, Vimeo) have no direct `video` source — use `video` |
| `audios` | `selectorAll: ['audio[src]', 'audio source[src]']`, `attr: 'src'`, `type: 'url'` | Provider pages (Spotify) — use `audio`. Episode files: `selectorAll: 'a[href$=".mp3"]'`, `attr: 'href'` |
| `emails` | `selector: 'html'`, `attr: 'html'`, `type: 'email'` | `mailto:` prefix is stripped. Obfuscated addresses are missed — use `function` |

```js
const links = await microlink.links('https://example.com', { selectorAll: 'nav a' })
const emails = await microlink.emails('https://microlink.io', { selector: 'footer' })
```

Open Graph images are not `img` tags. Use `metadata` for the representative image, or `extract` with `type: 'image'` when you need dimensions. Link text next to an href is a nested `extract` rule.

### extract(url, rules, options)

`rules` is `{ [field: string]: rule | rule[] }`. The result is that object, unwrapped: one key per field, `null` when a rule misses or fails `type`. Defaults to `meta: false`. `meta: true` returns metadata plus these fields.

A `rule` is:

| Key | Type | |
| --- | --- | --- |
| `selector` | `string \| string[]` | First CSS match (`querySelector`). An array is a fallback: first typed hit wins |
| `selectorAll` | `string \| string[]` | Every match. A list of values, or of objects when `attr` is a nested rules object |
| `attr` | `string \| string[] \| rules` | HTML attribute, or `html` (default), `outerHTML`, `text`, `markdown`, `json`, `val`. A string array is a fallback. An object nests rules under the parent match. `text` collapses whitespace. `json` parses the whole body and cannot combine with `selector` |
| `type` | see below | How to normalize. Default `'auto'`. `image`, `video`, `audio`, and `logo` become assets |
| `evaluate` | `string \| (() => unknown)` | JavaScript in the page. A function is serialized to source. Clicks, waits, and `require()` belong in `function` |

`type` is `'audio' \| 'author' \| 'auto' \| 'boolean' \| 'date' \| 'description' \| 'email' \| 'image' \| 'ip' \| 'lang' \| 'logo' \| 'number' \| 'object' \| 'publisher' \| 'regexp' \| 'string' \| 'title' \| 'url' \| 'video'`.

A rule needs `selector`, `selectorAll`, or `evaluate`, or `attr` alone to serialize the whole page. A field that is `rule[]` uses the first rule that yields a value. `page.extract(rules)` takes this same object.

```js
const { image } = await microlink.extract('https://microlink.io', {
  image: { selector: 'meta[property="og:image"]', attr: 'content', type: 'image' }
})

const { stories } = await microlink.extract('https://news.ycombinator.com', {
  stories: {
    selectorAll: '.athing',
    attr: {
      title: { selector: '.titleline > a', attr: 'text' },
      url: { selector: '.titleline > a', attr: 'href', type: 'url' }
    }
  }
})
```

```js
{
  title: [
    { selector: 'meta[property="og:title"]', attr: 'content' },
    { selector: 'h1', attr: 'text' }
  ]
}
```

```js
{ version: { evaluate: 'window.next.version', type: 'string' } }
{ content: { attr: 'markdown' } }
{ content: { attr: 'json' } }
```

### technologies(url, options)

Wappalyzer array. Each item: `name`, `confidence` (`0`–`100`), `logo` (URL), `url`, `categories` (string[], e.g. `['CDN']`). No method-specific keys.

```js
const technologies = await microlink.technologies('https://microlink.io')
```

### lighthouse(url, options)

Lighthouse result: `categories` (`.performance.score` and the others), `audits`, `timing`. `output: 'html'` or `'csv'` returns that format instead of the JSON object (default `'json'`). HTML renders at `https://lighthouse.microlink.io/`.

| Key | |
| --- | --- |
| `onlyCategories` | string[], e.g. `['performance', 'accessibility']` |
| `onlyAudits` | string[], e.g. `'largest-contentful-paint'` |
| `skipAudits` | string[] |
| `output` | `string` or `string[]`. `'json'` (default), `'html'`, `'csv'` |

`device` changes the emulated form factor. Reports are slow; set a long `ttl`. Other Lighthouse settings such as `preset` are not routed by the SDK.

```js
const report = await microlink.lighthouse('https://example.com', {
  onlyCategories: ['performance'],
  device: 'iPhone 11',
  ttl: '1d'
})
```

### search(query, options)

Google as structured data. Requires `apiKey`. The argument is a query, not a URL. Operators (`site:`, `filetype:`, quotes) pass through. Browser and page options do not apply. `timeout` does.

```js
const page = await microlink.search('Lotus Elise S2')
```

| Option | |
| --- | --- |
| `type` | Vertical below. Default `'search'` |
| `limit` | Max results per page |
| `page` | Page number, default `1`. `page.next()` fetches the next page with the same options |
| `location` | Two-letter country code, e.g. `'es'` |
| `period` | `'hour'`, `'day'`, `'week'`, `'month'`, `'year'` |
| `html` / `markdown` | boolean, default `false`. Fetch that content for the page and every result up front |

The page has `results`, plus `knowledgeGraph`, `peopleAlsoAsk`, and `relatedSearches` when the vertical returns them.

- `knowledgeGraph`: `title?`, `type?`, `website?`, `image? { url }`, `description?`, `descriptionSource?`, `descriptionLink?`, `attributes?` (string record)
- `peopleAlsoAsk[]`: `question`, `snippet`, `title`, `link`
- `relatedSearches[]`: `query`

A result with `url` has lazy `.html()` and `.markdown()`. The page has the same helpers. `{ html: true }` or `{ markdown: true }` resolves them immediately. `autocomplete` has no `url`.

| `type` | Result fields |
| --- | --- |
| `search` | `title`, `url`, `description` |
| `news` | `title`, `url`, `description`, `date` (ISO 8601), `publisher`, `image? { url }` |
| `images` | `title`, `url` (source page), `image { url, width, height }`, `thumbnail { url, width, height }`, `google? { url }`, `creator?`, `credit?` |
| `videos` | `title`, `url`, `description`, `image? { url }`, `video? { url }`, `duration?` (ms), `duration_pretty?`, `publisher?`, `channel?`, `date?` |
| `places` | `title`, `address`, `latitude`, `longitude`, `phone? { number }`, `url?`, `cid` |
| `maps` | `title`, `address`, `latitude`, `longitude`, `rating?`, `ratingCount?`, `price? { level: string }`, `type?`, `types?`, `url?`, `phone? { number }`, `description?`, `opening? { hours: Record<string, string> }`, `thumbnail? { url }`, `cid`, `fid?`, `place? { id }` |
| `shopping` | `title`, `url`, `publisher`, `price { symbol: string, amount: number }`, `image? { url }`, `rating? { score: number, total: number, reviews?: number }`, `id?` |
| `scholar` | `title`, `url`, `description`, `publisher`, `year`, `citations`, `pdf? { url }`, `id` |
| `patents` | `title`, `description`, `url`, `inventor`, `assignee`, `language`, `priority { date }`, `filing { date }`, `grant? { date }`, `publication { date, number }`, `pdf? { url }`, `thumbnail? { url }`, `figures? [{ image: { url }, thumbnail: { url } }]`, `id?` |
| `autocomplete` | `value` |

```js
await microlink.search('open source llm', { type: 'news', period: 'week', location: 'us', limit: 10 })

const page = await microlink.search('site:openai.com function calling guide')
const markdown = await page.results[0].markdown()
const next = await page.next()
```

### function(url, code, options)

JavaScript in Microlink's sandbox. `run` is the same method. Code that never mentions `page` does not start a browser.

The function is typed as `({ page, response, headers, url })`. `response` is the Puppeteer `HTTPResponse` of the navigation. `headers` is `Record<string, string>`. Any option that is not an API parameter is also a named argument. `response` is present when the code uses `page`. `require()` any npm package (`require('cheerio@1.0.0')` to pin). The SDK compresses the body; the free code-size limit applies to the compressed payload. You can also pass code as a string.

`page` is a Puppeteer `Page`, plus:

- `page.extract(rules)` — `rules` is the `{ [field]: rule | rule[] }` object defined in `extract(url, rules, options)`. Returns one key per field, `null` on a miss. After `click`, `waitForSelector`, or navigation, the rules read the DOM those steps left behind. Literal selector rules read the fetched HTML and skip the browser. A rule with `evaluate`, or any other `page` method, reads the live page.
- `page.metadata()` — unified metadata for the request URL (`title`, `description`, `image`, …).

Prefer `extract` when the fields are already in the fetched page, and `styles` / `scripts` / `modules` / `click` / `waitForSelector` to prepare the page before the function runs. Use `function` to click, wait, compute, or `require()` a package. Prefer `page.title()`, `page.$eval()`, and `page.waitForSelector()` over `page.evaluate()` and fixed timeouts.

```js
const { value: items } = await microlink.function('https://example.com', async ({ page }) => {
  await page.click('button.load-more')
  await page.waitForSelector('.item')
  return page.extract({
    items: {
      selectorAll: '.item',
      attr: {
        title: { selector: 'h2', attr: 'text' },
        price: { selector: '.price', type: 'number' }
      }
    }
  })
})

const { value: title } = await microlink.function(
  'https://example.com',
  ({ page, selector }) => page.$eval(selector, el => el.textContent),
  { selector: 'h1' }
)
```

Result: `{ isFulfilled, value, logging, profiling }`. A throw still resolves: `isFulfilled` is `false` and `value` is `{ name, message }`. `profiling` has `phases` (`install`, `build`, `spawn`, `run`, `total`), `cpu`, `memory`, and `size`. `logging` is captured console output. The method sends `meta: false`. Pass `meta: true` to also get metadata on the API response.

| | Free | Pro |
| --- | --- | --- |
| Timeout | 15s | 60s |
| Memory | 64 MB | 128 MB |
| Code size | 1024 bytes | unlimited |
| Concurrency | 1 per IP | unlimited |
| Outgoing requests | same origin only | unrestricted |

Limit errors resolve with `isFulfilled: false`: `TimeoutError`, `CpuTimeError`, `MemoryError`, `CodeSizeError`, `ConcurrencyError`, `OutgoingRequestError`. Syntax is `EINVALFUNCTION`. A runtime throw is `EINVALEVAL`.

## Shared options

Any URL product takes these alongside its own keys. `search` does not, except `timeout`.

### Browser

- `device` `<string>` — preset viewport, user agent, and capabilities. Default `'macbook pro 13'`. Case-insensitive. iPhone, iPad, Galaxy, Pixel, MacBook, iMac, and others.
- `viewport` `<object>` — `width`, `height`, `deviceScaleFactor`, `isMobile`, `hasTouch`, `isLandscape`. Partial objects merge with the device preset.
- `colorScheme` `<string>` — `'light'`, `'dark'`, or `'no-preference'` (default).
- `mediaType` `<string>` — `'screen'` (default) or `'print'`. PDF defaults to `'print'`.
- `javascript` `<boolean>` — default `true`.
- `animations` `<boolean>` — CSS animations and transitions. Default `false`.
- `adblock` `<boolean>` — ads, trackers, and cookie consent. Default `true`.

### Page

- `prerender` `<boolean | 'auto'>` — `true` forces a headless browser (SPAs). `false` is a plain GET. Default `'auto'`.
- `waitUntil` `<string | string[]>` — `'auto'` (default), `'load'`, `'domcontentloaded'`, `'networkidle0'`, `'networkidle2'`.
- `waitForSelector` `<string>` — wait until this CSS selector exists.
- `waitForTimeout` `<number>` — milliseconds. Prefer `waitForSelector`. The API also accepts a duration string such as `'3s'`.
- `timeout` `<number>` — milliseconds for the whole request. Default about 30s free, 60s pro. The API also accepts `'30s'`.
- `click` `<string | string[]>` — click these selectors before the product runs.
- `scroll` `<string>` — scroll to this selector.
- `scripts` / `modules` / `styles` `<string | string[]>` — inject script, `<script type="module">`, or CSS. Inline source or an absolute URL.

### Cache and request

- `ttl` `<string | number>` — cache lifetime, `1m`–`31d`. Default `'24h'`. Aliases `'min'` and `'max'`. **Pro.**
- `staleTtl` `<string | number>` — serve stale while refreshing. `0` always revalidates in the background. Must be below `ttl`. **Pro.**
- `cacheKey` `<string>` — extra cache-key segment. **Pro.**
- `force` `<boolean>` — skip the cache. Default `false`.
- `retry` `<number>` — retries after an internal browser error. Default `2`.
- `ping` `<boolean | object>` — check that URLs in the payload are reachable. Default `true`. Disable per type: `{ audio: false }`.
- `palette` `<boolean>` — color fields on image assets. Default `false`.
- `filter` `<string>` — comma-separated fields to keep, with dot paths: `'url,title,image.url'`.
- `proxy` `<string | { url } | { location }>` — HTTP proxy, or a country via `{ location }`. **Pro.**
- `filename` `<string>` — download name for a generated asset. **Pro.**
- `headers` `<object>` — sent as real request headers, never in the URL. `x-api-header-<name>` is forwarded to the target as `<name>`. **Pro.**

`metadata` returns the normalized fields. Every other method returns only its own value. `logo` still runs metadata detection to find the mark. Pass `meta: true` on `extract` or `function` when the caller also needs those fields.

## Raw HTTP

Without the SDK, each product is a `GET` to `api.microlink.io` or `pro.microlink.io`. Names accept `camelCase` and `snake_case`. Nested keys use dots (`screenshot.fullPage`). Encode every value.

The body is JSend. Read the product from `data`. `status` is `success`, `fail`, or `error`. A fetched page also includes `statusCode`, `headers`, and `redirects` on `data`. `embed` replaces the JSON with that field's body. A `fail` body has `code`, `message`, `more`, and field errors on `data`. The id is `x-request-id`.

| Product | Query |
| --- | --- |
| `metadata` | `url` (`meta` defaults to `true`) |
| `markdown` / `html` / `text` | `data.content.attr=markdown` (or `html`, `text`), plus `data.content.selector` |
| `screenshot` | `screenshot=true` or `screenshot.fullPage=true` |
| `pdf` | `pdf=true` or `pdf.format=A4` |
| `logo` | `meta=true`, read `data.logo`. Square: `meta.logo.square=true` |
| `embed` | `iframe=true`, `iframe.maxWidth` |
| `video` / `audio` | `video=true` / `audio=true` |
| `links` / `images` / `videos` / `audios` / `emails` | the default `data` rule for that method |
| `extract` | `data.<field>.selector`, `.attr`, `.type`, `.selectorAll`, `.evaluate` |
| `technologies` | `insights.technologies=true` |
| `lighthouse` | `insights.lighthouse=true`, `insights.lighthouse.onlyCategories` |
| `function` | `function=<source>`. Compress with an `lz#`, `gz#`, or `br#` prefix |

`meta=false` when the caller only wants the asset or `data` fields. A fallback list is numbered: `data.title.0.selector=h1`, `data.title.1.selector=title`. The Pro key is the `x-api-key` header.

## Embed URLs

Return one field as the response body, for an `img`, CSS background, or Open Graph tag. Do not put an API key in the URL.

```html
<img src="https://api.microlink.io/?url=https://example.com&screenshot=true&meta=false&embed=screenshot.url">
```

Paths: `screenshot.url`, `pdf.url`, `image.url`, `logo.url`, `video.url`.

## Authentication

`apiKey` is sent as `x-api-key`. Never put secrets in URLs.

```js
const microlink = createClient({ apiKey: process.env.MICROLINK_API_KEY })

await microlink.markdown('https://x.com/some/article', {
  headers: { 'x-api-header-cookie': 'auth_token=...' } // forwarded as `cookie`
})
```

- Free: `https://api.microlink.io` — no key, soft limit of 25 requests
- Pro: `https://pro.microlink.io` — set `apiKey` (or `endpoint` to override). Quota starts at 14,000 on the key's plan

A key sent to `api.microlink.io` returns `EPRO`. `x-pricing-plan` is `free` or `pro`. Free responses include `x-rate-limit-limit`, `x-rate-limit-remaining`, and `x-rate-limit-reset` (UTC epoch seconds). Parallel requests are allowed inside the quota. HTTP 429 is `ERATE`.

Never expose `apiKey` in client-side code. Proxy through a server (`microlinkhq/proxy` or `microlinkhq/edge-proxy`).

## Error Handling

API errors reject with `MicrolinkError`: `status`, `code`, `statusCode`, `description`, `url`, `headers`, `more`.

```js
import createClient, { MicrolinkError } from 'microlink.io'

try {
  await microlink.screenshot('https://example.com')
} catch (error) {
  if (error instanceof MicrolinkError) console.error(error.code, error.description)
}
```

`client.last` is the last call: `requestUrl`, `requestOptions`, and `response` (status, headers such as `x-request-id`, `x-cache-status`, `x-fetch-mode`).

| Code | What to do |
| --- | --- |
| `EAUTH` | API key is invalid |
| `ERATE` | Quota spent. Wait for `x-rate-limit-reset` or use a key |
| `EINVALURL` | URL must be a WHATWG URL with `http` or `https` |
| `EBRWSRTIMEOUT` / `ETIMEOUT` | Simplify the page, or raise `timeout` (pro: up to 60s) |
| `EPRO` / `EHEADERS` / `EPROXY` / `ETTL` / `ESTTL` / `EFILENAME` | That option needs Pro (`apiKey` → `pro.microlink.io`) |
| `EPROXYNEEDED` | The target blocked the datacenter IP. Use Pro `proxy` |
| `EMAXREDIRECTS` | More than 10 redirects |
| `EINVALTTL` / `EINVALSTTL` | `ttl` is `1m`–`31d`. `staleTtl` must be below `ttl` |

## Reporting problems

When Microlink misbehaves (an unexpected error, wrong or incomplete output, docs that disagree with the API, or a missing feature), report it to the Microlink team with one HTTP request. No account and no credits. Report only after ruling out your own mistake: a wrong parameter, an expected error from the table above, or a target page that is itself broken.

```bash
curl -X POST https://feedback.microlink.io/api/v1/feedback \
  -H 'content-type: application/json' \
  -d '{
  "category": "quality_degradation",
  "note": "markdown drops the pricing table; expected all 4 tiers.",
  "request_id": "iad:2c1f8a1e-4b7d-4f0e-9a51-6f2f1d9b8c3a",
  "request_url": "https://api.microlink.io/?url=https%3A%2F%2Fstripe.com%2Fpricing&markdown=true"
}'
```

| Field | Notes |
| --- | --- |
| `category` | Required: `bug`, `quality_degradation`, `docs_mismatch`, `friction`, `feature_gap` or `other` |
| `note` | Required: what happened and what you expected, up to 4000 characters |
| `request_id` | The `x-request-id` response header (`client.last.response.headers`) |
| `request_url` | The full API URL you called (`client.last.requestUrl`). Values of `headers.*` and `proxy` are redacted before storing |
| `error_code` | The error `code`, e.g. `EFATAL` |
| `contact_email` | Only with the user's consent: where the team can say when it is fixed |

`bug` and `quality_degradation` need `request_id` or `request_url`: the bare target URL is not enough to reproduce the call. If your HTTP tool can only GET, send the same fields as query parameters to the same URL.

The response holds a `receipt` URL. `GET` it to follow up: it returns your stored `report`, the `status` (`open`, `triaged`, `resolved`, `wontfix`), and the team's `reply` once it is resolved. A `400` names every invalid field in `errors`. The full contract is at `https://feedback.microlink.io/.well-known/agent-feedback.json`.

## CLI

`npx microlink.io` works without a global install. `buy` purchases a key; `login` saves one; `logout` clears it. `setup` detects installed coding agents and installs this skill for them. A bare URL defaults to `metadata`. `<product> docs` prints canonical parameter markdown.

```bash
npx microlink.io buy
npx microlink.io login
npx microlink.io setup
npx microlink.io help screenshot
npx microlink.io markdown docs
npx microlink.io https://example.com
npx microlink.io markdown https://example.com --selector article
npx microlink.io screenshot https://example.com --fullPage
npx microlink.io logo https://github.com --square
npx microlink.io links https://example.com
npx microlink.io search "best coffee" --limit 10 --location es
npx microlink.io search "the matrix" --markdown --page 2
npx microlink.io extract https://microlink.io --data '{"image":{"selector":"meta[property=og:image]","attr":"content","type":"image"}}'
npx microlink.io function https://example.com --file ./fn.js --selector h1
```

Shared flags: `--api-key`, `--endpoint`, `--header` / `-H`, `--http.header.<name>`, `--trace`, `--trace-full`. `--trace` is not supported for `search` / `function`.

On `429`, the CLI hints to run `microlink buy` or `microlink login`.

## In the assistant

MCP is how this session *runs* a product. Do not tell the user to pick "skill vs MCP".

- **Ship code / CLI / HTTP** → methods in this skill. Skip MCP.
- **Do it now** (screenshot this URL, markdown that page) → use Microlink MCP tools.

If those tools are missing:

1. Merge a `microlink` server into the client config. Don't wipe other servers.
2. Cursor / Claude Desktop: `.cursor/mcp.json` or `~/Library/Application Support/Claude/claude_desktop_config.json` with `mcpServers`. VS Code: `.vscode/mcp.json` with `servers` and `"type": "stdio"`.
3. Reload MCP if the client requires it, then call the tools.

```json
{
  "mcpServers": {
    "microlink": {
      "command": "npx",
      "args": ["-y", "@microlink/mcp"],
      "env": { "MICROLINK_API_KEY": "YOUR_MICROLINK_API_KEY" }
    }
  }
}
```

Tool names are `microlink_<method>` (`screenshot` → `microlink_screenshot`). Arguments are the options in this file. Booleans accept `"true"` / `"false"`. Objects accept JSON strings. `screenshot`, `pdf`, and insights accept `true` or an object; `{}` is `true`.

`microlink_function` takes `code` as a source string (`"async ({ page }) => page.title()"`). `microlink_search` takes `query` and requires a key. `microlink_docs({ product })` returns this same reference; do not call it to discover options you already have here.

Success is `{ data }` under `structuredContent` — the direct result (`markdown` is a string, `screenshot` is an asset, `links` is `string[]`). Failure is MCP `isError` plus `{ error: { message, code?, status?, statusCode?, hint?, reason? } }`. `reason: "upgrade_required"` means a Pro capability (`EPROXYNEEDED`, `EINTEGRATION`). `reason: "quota_exceeded"` is the free quota. Read `hint` before retrying.

No key, and the call needs Pro or `search`:

1. `microlink_list_plans` — pick a `planId`
2. `microlink_create_checkout_session` — `email`, `planId`; optional `label`, `idempotencyKey`
3. Give `checkoutUrl` to the human. Do not open or complete it
4. Poll `microlink_get_checkout_session` with `sessionId` until `ready` or `expired`

`ready` includes `keyId`. The secret is emailed. It is not in the tool result. Key resolution: tool `apiKey`, then `Authorization: Bearer`, then `x-api-key`, then `MICROLINK_API_KEY`.

Don't shell out to `npx microlink.io` for one-shot chat work when MCP is available.
