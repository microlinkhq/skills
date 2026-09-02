# skills


### use-pnpm

> `npx -y skills add microlinkhq/skills/use-pnpm`

Always use `pnpm` as the package manager. Use when installing, adding, or removing dependencies, running scripts, or any npm/yarn/pnpm command. Replaces npm and yarn with pnpm equivalents.

### microlink

> `npx -y skills add microlinkhq/skills/microlink`

Turn URLs into product results with `microlink.io` — metadata, markdown/html/text, screenshots, PDFs, logos, embeds, video/audio, page collections, Google search, remote JS functions, and the Microlink CLI. Use when the user mentions Microlink, microlink.io, taking screenshots, generating PDFs, extracting page content, or scraping without browser infrastructure.

### microlink-mcp

> `npx -y skills add microlinkhq/skills/microlink-mcp`

Expose Microlink products to AI assistants via the `@microlink/mcp` stdio server. Use when the user mentions Microlink MCP, Claude Desktop/Cursor/VS Code MCP config, or wiring Microlink tools into an assistant.

### microlink-api

> `npx -y skills add microlinkhq/skills/microlink-api`

Call Microlink via raw MQL/HTTP for JSend envelopes, embed URLs, filter, stream/buffer, and custom query composition. Use when the user mentions `@microlink/mql`, MQL, or `api.microlink.io` query parameters. Prefer the `microlink` skill for product methods.

### unavatar-api

> `npx -y skills add microlinkhq/skills/unavatar-api`

Retrieve user avatars from 20+ platforms (GitHub, X/Twitter, Instagram, Gravatar, etc.) via unavatar.io. Use when the user mentions unavatar, avatar retrieval, profile pictures, user avatars, or needs to resolve avatars by email, username, domain, or phone number.

### k8s-hpa-cost-tuning

> `npx -y skills add microlinkhq/skills/k8s-hpa-cost-tuning`

Tune Kubernetes HPA scale-up/down behavior, topology spread, and resource requests to reduce idle cluster capacity and ensure nodes can drain. This skill should be used when auditing cluster costs on a schedule, analyzing post-incident scaling behavior, or investigating why replicas or nodes do not scale down.

### optimo

> `npx -y skills add microlinkhq/skills/optimo`

Optimize and convert images and videos using `optimo` on top of ImageMagick & FFmpeg. Use when the user mentions reducing image/video file size, media compression, batch optimization, converting media formats, or running `optimo` from scripts.

### browserless

> `npx -y skills add microlinkhq/skills/browserless`

Automate websites with `browserless` and Puppeteer for screenshots, PDFs, HTML/text extraction, URL status checks, and Lighthouse audits. Use when the user mentions browserless, `@browserless/cli`, headless Chrome automation, Puppeteer wrappers, website screenshots, PDF generation from URLs, or extracting rendered page content.

### nodejs-performance

> `npx -y skills add microlinkhq/skills/nodejs-performance`

Identify and ship production-safe performance and resource-usage fixes in Node.js codebases. Use when users ask to reduce CPU, memory, event-loop lag, I/O pressure, retry amplification, or to run one-PR-per-improvement optimization workflows with measurable benchmarks.

### metascraper

> `npx -y skills add microlinkhq/skills/metascraper`

Extract unified metadata from website HTML using `metascraper` rule bundles and fallbacks. Use when the user mentions metascraper, metadata extraction from URLs, Open Graph/Twitter Cards/JSON-LD parsing, custom metadata rules, or building link preview pipelines.

### html-get

> `npx -y skills add microlinkhq/skills/html-get`

Retrieve normalized HTML from URLs using fetch or prerender with browserless fallbacks. Use when the user mentions `html-get`, rendered HTML extraction, JS-heavy pages, rewriting relative URLs, or preparing HTML for metascraper and scraping pipelines.

### keyvhq

> `npx -y skills add microlinkhq/skills/keyvhq`

Build and operate Keyv-based caching and key-value storage using `@keyvhq/core` and official adapters. Use when the user mentions Keyv, keyvhq, TTL cache, namespaces, storage adapters (Redis, Mongo, MySQL, PostgreSQL, SQLite, file), or adding cache support to a Node.js module.

### run-skill

> `npx -y skills add microlinkhq/skills/run-skill`

Execute a remote agent skill from a skills.sh or GitHub URL without installing it on the system. Use when the user invokes `/run-skill <url>`, shares a skills.sh link, points to a SKILL.md on GitHub, or asks to run a skill one-off without adding it to their machine.

### youtube-dl-exec

> `npx -y skills add microlinkhq/skills/youtube-dl-exec`

Run `yt-dlp` from Node.js using `youtube-dl-exec` for metadata extraction, media downloads, subtitle workflows, and subprocess control. Use when the user mentions `youtube-dl-exec`, `yt-dlp` automation, downloading media, or extracting structured video information.
