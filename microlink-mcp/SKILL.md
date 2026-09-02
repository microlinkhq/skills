---
name: microlink-mcp
description: Expose Microlink products to AI assistants via the @microlink/mcp stdio server — screenshots, PDFs, metadata, markdown, search, extract, and remote functions. Use when the user mentions Microlink MCP, Claude Desktop/Cursor/VS Code MCP config, or wiring Microlink tools into an assistant.
---

# @microlink/mcp

Stdio MCP server. Each tool is a thin wrapper over a `microlink.io` product method — same inputs, same direct result.

For the Node/CLI product client, see [microlink](../microlink/SKILL.md).

## Install

```bash
npx -y @microlink/mcp
```

Optional global: `npm install -g @microlink/mcp` then `microlink-mcp`.

Free plan is 50 requests/day. Set `MICROLINK_API_KEY` for Pro: [microlink.io/#pricing](https://microlink.io/#pricing).

## Client Config

Same shape for Claude Desktop, Cursor (`.cursor/mcp.json`), VS Code, and Codex:

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

Claude Desktop path: `~/Library/Application Support/Claude/claude_desktop_config.json`.

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

| Tool | Library method | Returns |
| --- | --- | --- |
| `microlink_metadata` | `metadata(url)` | title, description, image, logo, … |
| `microlink_logo` | `logo(url)` | logo asset; `square` prefers icon variant |
| `microlink_markdown` / `_html` / `_text` | `markdown` / `html` / `text` | page content string |
| `microlink_screenshot` | `screenshot(url)` | asset (`url`, `type`, `width`, `height`, `size`) |
| `microlink_pdf` | `pdf(url)` | PDF asset |
| `microlink_embed` | `embed(url)` | `{ html, scripts }` |
| `microlink_video` / `_audio` | `video` / `audio` | primary playable asset |
| `microlink_links` / `_images` / `_videos` / `_audios` / `_emails` | matching collections | `string[]` |
| `microlink_technologies` | `technologies(url)` | Wappalyzer array |
| `microlink_lighthouse` | `lighthouse(url)` | Lighthouse report |
| `microlink_search` | `search(query)` | structured Google; **requires API key** |
| `microlink_function` | `function(url, code)` | `{ value, isFulfilled, profiling, logging }` |
| `microlink_extract` | `extract(url, rules)` | custom MQL `data` rules; can compose screenshot/pdf/insights |

Shared request knobs (most tools): `device`, `viewport`, `colorScheme`, `click`, `scroll`, `scripts`, `modules`, `styles`, `waitUntil`, `waitForSelector`, `waitForTimeout`, `prerender`, `adblock`, `animations`, `javascript`, `mediaType`, `ttl`, `staleTtl`, `force`, `retry`, `timeout`, `headers`, `proxy`, `filename`, `filter`.

`screenshot` / `pdf` / `insights` accept `true` for defaults or an object; `{}` is treated as `true`.

Booleans also accept `"true"` / `"false"`. Object params also accept JSON strings (MCP client compatibility).

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

`microlink_search` extras: `query` (required), `type` (`search`/`news`/`images`/`videos`/`places`/`maps`/`shopping`/`scholar`/`patents`/`autocomplete`), `limit`, `page`, `location`, `period`.

`microlink_function` extras: `code` (function source string, e.g. `"async ({ page }) => page.title()"`).

## Response Shape

Success: library result under `structuredContent.data` (and pretty-printed JSON text).

- `microlink_markdown` → `{ data: "# Title\n..." }`
- `microlink_screenshot` → `{ data: { url, type, width, height, size } }`
- `microlink_links` → `{ data: ["https://...", ...] }`

Failure: MCP `isError` plus `{ error: { message, code?, status?, statusCode?, url?, more? } }`. A `429` includes a free-quota hint (50/day).

Parameters labeled PRO in Microlink docs need a paid plan.

## Authentication

Key resolution order:

1. `apiKey` tool argument
2. `Authorization: Bearer <key>` request header
3. `x-api-key` request header
4. `MICROLINK_API_KEY` env (recommended)

With a key → `https://pro.microlink.io`. Without → `https://api.microlink.io`.
