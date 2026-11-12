---
name: seo-link-building
description: Improve a site's internal linking from Google Search Console data. Guards every internal link with a test (dead links, links to redirects, absolute self-links), finds striking-distance pages (positions 10.5 to 20.5) and low-CTR first-page pages, counts inbound links, and adds contextual links in existing sentences through exact-once scripted edits, shipped as reviewable PRs. Use when the user mentions internal linking, link building, internal link audit, orphan pages, striking distance, Search Console or GSC exports, pages stuck on page two, or wants to apply an "internal link maxxing" playbook to a repo.
---

# SEO Link Building

Internal links are the one ranking lever fully inside the repo. This skill turns a Search Console export into a short list of pages worth pushing, then adds links to them from pages that already have authority, using wording those pages already contain.

`<skill-dir>` below is the directory this `SKILL.md` was read from. Run every command from the target repo's root: the scripts resolve paths against the working directory. Each script prints usage when run without arguments, and needs only Node 20+.

## Rules that hold in every phase

- **Search Console data is private.** Extract the export into a scratch directory outside the repo. Never commit it, and never put impressions, clicks, CTR or positions in a commit message, PR body, issue or any outside service. Write "pages ranking on page two" instead of numbers. A pushed commit message stays reachable by SHA even after a force-push, so get this right before the first push.
- **Deterministic work goes through the scripts.** CSV filtering, inbound counts and text edits are scripts, not judgment. Judgment is for choosing the source sentence and the anchor.
- **Two PRs, in order.** First the guard test plus the fixes it forces (mechanical, easy to review). Then the new links, rebased on the merged first PR. One PR mixing both is hard to review and slow to merge.
- Follow the repo's own conventions over this file: its test runner, its link component (`<Link>` in MDX, `href` in JSX), its commit style, and its rules about em dashes, code spans in link text, and push permissions.

## Phase 1: Guard the links that exist

Before adding links, make broken ones impossible.

1. Copy `<skill-dir>/templates/internal-links.test.mjs` into the repo's test folder (match its layout, e.g. `test/integration/internal-links.mjs`). It uses `node:test`; for vitest or jest, replace the `node:test` and `node:assert` imports with `import { test, expect } from 'vitest'` and translate each assertion: `assert.deepEqual(a, b)` to `expect(a).toEqual(b)`, `assert.equal(a, b)` to `expect(a).toBe(b)`, `assert.ok(x)` to `expect(x).toBeTruthy()`, `assert.doesNotThrow(fn)` to `expect(fn).not.toThrow()`. Or keep `node:test` and add a `node --test` script.
2. Adapt the config block at the top, then delete the env fallbacks if the repo should not need them:
   - `SITE_HOST`: the production host, so absolute self-links are caught.
   - `ROUTE_SOURCES`: the directories whose files become routes (file-based routers map `index` to the folder).
   - `LINK_SOURCES`: where links are written (content, pages, components).
   - `EXTRA_ROUTES`: routes the build generates (from data files, packages, CMS). Import the same source the build uses instead of hardcoding a list, so the test does not drift.
   - `STATIC_DIRS` and the redirect readers (Vercel `vercel.json` and Netlify `_redirects` are built in; add Next.js `redirects()` or others the same way). Conditional redirects (Vercel `has`/`missing`, a Netlify `Key=value` token) and Netlify rewrites (status `200`, `404`) are not treated as redirects.
3. Run it. It fails on four things:
   - a link that resolves to no page, static file or redirect;
   - a link that points at a redirect source instead of its destination;
   - an absolute link to an own page (`https://example.com/x` in place of `/x`). Absolute links to static files pass: some link components route every relative path through the client router, so a raw `.json` or `.pdf` needs the absolute URL to load as a file. Check the repo's link component before making such a link relative;
   - any of the above hidden behind a linked image (`[![](/img.png)](/gone)`).
4. Fix every finding: repoint dead links to the closest live page, repoint redirected links to the final destination, make absolute links to own pages relative. Add a route to `EXTRA_ROUTES` only when it is a real generated route. Never loosen the test to pass.
5. Ship this as PR 1.

The template already handles the shapes that cause false results: link text over several lines, an image plus text inside a link, link titles (`[a](/x "Title")`), `[a](</x>)`, reference definitions (indented too), `href={'/x'}`, `<Link to="/x">`, `{ href: '/x' }` and `{ to: '/x' }`, relative links (resolved against the file's route; an index route is a directory; a relative `.md` or `.mdx` suffix and a trailing `index` are removed unless that path is a real static file), protocol-relative URLs (`//cdn...` is external, `//example.com/...` is an absolute self-link), `?query` and `#hash`, trailing slashes, percent-encoding, template literals (`${slug}` is skipped), links inside code fences and code spans in Markdown, Storybook and test files, and path traversal in static lookups. In MDX, a JSX template literal inside prose is read as a code span and skipped.

## Phase 2: Find the pages worth linking to

Ask the user for a Search Console export: Performance, Search results, last 3 months, Export, Download CSV. It is a zip of tables named in the account's UI language (`Pages.csv`/`Queries.csv`, `Páginas.csv`/`Consultas.csv`, ...). On macOS, `unzip` can fail on accented names; use `ditto -x -k export.zip <scratch>/gsc`.

```bash
node <skill-dir>/scripts/gsc.mjs striking <scratch>/gsc/Pages.csv --origin https://example.com
node <skill-dir>/scripts/gsc.mjs striking <scratch>/gsc/Queries.csv
node <skill-dir>/scripts/gsc.mjs ctr <scratch>/gsc/Pages.csv --origin https://example.com
```

- `striking` keeps rows at positions 10.5 to 20.5 with at least 500 impressions (`--min-impressions`), largest first. These are the link targets: page two is where a few more internal links move a page the most.
- On a queries export, the same filter lists queries that themselves sit on page two. Use one as anchor wording when it describes a target; the export is not a per-page query list.
- `ctr` keeps first-page rows with CTR at or under 3% (`--max-ctr`) and prints the clicks one CTR point would add. Those pages do not need links, they need better titles and meta descriptions. Report them as a separate follow-up, never fold them into the links PR. Note for the user that 2 to 4% CTR is normal around position 8, that Google rewrites snippets, and that AI Overviews lower CTR, so the gain is an estimate.

Pick 5 to 15 targets. Prefer pages that match what the business sells over pages that only attract traffic.

## Phase 3: Count inbound links

```bash
node <skill-dir>/scripts/inbound.mjs --origin https://example.com /target-a /target-b
```

It prints how many source files link to each route and lists the first few. Fenced and inline code in Markdown is ignored, and the scheme and host of an absolute link are matched case-insensitively. Without `--dir` it scans `src`, `content`, `app`, `pages` and `docs`. Low counts are the priority. A target that is only linked from the footer or nav has almost no contextual links, which is exactly what this skill adds.

## Phase 4: Choose sources and anchors

For each target, search the repo for sentences that already talk about its topic (`grep -rn "headless browser" src/content`). Good sources:

- pages that already rank or get traffic (the top of `Pages.csv`), docs guides, and blog posts on the same topic;
- product pages linking to the blog posts that explain them (FAQ answers are a natural spot), and blog posts linking back to the product page they describe. Bidirectional links between a product and its explainer are the highest-value pair.

Anchor rules:

- Link words already in the sentence. Only add a sentence when no existing one fits, and keep it to one plain line (a "See also" item, a closing pointer).
- The anchor names what the target is about, close to the query from Phase 2, phrased naturally. Vary it across sources; repeating one exact-match phrase everywhere looks manipulative.
- One new link per target per source, on the first relevant mention. Never in headings, code blocks, code spans, or alt text. Never link a page to itself.
- Do not stack links: at most one new link per paragraph, and skip paragraphs that already carry several.
- Keep the source's tone. If the sentence reads worse with the link, pick another sentence.

## Phase 5: Apply the edits

Write every edit to `<scratch>/edits.json` as `{ "file", "from", "to" }`, where `from` is a unique slice of the original sentence:

```json
[
  { "file": "src/content/docs/intro.md", "from": "runs in a headless browser (Chromium)", "to": "runs in a [headless browser](/blog/what-is-a-headless-browser) (Chromium)" }
]
```

```bash
node <skill-dir>/scripts/apply-edits.mjs <scratch>/edits.json --dry-run
node <skill-dir>/scripts/apply-edits.mjs <scratch>/edits.json
```

Every `from` must be non-empty, match exactly once in the original file and at the moment it is applied, and not fall inside text an earlier edit inserted. If any edit breaks a rule, the script reports each one and writes nothing; widen the `from` slice and rerun. Replacements are literal, so `$` in the text is safe.

Then verify:

1. Run the Phase 1 test: every new link resolves and none points at a redirect.
2. Compile what the edit could break: MDX files with JSX in them, and JS files where a link landed inside a string.
3. Re-run `inbound.mjs` on the targets: each count went up by the number of sources that did not link the target before (a file is counted once, however many links it has).
4. Read `git diff` once as a reader would: every sentence still reads naturally.

## Phase 6: Ship and measure

- PR 2 carries only the new links. Title and body describe what was linked and why ("pages ranking on page two get links from related docs and posts"), with no Search Console numbers.
- In the PR body, list each target with its new sources, so the reviewer can check anchors without reading the whole diff.
- Tell the user to re-export Search Console about 3 to 4 weeks after deploy and compare the average position of the linked targets against similar pages that got no links. Run `gsc.mjs striking` on both exports to see which targets left page two.
- Offer the `ctr` list from Phase 2 as its own titles-and-descriptions PR.

## Report

End with: the targets chosen (routes only), links added per target, the guard findings fixed in PR 1, tests run, PR URLs, the low-CTR follow-up list, and the date to re-measure.
