---
name: difftool
description: Visual regression diffs between two URLs or two images with microlink difftool, via its CLI, its GitHub Action (sticky PR comment with screenshots), or the web app at difftool.microlink.io. Use when the user mentions difftool, visual diff, visual regression, comparing a preview deploy against production, screenshot diffs on pull requests, or comparing two images side by side, including private local images.
---

# difftool

`difftool` answers one question: **did this change visually break the page?** It takes full-page screenshots of a base URL and a head URL through the Microlink API, diffs them pixel by pixel, and returns a verdict per route.

Pick the surface by the job:

| Job | Surface |
| --- | --- |
| Check a preview URL against production once, locally or in a script | [CLI](#cli) |
| Comment a visual diff on every pull request | [GitHub Action](#github-action) |
| Look at two images (screenshots, local files) side by side | [Web app](#web-app) |

## CLI

The CLI is not published to npm. Run it from a clone (Node 24+):

```bash
git clone https://github.com/microlinkhq/difftool && cd difftool
pnpm install
node packages/cli/bin/cli.js --base https://example.com --head https://preview.example.com
```

`pnpm install` may print `sharp install: Failed`; the CLI does not need it, ignore it.

Set `MICROLINK_API_KEY` for a paid plan. Without it the Microlink free tier applies, which has a small daily request budget. Every route costs two screenshots, and up to six when the base and head pages have different heights (the CLI retries the pair up to three times before diffing with padding).

### Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--base <url>` | required | Production / baseline origin |
| `--head <url>` | required | Preview origin to compare against base |
| `--routes <path>` | `/` | Paths to diff. Repeat the flag (`--routes / --routes /pricing`) or pass a JSON array (`'["/","/pricing"]'`) |
| `--out <dir>` | `./diff-output` | Output directory |
| `--threshold <ratio>` | `0.001` | Diff ratio (0..1) at or below which a route passes |
| `--warning-threshold <ratio>` | `0.02` | Diff ratio at or below which a route is a warning; above it, the route fails |
| `--pixel-threshold <ratio>` | `0.1` | Per-pixel color sensitivity (0..1); raise it to ignore anti-aliasing noise |
| `--mql <json>` | `{}` | Extra Microlink API options, e.g. `'{"viewport":{"width":1440,"height":900}}'` or `'{"styles":["#cookie-banner{display:none}"]}'` |

Routes are appended to both origins: `--base https://example.com --routes /pricing` screenshots `https://example.com/pricing`.

`--threshold` and `--warning-threshold` fall back to the env vars `MICROLINK_DIFF_THRESHOLD` / `MICROLINK_DIFF_WARNING_THRESHOLD`, then to `microlink-difftool.json` in the working directory (`{ "threshold": 0.002, "warningThreshold": 0.03 }`), then to the defaults.

### Verdicts and exit codes

Each route gets a verdict from its diff ratio (changed pixels / total pixels):

- `pass`: ratio ≤ `threshold`
- `warning`: ratio ≤ `warning-threshold`
- `fail`: ratio > `warning-threshold`

Exit code `0` when no route fails (warnings still exit `0`), `1` when any route fails, `2` on a usage or runtime error.

### Outputs

With one route, files go straight into `--out`. With several, each route gets a subdirectory named after its path (`/` → `root`, `/help/faq` → `help-faq`):

```
diff-output/
├── summary.json          # overall verdict + one entry per route
├── root/
│   ├── review.png        # labeled base | head | diff composite: show this to humans
│   ├── base.png
│   ├── head.png
│   └── diff.png          # changed pixels highlighted
└── pricing/…
```

Read `summary.json` to act on results; do not parse stdout. Each `routes[]` entry has `route`, `diffRatio`, `verdict` and `outDir` (relative to `--out`, `.` for a single route):

```bash
jq -r '.routes[] | "\(.verdict)\t\(.diffRatio)\t\(.route)\t\(.outDir)/review.png"' diff-output/summary.json
```

### Known limits

- Pages of different heights are padded, so every pixel past the shorter page counts as changed. A head page that grew by a long section can fail on height alone; check `review.png` before calling it a regression.
- The `review` path printed on failure is wrong when `--out` points outside the working directory; take paths from `summary.json`.
- Very tall pages (tens of thousands of pixels) can exceed the image size limit when building `review.png`, and the run exits `2` with `invalid value (typically too big) for the size of the input`. Diff shorter routes instead.
- Dynamic content (dates, ads, carousels, randomized content) shows up as change. Hide it with `--mql '{"styles":["…{visibility:hidden}"]}'` rather than raising the threshold.

## GitHub Action

Posts a sticky comment on the pull request with a per-route table (diff %, links to base/head/diff screenshots, a **compare** link to the web app, verdict) and edits it in place on every push. When the PR closes, it deletes that PR's screenshots from the bucket.

```yaml
# .github/workflows/visual-diff.yml
name: Visual diff
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  pull-requests: write # post / update the sticky comment
  deployments: read # needed for head: vercel

jobs:
  visual-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: microlinkhq/difftool@master
        with:
          base: https://example.com
          head: vercel
          routes: |
            - '/'
            - '/pricing'
          microlink-api-key: ${{ secrets.MICROLINK_API_KEY }}
          s3-config: ${{ secrets.S3_CONFIG }}
```

Keep `closed` in the trigger types: that run only deletes the PR's screenshots, it takes no new ones and does not wait for a deployment.

`pull_request` runs from forks get no secrets, so `s3-config` and `microlink-api-key` are empty there and the run fails. Run the workflow only for same-repo branches, or skip forks with `if: github.event.pull_request.head.repo.full_name == github.repository`.

`head: vercel` waits for the Vercel deployment of the PR's head commit and uses its preview URL (`provider-timeout`, default `600` s; `provider-interval`, default `10` s). For any other host, pass the preview URL explicitly.

### Storage

Screenshots are uploaded to an S3-compatible bucket the user owns (Cloudflare R2, AWS S3, Backblaze B2, MinIO…) and linked with pre-signed URLs, so the bucket stays private. Store the config as a repository secret, e.g. `S3_CONFIG`:

```json
{
  "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
  "region": "auto",
  "accessKeyId": "…",
  "secretAccessKey": "…",
  "bucket": "difftool-assets",
  "forcePathStyle": true
}
```

`accessKeyId`, `secretAccessKey` and `bucket` are required; omit `endpoint` and `forcePathStyle` for AWS S3. The token needs PutObject, GetObject, DeleteObject and ListBucket on that bucket only.

The comment's **compare** links open the screenshots in the web app, which fetches them from the browser. That only works if the bucket has a CORS policy allowing it; the "open" links work either way. Add this policy to the bucket (R2: bucket settings → CORS policy; S3: Permissions → CORS):

```json
[
  {
    "AllowedOrigins": ["https://difftool.microlink.io"],
    "AllowedMethods": ["GET"]
  }
]
```

Links expire after `presigned-ttl-seconds` (default `86400`). Each new run on the PR posts fresh ones, but on a PR with no new pushes they stop working once that time passes; raise the TTL for long reviews.

### Inputs and outputs

| Input | Default | Meaning |
| --- | --- | --- |
| `base` | required | Production / baseline URL |
| `head` | required | Preview URL, or `vercel` |
| `s3-config` | required | Bucket config JSON (pass a secret) |
| `routes` | `["/"]` | JSON array string or YAML list string |
| `threshold` | `0.001` | Pass threshold |
| `warning-threshold` | `0.05` | Warning threshold. The CLI default is `0.02`, so set it explicitly to get the same verdicts in both |
| `pixel-threshold` | `0.1` | Per-pixel sensitivity |
| `mql` | | Microlink API options JSON |
| `microlink-api-key` | | Recommended for CI |
| `presigned-ttl-seconds` | `86400` | Screenshot link lifetime |
| `pr-number`, `sha` | from the event | Set when not running on `pull_request` |
| `comment-marker` | `<!-- microlink-difftool -->` | Change to run several diffs on one PR, each with its own comment |

Outputs: `verdict` (`pass` / `warning` / `fail`), `passed` (`"true"` unless a route failed) and `summary-json` (path on the runner).

When any route fails, the step fails the job after posting the comment; warnings keep it green. To report without blocking, let the step continue and decide yourself:

```yaml
      - uses: microlinkhq/difftool@master
        id: diff
        continue-on-error: true
        with: { … }
      - if: steps.diff.outputs.verdict == 'warning'
        run: echo "::warning::visual changes detected, see the PR comment"
```

## Web app

[difftool.microlink.io](https://difftool.microlink.io) compares two images in five modes: `split`, `fade`, `slider`, `highlight` (changed pixels in magenta over the base, the default) and `subtract`. Images of different sizes are aligned top-left, as in the CLI.

Link straight to a comparison with query parameters:

```
https://difftool.microlink.io/?base=<image-url>&head=<image-url>&mode=slider
```

- URL-encode both image URLs.
- The browser fetches the images, so the host must send CORS headers (`Access-Control-Allow-Origin`). Public CDNs usually do; S3/R2 buckets only do with a CORS policy (see [Storage](#storage)). If a link shows "Could not load … as an image", missing CORS is the usual cause.
- Small `data:` URIs work in `base`/`head`, but the whole URL must stay under about 24 KB or the server rejects it (`414`). For real screenshots, use hosted URLs or local files.

### Private local images

To compare images from the user's machine without uploading them anywhere, open difftool.microlink.io and drop (or pick) one file on each side. The files are read and diffed entirely in the browser: no network request carries them, and nothing is added to the URL. The trade-off is that there is no shareable link and a reload clears them.

To avoid loading the page from the internet at all, run the web app locally from the clone:

```bash
pnpm install
pnpm dev # http://localhost:3000
```

## Recommended workflow

1. Diff one route first, open its `review.png`, and confirm the screenshots show the intended pages (not a login wall, cookie banner or error page).
2. Add routes, and hide dynamic regions with `--mql` styles before tuning thresholds.
3. Tune `--threshold` / `--warning-threshold` from observed `diffRatio` values of known-good runs, not by guessing.
4. Move the same routes, `mql` and both thresholds into the GitHub Action, setting `warning-threshold` explicitly since its default differs from the CLI's.
5. Hand reviewers the **compare** link (web app, `slider` or `highlight` mode) for anything that warns or fails.
