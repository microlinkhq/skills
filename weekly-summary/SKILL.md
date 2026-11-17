---
name: weekly-summary
description: Fill your section of the team's weekly meeting page in Notion with what you shipped since the last meeting, built from your git commits across every repo in a workspace folder. Groups work by repo, writes one outcome per bullet, links every public page, pull request and package, verifies each link answers 200, and adds screenshots of visual changes. Use when the user invokes /weekly-summary, asks to fill or write their weekly update, weekly meeting notes, "what I did this week" in Notion, or shares a Weekly Meeting page link.
---

# Weekly Summary

Writes your section of this week's Weekly Meeting page in Notion. Git says what changed, the forge says what landed, and the previous pages say how it should read.

`<skill-dir>` below is the directory this `SKILL.md` was read from. The scripts need Node 20+ and git 2.38+. `collect.mjs` asks `gh` (GitHub) and `glab` (GitLab) whether branches were merged when they are installed and signed in; without them, pass `--offline` and expect more work marked unmerged.

## Rules that hold in every step

- **Write only your own section.** The page holds one section per person. Never edit another person's lines, never use `replace_content` on the page, and never create, rename or re-date a row in the team database without the user saying yes.
- **Deterministic work goes through the scripts.** Listing commits, deciding what landed, checking links and uploading images are scripts. Judgment is for turning commits into outcomes and choosing what deserves a screenshot.
- **Keep what is already in your section.** Lines the user typed stay. If lines you wrote earlier disappear between two fetches, the user removed them: do not put them back, mention it once.
- **No emojis** in the section, including status marks like ✅.

## Step 1: Check the Notion connection

Call `notion-get-self`. The workspace it names must be the one holding the Weekly Meeting database. If fetching the page returns `object_not_found` (404), the link may be wrong or the page may not be shared with the connection: ask the user to check both before reauthenticating. If searching "Weekly Meeting" returns nothing and the connection's workspace is not the team's, tell the user to run `/mcp`, pick `notion`, clear authentication, authenticate again, and choose the right workspace in the picker on Notion's consent screen. Stop until they say it is done.

## Step 2: Find this week's page

1. Get the rows. If the user shared a link, fetch the ID in its `p=` query parameter (or the path ID when there is no `p=`). If that is a database, or there was no link, find the database (search "Weekly Meeting"), fetch it for its `collection://` URL, then:

   ```sql
   SELECT url, "Name", "date:date:start" FROM "collection://..." ORDER BY "date:date:start" DESC LIMIT 8
   ```

2. Pick the meeting. Rows are named `W<n>-<yy>` (e.g. `W40-26`); `<n>` counts meetings, it is not the ISO week. The target is the row the user linked, else the soonest row whose date is today or later. A later row that is further in the future is not this week's meeting. The query is newest first. If the earliest row on the page is still after today and the page came back full, raise the limit and query again: this week is not on the page. If that page is shorter than the limit, stop: it is the whole database, and the soonest row on it is the next meeting.
3. If every row is in the past, do not guess. Ask the user: fill the newest of those, or create the next one (`W<n + 1>-<yy>` dated the meeting day they name)? Whoever runs the meeting usually creates it, so a missing row often means "not meeting day yet".

## Step 3: Learn the format from the previous pages

Fetch the three rows before the target and read your own section in each. The current convention:

```markdown
### Kiko

- microlink/api
  - Kubernetes image pull 111s → 25s: base image from plain Ubuntu, one Dockerfile, zstd-compressed push
  - Microlink Functions: free plan code size limit raised to 5120 bytes
- microlink/www
  - blog: [How we cut our Kubernetes image pull from 111s to 25s](https://microlink.io/blog/...)
    <image source="file-upload://..." />
  - in progress: dashboard-style inputs across the site
- splashy
  - returns a palette for all-white and transparent images ([#157](https://github.com/microlinkhq/splashy/pull/157))
```

If the older pages disagree with this, follow the pages. Your heading is the one you used before (`### Kiko`, or a bold line in older pages). On a first run, use your first name from `notion-get-self` and the heading style the other sections use.

## Step 4: Pick the range and collect

- `--until` is the meeting date (exclusive: commits made on meeting day wait for next week).
- `--since` is the later of: the meeting date minus 7 days, or the previous row's date. Meetings closer than a week apart never report the same work twice.
- If the previous row is more than 7 days before the meeting, say so and offer to widen `--since` to it. Do not widen it without asking.

Run it on the folder that holds the repos (each repo a direct child):

```bash
node <skill-dir>/scripts/collect.mjs --root ~/Projects/<org> --since 2026-11-10 --until 2026-11-17
```

It prints one section per repo, every commit marked:

| Mark | Meaning | How to write it |
| --- | --- | --- |
| `[merged]` | On the default branch, or its pull or merge request was merged after it was made | Plain bullet |
| `[open: branch]` | Its pull or merge request is open | `in review:` prefix, link the request |
| `[unmerged: branch]` | Pushed, no open or merged request | `in progress:` prefix, or leave out if abandoned |
| `[unpushed: branch]` | Only on your machine | Leave out unless the user wants it |
| `lookup failed` | `gh`/`glab` could not answer (signed out, rate limited) | Fix the CLI and rerun before writing |

Release bumps, dependency bumps, generated data updates and merge commits are already dropped; a branch commit and its squash `(#N)` show once; clones of the same remote are merged. `--author` defaults to your global git `user.name` and `user.email` and matches literally; add `--author` flags for other identities.

## Step 5: Turn commits into outcomes

- **One bullet per outcome, not per commit.** Ten docker commits that cut image pull time are one bullet. Lead with what a user or the team can see, and keep the numbers the commits state (111s → 25s, 5120 bytes, 120 pods).
- **Group by repo**, labelled as in previous pages (`microlink/api` for org repos, the bare name for personal open source). Order repos by how much shipped.
- **Leave out** CI plumbing, internal triage chores, test-only commits and refactors unless they are the point of the week.
- **Link everything public:** product and landing pages, blog posts, docs, the request (`([#21](...))`), a skill's folder, an open source repo, an npm package. Link the name inside the sentence (`[Puppeteer](https://microlink.io/alternative/puppeteer)`), not a bare URL. Page URLs come from the repo's route files (e.g. `src/pages/alternative/*.js` serves `/alternative/*`).
- **Check every link before writing it:**

  ```bash
  node <skill-dir>/scripts/check-links.mjs https://microlink.io/alternative https://github.com/org/repo/pull/21
  ```

  A `FAIL` stays unlinked. A private repository answers 404: write "(repo still private)" and link its public site if it has one. A page that redirects to sign-in (a dashboard) fails too and is never linked.

## Step 6: Screenshot visual changes

Add a screenshot under each bullet whose change can be seen on a public page: a new page, a landing hero, a menu, a blog post's header. Skip what needs a login, what is not deployed yet, and text-only changes.

1. Capture with agent-browser in a named session (run `agent-browser skills get core` first if you have not used it this session). `SHOTS` is a folder in your scratchpad, never the repo:

   ```bash
   SHOTS=<scratchpad>/weekly-shots && mkdir -p "$SHOTS"
   export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix weekly)"
   agent-browser set viewport 1440 900
   agent-browser open https://microlink.io/alternative
   agent-browser wait 2500
   agent-browser screenshot "$SHOTS/alternative.png"
   ```

   For a menu, `snapshot -i` to find its trigger, `hover @eN`, `wait 800`, then screenshot. Crop to what matters (`sips -c <height> <width> --cropOffset 0 0 file.png` on macOS). Read every image before uploading: a blank hero or a login wall means retake it. `agent-browser close` when done.

2. Upload each file: call `notion-create-file-upload` with the filename (all files in one parallel batch), then send each one with the `upload_url` and the whole `upload_headers` object as JSON:

   ```bash
   node <skill-dir>/scripts/upload.mjs "$UPLOAD_URL" '{"authorization":"Bearer ..."}' "$SHOTS/alternative.png"
   ```

   It prints the `<image source="file-upload://..." />` tag. Place it within the hour, before the upload expires.

3. Nest the image under its bullet, two spaces deeper than that bullet's dash (four spaces under a sub-bullet).

## Step 7: Write your section

Fetch the target page and find your section: from your heading line up to the next person's heading (or the end of the page).

- **Empty template** (your heading followed by one empty bullet): call `update_content` with `old_str` set to your heading line plus that empty bullet, exactly as fetched, and `new_str` set to your heading plus the new bullets. The heading makes the match unique; an `old_str` of only the empty bullet would match every unfilled section.
- **Section already has content:** merge. Keep every existing line, add your new bullets under the right repo (adding a repo group when it is new), and skip outcomes already there. Apply it with `update_content`, `old_str` = your whole section as fetched, heading included.
- **No section yet:** add one with `update_content`, appending it after the last section (`old_str` = that section's last lines, `new_str` = those lines plus yours). Use `insert_content` at the end only when the page has no sections.
- **Your heading appears twice** (two people with one first name): stop and ask which is yours.

## Step 8: Verify and report

1. Fetch the page again and confirm: your section reads as written, each `file-upload://` became a `notion-file-block://` image, links survived, no emojis, and every other section matches the fetch before your edit.
2. Report to the user: the page link, the range covered, what was marked in review or in progress, and what was left out and why (unpushed, no public URL, private repo, behind a login, a gap before the range).

## Scripts

| Script | Does |
| --- | --- |
| `scripts/collect.mjs` | Your commits per repo in a date range, noise dropped, copies and clones merged, each marked merged, open, unmerged or unpushed (git first, then `gh`/`glab` per branch) |
| `scripts/check-links.mjs` | Anonymous fetch of each URL following redirects; fails on non-2xx and on sign-in redirects; npm pages are checked through the registry |
| `scripts/upload.mjs` | Sends a file to a Notion upload URL with every returned header and prints the image tag |

Tests: `node --test <skill-dir>/scripts/`.
