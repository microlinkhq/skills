---
name: check-local-changes
description: Validate uncommitted changes in this skills repo before committing. Use when the user invokes /check-local-changes, asks to check, review, or validate local/uncommitted/pending changes, or before committing a new or modified skill.
---

# Check Local Changes

Validate the working tree of this skills repo: every touched skill must have a well-formed `SKILL.md` and a matching `README.md` entry, and no junk files may land in the commit.

## Workflow

### Step 1: Run the deterministic checks

```bash
node .agents/skills/check-local-changes/scripts/check.js
```

The script inspects `git status --porcelain` and reports:

**Failures** (exit 1, scoped to changed files):

- Touched skill directory without `SKILL.md`
- `SKILL.md` missing frontmatter, `name`, or `description`
- Frontmatter `name` not matching the directory name or not kebab-case
- `description` over 1024 characters
- Touched skill missing its `### <name>` README section or install command (`npx -y skills add microlinkhq/skills/<name>`)
- README section added in this diff pointing to a non-existent directory
- `.DS_Store` or `node_modules` about to be committed

**Warnings** (informational, pre-existing drift):

- Skill directories missing from README
- Pre-existing README sections without a directory

### Step 2: Review the diff in latent space

The script cannot judge quality. Read `git diff` plus new files and check:

- The description states what the skill does AND when to use it, with concrete trigger phrases (compare against neighbors in `README.md`)
- The README section text matches the `SKILL.md` frontmatter description
- Instructions are imperative and self-contained — no references to files outside the skill directory

### Step 3: Report

Summarize failures and warnings with file paths. If everything passes, say the changes are ready to commit. Do not commit unless asked.
