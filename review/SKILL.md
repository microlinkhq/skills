---
name: review
description: >-
  Drives each pull request it is given to an empty code review and an empty
  simplification: loops /code-review-and-quality, testing the edge cases next
  to every condition the diff adds and mutating each condition, then
  /code-simplification, and pushes every fix to the pull request branch.
  Several pull requests are reviewed in parallel. Use when the user invokes
  /review with one or more pull request URLs or owner/repo#number
  references.
disable-model-invocation: true
---

# Review

Two loops, in this order, on each pull request: review until a pass is empty, then simplify until a pass is empty.

One invocation owns the whole surface. The next invocation is not where the next hole is allowed to appear.

## Usage

```text
/review <PR> [<PR> ...]
```

Each `<PR>` is a pull request URL, or `owner/repo#number`, separated by spaces or newlines. If none is given, stop and show the usage line. Do not guess a pull request. Drop duplicates, and list anything that is not a pull request as skipped in the batch report.

## Batch

With more than one pull request, each one gets the whole skill on its own: Setup, Objective, both loops, Exit, and its own Report. One pull request never shares a working tree, an objective, or a finding with another.

- Review them in parallel: start one subagent per pull request, all at once. This skill cannot be invoked by a model, so tell each subagent to read this `SKILL.md` in full, by its absolute path, and run it on its one `<PR>`.
- If the host cannot run subagents, run the pull requests one at a time, in the order given, and say so in the batch report.
- A BLOCKED pull request does not stop the others.
- Wait for every subagent to finish, then end with the batch report built from their reports.

## Terms

- **Finding**: anything `/code-review-and-quality` names, at any severity (Critical, required, Nit, Optional, Consider, FYI); a sentence that a test, command, or check was not run; an untested sibling; a mutation that stays green.
- **Simplification**: a change `/code-simplification` would make.
- **Pass**: one run of one skill on the diff as it is now. It judges without regard to earlier verdicts or severity labels. The run keeps a log of every pass's findings and fixes, used only to detect oscillation and to write the report. A pass never reads that log.
- **Empty pass**: a pass that lists nothing. A review pass is empty only after the sibling walk is done for the diff as it is now.
- **Condition**: a branch, guard, or match the diff adds.
- **Diff**: the pull request branch against its base branch, including every commit this run has pushed.
- **BLOCKED**: every stop that is not DONE.

## Progress

Copy this checklist and keep it updated:

```text
- [ ] Setup: skills loaded, isolated working tree on the pull request branch, push confirmed
- [ ] Objective armed
- [ ] Review loop: empty pass reached (passes: N/8, findings fixed: N)
- [ ] Simplify loop: empty pass reached (passes: N/8, simplifications: N)
- [ ] Exit: the last review pass and the simplify pass after it are both empty
- [ ] Report
```

## Setup

Any failure in Setup is BLOCKED: name the step and paste the error.

1. Read both skills in full: `code-review-and-quality` and `code-simplification`. Load each one through the host's skill tool when it has one and the tool finds it. When there is no skill tool, or it does not find the skill, resolve the name from the first match on disk: `~/.agents/skills/<name>/SKILL.md`, `~/.claude/skills/<name>/SKILL.md`, `~/.cursor/skills/<name>/SKILL.md`, then the current repo's `.agents/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, and `.cursor/skills/<name>/SKILL.md`. If either is missing, name the paths that were checked.
2. Read the pull request. It must be open.

   ```bash
   gh pr view <PR> --json number,state,headRefName,baseRefName,url
   ```

3. Create an isolated working tree at a fixed path, so a later run finds it: `${TMPDIR:-/tmp}/review/<owner>/<repo>/<number>`. Never work in the current checkout, so someone else's uncommitted changes are never moved or touched.
   - If that path exists, an earlier BLOCKED run kept it. Reuse it: if `git status --porcelain` prints anything or a rebase is in progress, stop as BLOCKED with the path. Otherwise run `git pull --rebase` there, then only the dry run in step 4.
   - If the current directory is a clone of the pull request's repository (`gh repo view --json nameWithOwner` matches), add a worktree: `git worktree add --detach <path>`.
   - Otherwise clone it: `gh repo clone <owner>/<repo> <path>`.

   Run every later command in that path. Shell state does not survive between tool calls.
4. Inside that tree, check out the pull request on a local branch of its own name, so a branch already checked out elsewhere does not collide:

   ```bash
   gh pr checkout <PR> --branch review/<number>
   git -c push.default=upstream push --dry-run
   ```

   The dry run fails when the account cannot write to the pull request branch, fork or not. Every push in this run uses `git -c push.default=upstream push`, which lands on that branch.
5. Run the project's install step (for example `pnpm install`), so tests can run in the new tree.

## Objective

Arm the objective once, immediately after Setup and before the first pass: the block below with only `<PR>` replaced.

- If the host has a goal tool (Cursor's `CreateGoal`, or its equivalent elsewhere), pass the objective to it. If that call fails, report that no goal was armed and stop.
- If the host has no goal tool, print the objective. It is the goal: the run does not end and does not hand control back until Exit.

```text
On <PR>, run /code-review-and-quality until a fresh pass lists zero findings, then run /code-simplification until a fresh pass lists zero simplifications. If simplification edits the diff, review again. Stop only when a review pass and the simplification pass after it both list nothing.

Arm this objective unchanged. Do not add "with a concrete fix", "promotable", or any other qualifier.

Inside the review loop the severity table does not authorize skipping. Critical, required, Nit, Optional, Consider, and FYI are all work. Implement each one in the pull request, or run the check it names and record the result.

A sentence that something was not run is an open finding. Run it. If it cannot be run, stop as BLOCKED and name the exact missing input. Do not relabel that sentence FYI and exit.

Before a review pass can list nothing, walk every sibling of every condition the diff adds, in this same run. A sibling is the other branch of the same decision, the other input the platform treats the same way, and the other call that does the same thing. Test each one now. Mutate every new condition in this pass. An empty list that skipped that walk is not an exit. Finding one hole and stopping is not an exit.

After the changes, run the same skill again from the current diff, with no memory of the previous findings. The only exit is a pass whose list is empty after that walk. "Nothing to promote" and "no code change left" are not exits.
```

Start the first review pass in the same turn.

## Sibling walk

Part of every review pass. Write the siblings down. For every condition, name:

- **The other branch.** The catch next to the success path. The host check next to the gateway check. If one path decides an outcome, the other path that reports the same outcome is part of this pass.
- **The other input the platform treats the same way.** A missing header, a byte-order mark in front of the bytes the condition reads, a type the browser still executes. If the condition sniffs or matches a string, the shapes that still reach that code are part of this pass.
- **The other call that does the same thing.** `window.open` and a click. `location` and `document.location`. If one caller is guarded, the other caller is part of this pass.

Run each sibling. When it fails, it is a finding. When it holds, record the result and do not add a branch for it.

Then mutate every condition. Before each mutation, commit pending fixes so `git status --porcelain` prints nothing. Invert the condition, run the test that should catch it, and restore with `git restore --source=HEAD --staged --worktree <file>`. Never commit a mutation. A mutation that stays green is a finding: the test does not lock that line. Its fix is to delete the condition or write the test that fails.

## Review loop

1. Run a review pass, sibling walk included.
2. Do every finding: change the code on the pull request branch, or run the named check and record the result.
3. Land the changes:
   - Run the test files the diff changes and the tests that import the changed modules. If unsure which, run the package's full test command. A failing test is a finding: fix it before committing.
   - Stage by path, never `git add -A`. Commit with a message that names what the pass found.
   - Push. Never force-push. If the push is rejected as non-fast-forward, run `git pull --rebase`, run the tests again, and push. A rebase conflict is BLOCKED.
4. Run a new review pass. If it is not empty, go back to step 2.

Do not start the simplify loop while the last review pass has findings.

## Simplify loop

A pass that correctly says the code is already clean is empty. Do not invent a simplification. Follow that skill's own limits: preserve behavior, stay on the diff, and do not make a change its "do not" section rejects.

1. Run a simplification pass.
2. Apply every simplification. Tests stay green without being rewritten to fit a behavior change.
3. Land the changes, as in the review loop.
4. Run a new simplification pass. If it is not empty, go back to step 2.

## Exit

DONE only when both are true, in this order: a review pass is empty, and the simplification pass after it is empty. If any simplification landed since the last empty review pass, go back to the review loop. If a goal tool armed the objective, mark that goal complete then, and not before. On BLOCKED, close or fail the goal with the reason, so it does not keep the run going.

The objective block lists what is not an exit. Stop as BLOCKED when:

- Setup fails, or the goal tool fails.
- A check cannot be run. Name the exact missing input.
- A push, tool call, or permission is denied, for example `gh` is not authenticated or a headless run cannot push. Paste the denial.
- The loops oscillate: a finding or simplification undoes a change an earlier pass in this run made for a different reason, or the same finding returns after it was fixed. Name both passes and both changes. Do not pick one side and keep looping.
- The review loop or the simplify loop reaches 8 passes in total across the whole run, re-entries included. List every open finding.

When the run ends DONE, remove the working tree (`git worktree remove`, or delete the clone) and delete the local branch `review/<number>`. On BLOCKED after Setup, first leave the tree clean so the next run can reuse it: restore any active mutation, run `git rebase --abort` if a rebase is in progress, and commit pending fixes locally without pushing. Then keep the tree and the branch, and put the path in the report.

## Report

End each pull request with this:

```markdown
## review: <PR>

**Status:** DONE | BLOCKED

| Loop | Passes | Fixed | Last pass |
| --- | --- | --- | --- |
| Review | N | N findings | empty \| N open |
| Simplify | N | N simplifications | empty \| N open |

**Commits pushed:** <short sha> <subject>, one per line
**Siblings walked:** <condition> → <sibling>: <result>, one per line
**Mutations:** <condition>: caught by <test> | finding, one per line
**Blocked on:** <the BLOCKED case and its evidence> (BLOCKED only)
**Open findings:** <finding>, one per line (BLOCKED only)
**Working tree:** <path> (BLOCKED after Setup only)
```

With more than one pull request, end the run with the batch report, and nothing after it:

```markdown
## review batch

| Pull request | Status | Review passes | Simplify passes | Commits pushed |
| --- | --- | --- | --- | --- |
| <PR> | DONE \| BLOCKED: <reason> | N | N | N |

**Mode:** parallel | sequential (host has no subagents)
**Skipped:** <input that is not a pull request>, one per line
```
