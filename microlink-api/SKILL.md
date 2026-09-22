---
name: microlink-api
description: Not an entry point. Product methods, options, and the raw HTTP query map live in the microlink skill. Open this only for extra curl recipes.
---

# Microlink API

HTTP API at `api.microlink.io`. Every call is a `GET` with query parameters. Any HTTP client can send it. Product methods and the CLI live in the [microlink](https://raw.githubusercontent.com/microlinkhq/skills/master/microlink/SKILL.md) skill.

Parameter names accept `camelCase` and `snake_case`. Nested options use dots (`screenshot.fullPage`). Encode every value. `curl --data-urlencode` does that for the text after `=`.

## Endpoints

- Free: `https://api.microlink.io` — no key, soft limit of 25 requests
- Pro: `https://pro.microlink.io` — `x-api-key` request header, from 14,000 requests on the key's plan

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com"
```

```bash
curl -G "https://pro.microlink.io" \
  -H "x-api-key: $MICROLINK_API_KEY" \
  --data-urlencode "url=https://example.com"
```

The key is a header. A key sent to `api.microlink.io` returns `EPRO`. Confirm the plan with `x-pricing-plan` (`free` or `pro`).

Forward a header to the target by prefixing `x-api-header-`. The API strips the prefix. This keeps cookies and auth out of the query string:

```bash
curl -G "https://pro.microlink.io" \
  -H "x-api-key: $MICROLINK_API_KEY" \
  -H "x-api-header-cookie: auth_token=..." \
  --data-urlencode "url=https://example.com"
```

That arrives at the target as `cookie`.

## Response

JSON, JSend-shaped. Read fields from `data`. A fetched page also includes the target `statusCode`, `headers`, and `redirects`.

```json
{
  "status": "success",
  "data": {
    "title": "Example Domain",
    "description": "...",
    "image": { "url": "..." },
    "logo": { "url": "..." },
    "url": "https://example.com/"
  }
}
```

`status` is `success` (2xx), `fail` (4xx), or `error` (5xx). `embed` replaces this JSON with the chosen field as the body.

## When To Use What

| Need | Query | Read |
| --- | --- | --- |
| Metadata | `url` (`meta` defaults to `true`) | `data.title`, `description`, `author`, `publisher`, `date`, `lang`, `url`, `image`, `logo` — each may be `null` |
| One metadata field | `filter=title,description,image.url` | those fields only |
| Logo | included in metadata; `meta.logo.square=true` for the icon | `data.logo` (asset or `null`) |
| Screenshot | `screenshot=true` | `data.screenshot` |
| PDF | `pdf=true` | `data.pdf` |
| Video / audio source | `video=true` / `audio=true` | `data.video` / `data.audio` (asset or `null`) |
| oEmbed player | `iframe=true` | `data.iframe` (`html`, `scripts`) |
| Tech stack | `insights.technologies=true` and `insights.lighthouse=false` | `data.insights.technologies` |
| Lighthouse | `insights.lighthouse=true` and `insights.technologies=false` | `data.insights.lighthouse` |
| Page as markdown, HTML, or text | `data.markdown.attr=markdown` (same for `html`, `text`) | `data.markdown` (string or `null`) |
| Links, images, videos, audios, emails | `data` rules below | `string[]` |
| Custom DOM fields | `data.<field>.*` | `data.<field>` |
| One field as the body | `embed=screenshot.url` | raw body |
| Run JavaScript | `function=<expression>` | `data.function` |
| JS-heavy page | `prerender=true` (default `auto`) | `x-fetch-mode` |

An asset is `{ url, type, size, size_pretty, width, height }`. Set `meta=false` when the response only needs an asset or `data` fields.

Copy-paste requests: [common-workflows](https://raw.githubusercontent.com/microlinkhq/skills/master/microlink-api/common-workflows/README.md).

## Parameters At A Glance

### Core

- `url` (required): target URL with protocol. Encode it when it has its own query string.
- `meta` (default `true`): normalized metadata. `meta.author=true` keeps only those fields. `meta.image=false` drops those fields. `meta.logo.square=true` asks for the square logo. `meta=false` skips detection (`x-fetch-mode: skipped`).
- `data`: custom extraction rules
- `filter`: comma-separated fields, dot notation allowed (`url,title,image.url`)
- `embed`: return one field as the body

### Asset generation

- `screenshot` / `screenshot.*`: page image under `data.screenshot` (`url`, `type`, `width`, `height`, `size`, `size_pretty`)
- `pdf` / `pdf.*`: PDF under `data.pdf`
- `video`, `audio`: playable source under `data.video` / `data.audio`
- `iframe`: oEmbed under `data.iframe`. Limits: `iframe.maxWidth`, `iframe.maxHeight`.
- `insights.technologies`, `insights.lighthouse`: turn one on and the other off. Lighthouse keys: `onlyCategories`, `onlyAudits`, `skipAudits`, `output` (`insights.lighthouse.onlyCategories`).
- `palette`: per-image colors

Screenshot keys (`screenshot.<key>`): `fullPage`, `type` (`png`/`jpeg`), `overlay`, `element`, `omitBackground`, `optimizeForSpeed`, `codeScheme`, `animated`, `palette`, `quality`.

PDF keys (`pdf.<key>`): `format`, `margin`, `scale`, `landscape`, `pageRanges`, `width`, `height`, `printBackground`. Default `mediaType` becomes `print`.

### Browser behavior

- `prerender`: `auto` (default), `true`, or `false`. Response: `x-fetch-mode`, `x-fetch-time`.
- `waitUntil`, `waitForSelector`, `waitForTimeout`, `timeout`
- `device`, `viewport`, `javascript`, `animations`, `adblock`, `mediaType` (`screen`/`print`), `colorScheme` (`light`/`dark`/`no-preference`)
- `click`, `scroll`, `scripts`, `modules`, `styles`

### Caching

- `force`: bypass cache
- `retry`: exponential backoff retries (default `2`)
- `ttl`, `staleTtl`, `cacheKey`: Pro cache control

### Pro-only

`headers`, `proxy`, `filename`, `ttl`, `staleTtl`, `cacheKey`. Prefer `x-api-header-*` request headers over a `headers` query object for secrets. `proxy` is a URL, `proxy.url`, or `proxy.location` (country).

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "screenshot=true" \
  --data-urlencode "screenshot.fullPage=true" \
  --data-urlencode "screenshot.type=png" \
  --data-urlencode "meta=false"
```

The image URL is `data.screenshot.url`.

## data Rules

Each `data.<field>` key is a field on `data`. Rule properties:

| Property | Meaning |
| --- | --- |
| `selector` | `querySelector`. One selector, or several via `selector.0`, `selector.1` |
| `selectorAll` | `querySelectorAll` — result is an array. Same list form as `selector` |
| `attr` | HTML attribute, or `html`, `outerHTML`, `text`, `markdown`, `val`. A list reads several attributes. An object nests more rules. |
| `type` | `auto`, `string`, `number`, `boolean`, `date`, `url`, `image`, `audio`, `video`, `email`, `ip`, `lang`, `logo`, `object`, `regexp`, `author`, `description`, `publisher`, `title` |
| `evaluate` | JavaScript expression in the page |

`type=url` returns a URL string. `type=image`, `audio`, `video`, and `logo` return an asset.

### Single value

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.avatar.selector=#avatar" \
  --data-urlencode "data.avatar.attr=src" \
  --data-urlencode "data.avatar.type=image"
```

### Collection

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://news.ycombinator.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.stories.selectorAll=.titleline > a" \
  --data-urlencode "data.stories.attr=text"
```

Canonical collections. Override `selector` / `selectorAll` to scope them (`nav a`, `article img`).

| Field | Rule |
| --- | --- |
| `links` | `selectorAll=a`, `attr=href`, `type=url` |
| `images` | `selectorAll=img`, `attr=src`, `type=url` |
| `videos` | `selectorAll.0=video[src]`, `selectorAll.1=video source[src]`, `attr=src`, `type=url` |
| `audios` | `selectorAll.0=audio[src]`, `selectorAll.1=audio source[src]`, `attr=src`, `type=url` |
| `emails` | `selector=html`, `attr=html`, `type=email` |

### Whole page

Omit `selector`. `attr` is `markdown`, `html`, or `text`, and the field name matches it. The string is `data.markdown` (or `data.html`, `data.text`). Add `data.markdown.selector` to scope it.

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.markdown.attr=markdown"
```

### Fallback list

First truthy rule wins. Number the rules with dots (`0`, `1`, `2`):

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.title.0.selector=h1" \
  --data-urlencode "data.title.0.attr=text" \
  --data-urlencode "data.title.1.selector=title" \
  --data-urlencode "data.title.1.attr=text"
```

A JSON array on that one field is the same rule:

```bash
--data-urlencode 'data.title=[{"selector":"h1","attr":"text"},{"selector":"title","attr":"text"}]'
```

### Nested object

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.stats.selector=.profile" \
  --data-urlencode "data.stats.attr.followers.selector=.followers" \
  --data-urlencode "data.stats.attr.followers.type=number" \
  --data-urlencode "data.stats.attr.stars.selector=.stars" \
  --data-urlencode "data.stats.attr.stars.type=number"
```

### Evaluate

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.version.evaluate=window.next.version" \
  --data-urlencode "data.version.type=string"
```

## function

`function` is a JavaScript expression. The result is `data.function`: `isFulfilled`, `value`, `profiling`, `logging`. The function receives `page`, `response`, `headers`, and `url`, plus any extra query parameter. `page.metadata()` returns the metadata object. `page.extract(rules)` runs the same `data` rules inside the page. Code that never mentions `page` does not start a browser. `require()` loads an npm package (`require('cheerio@1.0.0')` pins it).

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode 'function=() => 40 + 2'
```

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode 'function=async ({ page }) => page.$eval("h1", el => el.textContent)'
```

Prefix the code with `lz#`, `gz#`, or `br#` when the source is compressed. Thrown code still returns JSON: `isFulfilled` is `false` and `value` is `{ name, message }`.

| | Free | Pro |
| --- | --- | --- |
| Timeout | 10s | up to 60s |
| Memory | 16 MB | 32 MB |
| Code size | 1024 bytes | unlimited |
| Concurrency | 1 per IP | unlimited |

Resource errors: `TimeoutError`, `CpuTimeError`, `MemoryError`, `CodeSizeError`, `ConcurrencyError`. Function errors: `EINVALFUNCTION` (syntax), `EINVALEVAL` (runtime).

## Embed URLs

`embed` returns one field as the body, with that asset's content type. The request URL is the asset. Use it in `<img>`, CSS, or Markdown.

```html
<img src="https://api.microlink.io/?url=https://example.com&screenshot=true&meta=false&embed=screenshot.url">
```

Paths: `screenshot.url`, `pdf.url`, `image.url`, `logo.url`, `video.url`.

## Errors

`fail` / `error` bodies include `code`, `message`, `more`, and `report`. Field details sit on `data`. The request id is the `x-request-id` response header.

```json
{
  "status": "fail",
  "code": "EINVALURL",
  "message": "The request has been not processed. See the errors above to know why.",
  "data": { "url": "The URL `not-a-url` is not valid. Ensure it has protocol, hostname and is reachable." },
  "more": "https://microlink.io/einvalurl"
}
```

Common codes: `EAUTH`, `ERATE`, `EINVALURL`, `EBRWSRTIMEOUT`, `EPRO`, `ETIMEOUT`.

## Rate Limit

Quota follows the endpoint ([rate limit](https://microlink.io/docs/api/basics/rate-limit)). Free is a soft limit of 25 requests. Pro starts at 14,000 on the API key's plan. HTTP 429 (`ERATE`) means the quota is spent — wait for reset, or upgrade. Parallel requests are allowed inside the quota.

Free responses include the current window:

| Header | Meaning |
| --- | --- |
| `x-rate-limit-limit` | Maximum requests permitted per minute |
| `x-rate-limit-remaining` | Requests left in the current window |
| `x-rate-limit-reset` | Window reset, UTC epoch seconds |

## Buy an API key

Start here when the free endpoint returns `ERATE` (HTTP 429), or when a call needs Pro (`EPRO`, `EHEADERS`, `EPROXY`, `ETTL`, `ESTTL`, `EFILENAME`). Checkout is `https://dashboard.microlink.io`. The secret is emailed. It is never in these responses. `keyId` is only a handle.

1. List plans. `limit` is the monthly request quota. `price` is minor units (`3900` + `eur` is €39.00).

```bash
curl "https://dashboard.microlink.io/api/v1/plans"
```

```json
{
  "plans": [
    { "id": "kz3osw", "limit": 45500, "price": 3900, "currency": "eur" }
  ]
}
```

2. Create a Checkout session with a plan `id`. `label` names the key (default `default`). Send a fresh `idempotency-key` (UUID, max 255 characters) and reuse that same header if this purchase is retried, so the 24-hour window does not open a second session.

```bash
curl -X POST "https://dashboard.microlink.io/api/v1/checkout/sessions" \
  -H "content-type: application/json" \
  -H "idempotency-key: $IDEMPOTENCY_KEY" \
  -d '{"email":"you@example.com","planId":"kz3osw","label":"default"}'
```

The JSON includes `checkoutUrl` and `sessionId`. An unknown `planId` is HTTP 400. An email that already has a subscription adds a key and can still return `checkoutUrl` when that extra key needs payment.

3. Give `checkoutUrl` to the human. They complete payment. Do not open the URL or pay on their behalf.

4. Poll the session until `state` is `ready`. Stop on `expired`. An unknown `sessionId` is HTTP 404.

```bash
curl "https://dashboard.microlink.io/api/v1/checkout/sessions/$SESSION_ID"
```

| `state` | Meaning |
| --- | --- |
| `open` | Waiting for payment |
| `paid` | Payment succeeded; the key is still being linked |
| `ready` | Provisioned. Includes `keyId` |
| `expired` | Session ended. Create a new one |

5. The human copies the secret from the welcome email or the dashboard and sends it as `x-api-key` to `https://pro.microlink.io`. `x-pricing-plan: pro` confirms it.

## Security

- Keep `x-api-key` on the server. A browser page that sends the key publishes it.
- For a website, proxy through `microlinkhq/proxy` or `microlinkhq/edge-proxy` and allow only trusted origins.
- Put target secrets in `x-api-header-*` request headers.

## Deep Reference

Parameter defaults, the full error matrix, and response headers: [api-reference.md](https://raw.githubusercontent.com/microlinkhq/skills/master/microlink-api/api-reference.md).
