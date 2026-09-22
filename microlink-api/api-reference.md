# Microlink API Parameter Reference

Use this file as the deep reference.

- For quick task-oriented guidance, start in https://raw.githubusercontent.com/microlinkhq/skills/master/microlink-api/SKILL.md
- For practical examples, use https://raw.githubusercontent.com/microlinkhq/skills/master/microlink-api/common-workflows/README.md
- For exact parameter behavior, defaults, and edge cases, use this file.
- Parameter names accept both `camelCase` and `snake_case`.

## url (required)

- Type: `<string>`
- Must include protocol (`http://` or `https://`)
- Must be publicly reachable
- Must follow WHATWG URL standard
- If the target URL has its own query string, encode the `url` value so those parameters are not read as Microlink parameters
- Protocol affects relative URL resolution inside the target page

## meta

- Type: `<boolean>` | `<object>`
- Default: `true`

Enable/disable normalized metadata detection. When `true` (default), extracts: `title`, `description`, `author`, `publisher`, `date`, `lang`, `url`, `image`, `video`, `logo`.

Configurable detection:

- Include specific fields: `meta.author=true&meta.title=true` (only those fields)
- Exclude specific fields: `meta.image=false&meta.logo=false` (all except those)
- Square logo: `meta.logo.square=true`
- Disable entirely: `meta=false` (speeds up screenshot/video-only requests)

Reflected as `x-fetch-mode: skipped` in response headers when disabled.

## data

- Type: `<object>`

Custom data extraction using CSS selectors. Each key defines a field name, value is a rule object:

| Property    | Type                        | Description                                                                                                                                                                                          |
| ----------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| selector    | string \| string[]          | CSS selector (`querySelector`). A list is `selector.0`, `selector.1`                                                                                                                                 |
| selectorAll | string \| string[]          | CSS selector for collections (`querySelectorAll`). Same list form                                                                                                                                    |
| attr        | string \| string[] \| object | HTML attribute, or `'html'`, `'outerHTML'`, `'text'`, `'markdown'`, `'val'`. A list reads several attributes. An object nests more rules                                                             |
| type        | string                      | `'auto'`, `'string'`, `'number'`, `'boolean'`, `'date'`, `'url'`, `'image'`, `'audio'`, `'video'`, `'email'`, `'ip'`, `'lang'`, `'logo'`, `'object'`, `'regexp'`, `'author'`, `'description'`, `'publisher'`, `'title'` |
| evaluate    | string                      | JavaScript to evaluate in browser context                                                                                                                                                            |

`type=url` returns a URL string. `type=image`, `audio`, `video`, and `logo` return an asset (`url`, `type`, `size`, `size_pretty`, `width`, `height`).

Supports:

- **Fallback rules**: Pass array of rule objects; first truthy result wins
- **Nested rules**: Use `attr` as object with sub-rules
- **Collections**: Use `selectorAll` instead of `selector`
- **Whole-page serialization**: Omit `selector` and set `attr` to `markdown`, `html`, or `text`. Name the field the same way: `data.markdown.attr=markdown`. Scope with `data.markdown.selector`

## screenshot

- Type: `<boolean>`
- Default: `false`

Generates screenshot, returned as `data.screenshot` with `url`, `width`, `height`, `type`, `size`, `size_pretty`.

Sub-parameters:

- `screenshot.element` (string): CSS selector to capture specific DOM element
- `screenshot.fullPage` (boolean, default `false`): Full scrollable page capture
- `screenshot.type` (string, default `'png'`): `'jpeg'` or `'png'`
- `screenshot.omitBackground` (boolean, default `false`): Transparent background
- `screenshot.overlay.browser` (string): `'light'` or `'dark'` browser chrome overlay
- `screenshot.overlay.background` (string): Hex color, CSS gradient, or image URL
- `screenshot.codeScheme` (string, default `'atom-dark'`): Syntax highlighting for JSON/HTML content. Accepts prism-themes identifier or remote CSS URL
- `screenshot.optimizeForSpeed` (boolean): Faster encode, larger file
- `screenshot.animated` (boolean): GIF/MP4 instead of a still
- `screenshot.palette` (boolean): Dominant colors for this capture
- `screenshot.quality` (number): JPEG quality

## pdf

- Type: `<boolean>`
- Default: `false`

Generates PDF. Default `mediaType` becomes `'print'`.

Sub-parameters:

- `pdf.format` (string): `'A4'`, `'Letter'`, `'Legal'`, etc.
- `pdf.landscape` (boolean, default `false`)
- `pdf.scale` (number): Scale factor
- `pdf.margin` (string/object): e.g., `'0.4cm'` or `{ top: '1cm', bottom: '1cm' }`
- `pdf.pageRanges` (string): e.g., `'1-3'`
- `pdf.width` (string): Override width
- `pdf.height` (string): Override height
- `pdf.printBackground` (boolean): Include CSS backgrounds

## embed

- Type: `<string>`

Returns a specific data field directly as the response body with matching content-type headers. Use dot notation: `'screenshot.url'`, `'pdf.url'`, `'image.url'`, `'logo.url'`, `'video.url'`.

Transforms the API from a JSON endpoint into a direct asset server. Useful in `<img>` tags, CSS `background-image`, Markdown, and Open Graph meta tags.

## video

- Type: `<boolean>`
- Default: `false`

Detects browser-friendly video source URL. Adds `data.video` with `url`, `type`, `duration`, `size`, `width`, `height`, `duration_pretty`, `size_pretty`.

## audio

- Type: `<boolean>`
- Default: `false`

Detects browser-friendly audio source URL. Adds `data.audio` with `url`, `type`, `duration`, `size`, `duration_pretty`, `size_pretty`.

## iframe

- Type: `<boolean>` | `<object>`
- Default: `false`

Detects oEmbed content. Returns `data.iframe` with `html` and `scripts`. Consumer limits are `iframe.maxWidth` and `iframe.maxHeight`.

## insights

- Type: `<boolean>` | `<object>`
- Default: `false`

Returns `data.insights` with:

- `technologies`: Wappalyzer-powered tech stack detection
- `lighthouse`: Full Lighthouse audit report

Turn one on and the other off: `insights.lighthouse=true&insights.technologies=false`.

Lighthouse keys (`insights.lighthouse.<key>`): `onlyCategories`, `onlyAudits`, `skipAudits`, `output`.

## palette

- Type: `<boolean>`
- Default: `false`

Adds per-image color info: `palette` (hex array, dominant to least), `background_color` (WCAG-compliant), `color`, `alternative_color`.

## filter

- Type: `<string>`

Comma-separated list of fields to return. Supports dot notation. Reduces payload size.

Example: `filter: 'url,title'`

## prerender

- Type: `<boolean>` | `<string>`
- Default: `'auto'`
- Values: `'auto'`, `true`, `false`

Controls fetch method:

- `true`: Headless browser (needed for SPAs)
- `false`: Simple HTTP GET (faster)
- `'auto'`: Service auto-detects

Response headers: `x-fetch-mode` (`'prerender'` or `'fetch'`), `x-fetch-time`.

## function

- Type: `<string>`

Executes JavaScript. If the code does not reference `page`, no browser starts. Receives `{ page, response, headers, url }` plus extra query params forwarded into scope.
- `url`: target URL (available without a browser)
- `page`: Puppeteer Page (`metadata()`, `extract(rules)`, plus standard Page methods)
- `response`: HTTP response from the implicit navigation (only when `page` is used)
- `headers`: request headers used to fetch the target

Compression: Prefix with `lz#`, `gz#`, or `br#` for compressed function bodies.

`require()` any npm package (`require('cheerio@1.0.0')` to pin). Free timeout is 10s (Pro up to 60s).

## device

- Type: `<string>`
- Default: `'macbook pro 13'`

Emulates device viewport, user agent, and screen resolution. Case-insensitive. Supports: iPhone (4-13 series), iPad, iPad Pro, Galaxy series, Pixel series, Macbook Pro (13/15/16), iMac series, and many more.

## viewport

- Type: `<object>`

Custom browser viewport: `width`, `height`, `deviceScaleFactor`, `isMobile`, `hasTouch`, `isLandscape`. Merged with device defaults when partially specified.

## Browser Interaction

- `click` (string/string[]): Click CSS selector(s)
- `scroll` (string): Scroll to CSS selector
- `waitUntil` (string/string[], default `'auto'`): Navigation events: `'load'`, `'domcontentloaded'`, `'networkidle0'`, `'networkidle2'`
- `waitForSelector` (string): Wait for CSS selector to appear
- `waitForTimeout` (string/number): Wait fixed duration (e.g., `'3s'`, `3000`)
- `timeout` (string/number, default `28s`): Max request lifecycle

## Content Injection

- `scripts` (string/string[]): Inject `<script>` — inline code or absolute URLs
- `modules` (string/string[]): Inject `<script type="module">`
- `styles` (string/string[]): Inject `<style>` — inline CSS or absolute URLs

## Rendering Options

- `javascript` (boolean, default `true`): Enable/disable JS execution
- `animations` (boolean, default `false`): Enable CSS animations/transitions
- `colorScheme` (string, default `'no-preference'`): `'light'` or `'dark'`
- `mediaType` (string, default `'screen'`): `'screen'` or `'print'`
- `adblock` (boolean, default `true`): Block ads/trackers

## Cache & Performance

- `ttl` (string/number, default `'24h'`): Cache lifetime (1m–31d). Aliases: `'min'` (1m), `'max'` (31d). **Pro only.**
- `staleTtl` (string/number/boolean, default `false`): Stale-while-revalidate. Set `staleTtl=0` to always revalidate in background. **Pro only.**
- `cacheKey` (string): Custom cache key. **Pro only.**
- `force` (boolean, default `false`): Bypass cache entirely
- `retry` (number, default `2`): Exponential backoff retries
- `ping` (boolean/object, default `true`): Verify URL reachability. Disable per-type: `ping: { audio: false }`

## Pro-Only Parameters

- `headers` (object): Custom HTTP headers for target URL. Use `x-api-header-*` prefix for sensitive headers (not exposed in URL)
- `proxy` (string/object): Custom proxy URL or `{ url }` / `{ location }` (country). Reflected in `x-fetch-mode: prerender-proxy`
- `filename` (string): Custom filename for generated assets
- `ttl`, `staleTtl`, `cacheKey`: Cache control

## Compression

Brotli (`br`) and gzip (`gz`) are supported. Send `Accept-Encoding` and check `content-encoding` on the response.

## Rate Limiting

Quota depends on the endpoint. See [Rate limit](https://microlink.io/docs/api/basics/rate-limit).

- Free (unauthenticated): soft limit of 25 requests
- Pro (authenticated): the plan on the API key, from 14,000 requests

HTTP 429 (`ERATE`) when the quota is spent. Wait for reset, or upgrade. No throttling — parallel requests are allowed inside the quota.

Free responses carry the current window:

| Header                   | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `x-rate-limit-limit`     | Maximum requests permitted per minute                                        |
| `x-rate-limit-remaining` | Requests remaining in the current window                                     |
| `x-rate-limit-reset`     | When the current window resets, as UTC epoch seconds                         |

## Error Codes (Complete)

| Code            | Message                      | Solution                                        |
| --------------- | ---------------------------- | ----------------------------------------------- |
| EAUTH           | Invalid API key              | Check `x-api-key` header                        |
| ERATE           | Daily rate limit reached     | Wait for reset or upgrade                       |
| EBRWSRTIMEOUT   | Browser navigation timeout   | Reduce page complexity or increase timeout      |
| EFATAL          | Generic failure              | Contact support with request `id`               |
| EFATALCLIENT    | Network unreachable          | Check connectivity to endpoint                  |
| EFORBIDDENURL   | Forbidden IP range           | Only unicast IPs allowed                        |
| EINVALURL       | Invalid URL                  | Must be WHATWG URL with protocol                |
| EINVALPROXY     | Invalid proxy URL            | Must be parseable WHATWG URL                    |
| EINVALTTL       | Invalid TTL                  | Must be between 1m and 31d                      |
| EINVALSTTL      | Invalid staleTtl             | Must be less than current TTL                   |
| EINVALOVERLAYBG | Invalid gradient             | Follow CSS gradient syntax                      |
| EMAXREDIRECTS   | Too many redirects           | Max 10 hops allowed                             |
| EPRO            | Auth on free endpoint        | Use pro.microlink.io for authenticated requests |
| EPROXY          | Proxy requires Pro           | Upgrade plan                                    |
| EPROXYNEEDED    | Anti-bot protection detected | Upgrade to Pro plan                             |
| EFILENAME       | Filename requires Pro        | Upgrade plan                                    |
| EHEADERS        | Headers requires Pro         | Upgrade plan                                    |
| ETIMEOUT        | Request timeout              | Resolve before timeout limit                    |
| ETTL            | TTL requires Pro             | Upgrade plan                                    |
| ESTTL           | staleTtl requires Pro        | Upgrade plan                                    |

## Response Headers

| Header                   | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `x-pricing-plan`         | `'free'` or `'pro'`                                |
| `x-cache-status`         | `'HIT'`, `'MISS'`, `'BYPASS'`                      |
| `x-cache-ttl`            | Cache TTL in milliseconds                          |
| `x-fetch-mode`           | `'fetch'`, `'prerender'`, `'skipped'`, `'proxy-*'` |
| `x-fetch-time`           | Time spent fetching                                |
| `x-response-time`        | Total response time                                |
| `x-request-id`           | Unique request identifier                          |
| `x-rate-limit-limit`     | Free plan. Maximum requests permitted per minute   |
| `x-rate-limit-remaining` | Free plan. Requests remaining in the current window |
| `x-rate-limit-reset`     | Free plan. Window reset, UTC epoch seconds         |
| `cf-cache-status`        | CloudFlare edge cache status                       |
