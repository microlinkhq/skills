---
name: microlink-mcp
description: Companion of the microlink skill — @microlink/mcp tool list, client config, checkout onboarding, and error envelope. Not an entry point. The microlink skill opens this when installing or debugging the MCP runtime.
---

# @microlink/mcp

Runtime opened from the [microlink](https://raw.githubusercontent.com/microlinkhq/skills/master/microlink/SKILL.md) skill. Not a separate product or install. The microlink skill installs this server when the assistant must execute a call. Product tools wrap `microlink.io` methods (same inputs, same direct result). `microlink_docs` loads canonical product markdown. Checkout tools buy a key without returning the secret.

Requires Node.js 24+.

## Install

```bash
npx -y @microlink/mcp
```

Optional global: `npm install -g @microlink/mcp` then `microlink-mcp`.

Free plan is 50 requests/day. Set `MICROLINK_API_KEY` for Pro: [microlink.io/#pricing](https://microlink.io/#pricing).

## Client Config

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "microlink": {
      "command": "npx",
      "args": ["-y", "@microlink/mcp"],
      "env": {
        "MICROLINK_API_KEY": "YOUR_MICROLINK_API_KEY"
      }
    }
  }
}
```

VS Code (`.vscode/mcp.json`) uses top-level `servers` and `"type": "stdio"`:

```json
{
  "servers": {
    "microlink": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@microlink/mcp"],
      "env": {
        "MICROLINK_API_KEY": "YOUR_MICROLINK_API_KEY"
      }
    }
  }
}
```

Local checkout:

```json
{
  "mcpServers": {
    "microlink": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/src/index.js"],
      "env": { "MICROLINK_API_KEY": "YOUR_MICROLINK_API_KEY" }
    }
  }
}
```

## Tools

| Tool | Source | Returns |
| --- | --- | --- |
| `microlink_docs` | `microlink <product> docs` | canonical product markdown |
| `microlink_list_plans` | dashboard Checkout API | plans a new customer can buy |
| `microlink_create_checkout_session` | dashboard Checkout API | `{ checkoutUrl, sessionId, … }` |
| `microlink_get_checkout_session` | dashboard Checkout API | `open` / `paid` / `ready` / `expired` |
| `microlink_metadata` | `metadata(url)` | title, description, image, logo, … |
| `microlink_logo` | `logo(url)` | logo asset or `null`; `square` prefers icon variant |
| `microlink_markdown` / `_html` / `_text` | `markdown` / `html` / `text` | page content string or `null` |
| `microlink_screenshot` | `screenshot(url)` | asset (`url`, `type`, `width`, `height`, `size`) |
| `microlink_pdf` | `pdf(url)` | PDF asset |
| `microlink_embed` | `embed(url)` | `{ html, scripts }` |
| `microlink_video` / `_audio` | `video` / `audio` | primary playable asset or `null` |
| `microlink_links` / `_images` / `_videos` / `_audios` / `_emails` | matching collections | `string[]` |
| `microlink_technologies` | `technologies(url)` | Wappalyzer array |
| `microlink_lighthouse` | `lighthouse(url)` | Lighthouse report |
| `microlink_search` | `search(query)` | structured Google; **requires API key** |
| `microlink_function` | `function(url, code)` | `{ value, isFulfilled, profiling, logging }` |
| `microlink_extract` | `extract(url, rules)` | custom CSS rules; can compose screenshot/pdf/insights |

Call `microlink_docs({ product })` before guessing nested options.

Shared request knobs (most URL tools): `device`, `viewport`, `colorScheme`, `click`, `scroll`, `scripts`, `modules`, `styles`, `waitUntil`, `waitForSelector`, `waitForTimeout`, `prerender`, `adblock`, `animations`, `javascript`, `mediaType`, `ttl`, `staleTtl` (PRO), `cacheKey` (PRO), `force`, `retry`, `timeout`, `headers` (PRO), `proxy` (PRO), `filename` (PRO), `filter`.

`screenshot` / `pdf` / `insights` accept `true` for defaults or an object; `{}` is treated as `true`.

Booleans also accept `"true"` / `"false"`. Object params also accept JSON strings (MCP client compatibility).

Product tools are `readOnlyHint: true` except `microlink_function` (runs caller code) and `microlink_create_checkout_session` (creates remote Checkout state).

### Example

```json
{
  "name": "microlink_screenshot",
  "arguments": {
    "url": "https://example.com",
    "screenshot": { "fullPage": true, "type": "png" },
    "colorScheme": "dark"
  }
}
```

`microlink_docs` extras: `product` (required) — `metadata`, `logo`, `markdown`, `html`, `text`, `video`, `audio`, `emails`, `links`, `images`, `videos`, `audios`, `extract`, `screenshot`, `pdf`, `embed`, `technologies`, `lighthouse`, `search`, `function`.

`microlink_search` extras: `query` (required), `type` (`search`/`news`/`images`/`videos`/`places`/`maps`/`shopping`/`scholar`/`patents`/`autocomplete`), `limit`, `page`, `location`, `period`. Missing key → use checkout tools so the human can buy one.

`microlink_function` extras: `code` (function source string, e.g. `"async ({ page }) => page.title()"`).

### Onboarding (no API key)

1. `microlink_list_plans` — pick a `planId`
2. `microlink_create_checkout_session` — `email`, `planId`; optional `label`, `idempotencyKey`
3. Give `checkoutUrl` to the human. Never open or complete it.
4. Poll `microlink_get_checkout_session` with `sessionId` until `ready` or `expired`

`ready` includes `keyId` (non-secret handle). The API key secret is never returned here (welcome email / dashboard).

## Response Shape

Success: library result under `structuredContent.data` (and pretty-printed JSON text).

- `microlink_markdown` → `{ data: "# Title\n..." }`
- `microlink_screenshot` → `{ data: { url, type, width, height, size } }`
- `microlink_links` → `{ data: ["https://...", ...] }`
- `microlink_docs` → `{ data: "# markdown…" }`
- Onboarding tools → dashboard Checkout payload under the same envelope

Nullable fields can legitimately be absent (`logo`, `markdown` when the selector matches nothing).

Failure: MCP `isError` plus `{ error: { message, code?, status?, statusCode?, url?, more?, details? } }`. Capability errors (`EPROXYNEEDED`, `EINTEGRATION`) also include `reason: "upgrade_required"`, `capability`, `upgrade`, and `hint`. A `429` includes `reason: "quota_exceeded"` and a free-quota hint (50/day). Read `hint`/`reason` instead of retrying blindly.

Parameters labeled PRO in Microlink docs need a paid plan.

## Authentication

Key resolution order:

1. `apiKey` tool argument
2. `Authorization: Bearer <key>` request header
3. `x-api-key` request header
4. `MICROLINK_API_KEY` env (recommended)

With a key → `https://pro.microlink.io`. Without → `https://api.microlink.io`.
