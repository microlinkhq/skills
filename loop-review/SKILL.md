---
name: loop-review
description: >-
  Drives each pull request it is given to an empty code review and an empty
  simplification: loops /code-review-and-quality, testing every sibling of
  every condition the diff adds. The sibling list is the names that statement
  contains, including a name it leaves allowed. It is not every type or
  spelling that could be written in its place. Mutate each condition, then
  /code-simplification, and push every fix to the pull request branch. Reviews
  in the tree the feature was written in when it is clean, and keeps one tree
  per pull request between runs. Use when the user invokes /loop-review with
  one or more GitHub pull request or GitLab merge request URLs, owner/repo#number
  or group/project!number references.
disable-model-invocation: true
---

# Loop Review

Two loops, in this order, on each pull request: review until a pass is empty, then simplify until a pass is empty.

One invocation owns the whole surface. Finish every sibling of every condition in this run. The next invocation is not where a name on this run's list is allowed to appear. A type or spelling the statement does not contain is not on that list.

## Usage

```text
/loop-review <PR> [<PR> ...]
```

Each `<PR>` is a GitHub pull request URL, a GitLab merge request URL, `owner/repo#number` (GitHub) or `group/project!number` (GitLab), separated by spaces or newlines. If none is given, stop and show the usage line. Do not guess a pull request. Drop duplicates, and list anything that is not a pull request as skipped in the batch report. `scripts/setup.py` prints each one's URL as `PR=`; every later `<PR>` is that URL.

`<skill-dir>` below is the directory this `SKILL.md` was read from.

## Batch

With one pull request, run everything in this conversation. Do not start a subagent: it would read this skill and both review skills again into a cold context.

With more than one pull request, each one gets the whole skill on its own: Setup, Objective, both loops, Exit, and its own Report. One pull request never shares a working tree, an objective, or a finding with another.

- Review them in parallel: one subagent per pull request, at most 4 running at once. Start the next as soon as one finishes. This skill cannot be invoked by a model, so give each subagent the absolute path of this `SKILL.md` and its one `<PR>`, and tell it to read the file and run it. Do not paste the file into the prompt.
- If the host cannot run subagents, run the pull requests one at a time, in the order given, and say so in the batch report.
- A BLOCKED pull request does not stop the others.
- A subagent that fails, or ends without its report, is BLOCKED: no report. Put its working tree path in the batch report.
- Wait for every subagent to finish, then end with the batch report built from their reports.

## Token budget

Every tool call re-sends the whole conversation, so the cost of a run is its number of turns times its context. Keep both small.

- One command per step. Setup is one `setup.py` call and a test run is one `run.sh` call. Chain the commands of one step with `&&` in a single call, and put a pass's mutations in one shell loop that prints one line per condition.
- Read each review skill once, in Setup. Later passes already have it in context.
- Cap output. Run tests, installs, builds and pushes through `<skill-dir>/scripts/run.sh <label> <command>`: it prints one line when the command passes and the last 40 lines when it fails, and keeps the full log on disk. Pipe anything else that can print more than 50 lines through `head -50`, and read the log file only when that tail is not enough. The diff is the exception: read all of it.
- Read the whole diff once per pass (`git diff <BASE>...HEAD`, never truncated), and read files at the lines the diff touches rather than whole files.
- Do not open `node_modules`, build output or binaries to understand a dependency: search for the one symbol (`rg -n <symbol> node_modules/<package> | head -20`).
- Do not fetch the pull request's comments, discussions or CI jobs. This skill reviews the diff.

## Terms

- **Finding**: anything `/code-review-and-quality` names, at any severity (Critical, required, Nit, Optional, Consider, FYI); a sentence that a test, command, or check was not run; an untested sibling; a sibling that failed, including one set aside as unrealistic, private, a known limit, or out of scope; a mutation that stays green for a name on the sibling list, including a ban of a name the condition leaves allowed. A green mutation that adds a type or spelling the statement does not name is not a finding.
- **Simplification**: a change `/code-simplification` would make.
- **Pass**: one run of one skill on the diff as it is now. It judges without regard to earlier verdicts or severity labels. The run keeps a log of every pass's findings and fixes, used only to detect oscillation and to write the report. A pass never reads that log.
- **Empty pass**: a pass that lists nothing. A review pass is empty only after every sibling of the diff as it is now has been run. A sibling left unrun, or run and then set aside, means the pass is not empty.
- **Condition**: a branch, guard, or match the diff adds.
- **Diff**: the pull request branch against its base branch, including every commit this run has pushed.
- **BLOCKED**: every stop that is not DONE.

## Progress

Copy this checklist and keep it updated:

```text
- [ ] Setup: skills loaded, setup.py ready (TREE, BASE, PUSH)
- [ ] Objective armed
- [ ] Review loop: empty pass reached (passes: N/8, findings fixed: N)
- [ ] Simplify loop: empty pass reached (passes: N/8, simplifications: N)
- [ ] Exit: the last review pass and the simplify pass after it are both empty
- [ ] Report
```

## Setup

Any failure in Setup is BLOCKED: name the step and paste the error.

1. Read both skills in full, once: `code-review-and-quality` and `code-simplification`. Load each one through the host's skill tool when it has one and the tool finds it. When there is no skill tool, or it does not find the skill, resolve the name from the first match on disk: `~/.agents/skills/<name>/SKILL.md`, `~/.claude/skills/<name>/SKILL.md`, then `~/.cursor/skills/<name>/SKILL.md`. Never load them from a repository, which a pull request can change. If either is missing, name the paths that were checked.
2. Run, from the current directory:

   ```bash
   python3 <skill-dir>/scripts/setup.py <PR>
   ```

   Run it from a clone of the pull request's repository: the checkout, or any of its worktrees, where the feature was written. It reads the pull request (`gh` or `glab`), refuses one that is not open or comes from a fork, and picks the working tree:

   - The review tree an earlier run kept: the worktree on branch `loop-review/<number>`. It is fetched and fast-forwarded, and the commits it has that the remote lacks are kept: they are fixes a BLOCKED run committed, and the next push publishes them (`UNPUSHED` counts them).
   - Otherwise the worktree that has the head branch checked out, which is the one the feature was written in, when its tracked files are clean and it has no commits the remote lacks. It is fast-forwarded and reviewed in place: same files, same `node_modules`, and its branch is never switched.
   - Otherwise a new review tree at `~/.cache/loop-review/<host>/<repo>/<number>` on `loop-review/<number>`, from the remote head. Started outside any clone, the run makes one cached clone of the repository first.

   A feature tree with uncommitted changes or unpushed commits gets a separate review tree, so work in progress is never touched or published. A review tree with uncommitted changes, a rebase or merge in progress, or history that diverged from the remote is BLOCKED with the command that fixes it. It then dry-runs the push and installs dependencies only when a `package.json` or lockfile changed since the last install in that tree (a `node_modules` installed after the last manifest change counts as current); a new review tree first copies `node_modules` from a sibling worktree.

   It prints `STATUS=ready` with `TREE`, `TREE_KIND` (`feature` or `review`), `BRANCH`, `BASE`, `PUSH`, `PULL`, `UNPUSHED`, `INSTALL` and the diff stat, or `STATUS=blocked` with a one-line `REASON` (and any detail after `--- detail`), which is this run's BLOCKED evidence. Run every later command in `TREE`, starting it with `cd <TREE> &&`, since shell state does not survive between calls. Every push is the printed `PUSH` command and every pull the printed `PULL` command, which name the pull request branch.

## Objective

Arm the objective once, immediately after Setup and before the first pass: the block below with only `<PR>` replaced. It is short on purpose, because a goal tool sends it again on every turn; the rules it relies on are in Terms, Sibling walk and Exit, which are already in context.

- If the host has a goal tool (Cursor's `CreateGoal`, or its equivalent elsewhere), pass the objective to it. If that call fails, report that no goal was armed and stop.
- If the host has no goal tool, print the objective. It is the goal: the run does not end and does not hand control back until Exit.

```text
On <PR>, run /code-review-and-quality until a fresh pass lists zero findings, then /code-simplification until a fresh pass lists zero simplifications; if simplification edits the diff, review again. Stop only when a review pass and the simplification pass after it both list nothing, as loop-review's Exit defines it. Every severity is work, a check that was not run is an open finding (run it, or stop as BLOCKED naming the missing input; do not relabel it FYI), and a pass is empty only after its whole sibling walk and every mutation ran. "Nothing to promote" and "no code change left" are not exits. Arm this objective unchanged: do not add "with a concrete fix", "promotable", or any other qualifier.
```

Start the first review pass in the same turn.

## Sibling walk

Part of every review pass. Write the siblings down. For every condition and every changed value, name:

- **The other branch.** The catch next to the success path. The host check next to the gateway check. If one path decides an outcome, the other path that reports the same outcome is part of this pass.
- **The other input the platform treats the same way.** A missing header, a byte-order mark in front of the bytes the condition reads, a type the browser still executes. If the condition sniffs or matches a string, the shapes that still reach that code are part of this pass.
- **The other call that does the same thing.** `window.open` and a click. `location` and `document.location`. If one caller is guarded, the other caller is part of this pass.
- **The reader outside the diff.** A config key, a count, a status, a default, a return shape. When the diff changes a value, every place in the repository that reads it or depends on what it causes is part of this pass, inside the diff or not. Search the repository for the name and for the effect it produces: a cache TTL set to 0 turns every request into a miss, so an alert on the miss rate is a reader.

Run each sibling. When it fails, it is a finding. When it holds, record the command that passed and do not add a branch for it.

The walk is the whole set the condition's statement touches, not the names the diff already wrote down. A list of keys, methods, headers, or strings stands for every name that same copy, match, or call writes, reads, or accepts. Read the statement and write those names down before changing code. The fields it copies, the methods on the value it writes onto, and the properties that type declares are the list. The names the diff already excludes are not the list. One of those names that is missing from your list means this pass is not empty. If the condition excludes `get` and `set` because a copy replaces them, every other method that copy replaces is a sibling, including a private one, and every name that same copy still writes is a sibling too.

A type annotation contributes its own name, not the universe of types. `boolean` is one name. Its allows are the values the statement already distinguishes, such as `true` and `false`, plus omission when the property is optional. One rejection of a value outside that type is enough when the suite already has one. `number`, `null`, `string`, `object`, `bigint`, `symbol`, an array, a function, and `void` are not siblings of `boolean` unless the statement or a caller in the diff already passes that value. Do not union one in to see if the suite stays green.

Two spellings that accept the same programs are one name. Replacing `Promise<unknown>` with `Promise<any>` is not a finding when the suite still typechecks. Do not snapshot the compiler's error text, export the constraint, turn on a flag the project does not already use, or flip the spelling. An optional property already allows omission. Explicit `undefined` is that same allow unless the project already compiles with `exactOptionalPropertyTypes`. Do not add `| undefined` and do not add a probe whose only job is to lock that flag.

A name the condition does not exclude, and that is on the list, is the other branch, the allow. Mutate the allow by adding that name to the exclusion and running the tests. Red means a valid input already uses the name: leave it allowed. Green means the allow is unlocked. That green is a finding even when the name is a real option, and even when a runtime command still succeeds. The fix is a test that passes a value using that name, so the same ban goes red. A comment that the name stays allowed is not the test. "It is valid, so do not exclude it" and "the suite stays green because no test passes it" are not exits. When the exclusion is `get` and `set`, and the same copy writes `serialize`, `deserialize`, and `ttl`, those three are this case: ban each one, and a green result means add the test that uses it. Finish every name on the list in this pass. Fixing the first name on that list and ending is how the next run finds the rest of that list. A later run that only names a type or spelling the statement does not contain must not change the diff.

Do not set a sibling aside. "Unrealistic", "a user would not pass that", "known limit", "private", "not the shape this pull request is about", and "out of scope" are not reasons. A sibling you can fix inside this diff, without also rejecting the valid branch, is fixed in this run. The only failed sibling that stays unfixed is one where every fix rejects the valid branch too: show that, and do not add the broken check.

"Holds" means the command passed. A sibling you did not run does not hold. A sibling that failed does not hold because you can explain it. A hold for an allow on the list is the test going red when that name is banned. A runtime command that the behavior still works does not lock a name on the list, and it does not substitute for that mutation. A green result for a type or spelling the statement does not name needs no test.

Then mutate every condition. Before each mutation, commit pending fixes so `git status --porcelain` prints nothing. Invert the condition, run the test that should catch it, and restore with `git restore --source=HEAD --staged --worktree <file>`. Never commit a mutation. A mutation that stays green for a name on the list is a finding: the test does not lock that name. Its fix is to delete the condition or write the test that fails. A sentence is not a fix. Keeping an allow, and saying why, is neither fix. Do that write or delete in this pass, for every green mutation of a name on the list, before the pass can be empty. A mutation that stays green because it adds a type or spelling the statement does not name is not on that list. Record the command and do not add a test.

## Review loop

1. Run a review pass, sibling walk included.
2. Do every finding: change the code on the pull request branch, or run the named check and record the result.
3. Land the changes:
   - Run the test files the diff changes and the tests that import the changed modules, through `run.sh`. If unsure which, run the package's full test command. A failing test is a finding: fix it before committing.
   - Stage by path, never `git add -A`. Commit with a message that names what the pass found.
   - Push with `<skill-dir>/scripts/run.sh push <PUSH>`. Never force-push. If the push is rejected as non-fast-forward, run `<PULL>`, run the tests again, and push. A rebase conflict is BLOCKED.
4. Run a new review pass. If it is not empty, go back to step 2.

Do not start the simplify loop while the last review pass has findings.

## Simplify loop

A pass that correctly says the code is already clean is empty. Do not invent a simplification. Follow that skill's own limits: preserve behavior, stay on the diff, and do not make a change its "do not" section rejects.

1. Run a simplification pass.
2. Apply every simplification. Tests stay green without being rewritten to fit a behavior change.
3. Land the changes, as in the review loop.
4. Run a new simplification pass. If it is not empty, go back to step 2.

## Exit

DONE only when both are true, in this order: a review pass is empty, and the simplification pass after it is empty. DONE is false when any sibling of a condition this run walked is unnamed, unrun, or set aside. DONE is false when any name on the list is missing, or is left allowed without a test that goes red when that name is banned. The list is the names the statement contains, including the names it leaves allowed. A type annotation is one name. Finish that list in this run. A later run finding a name that was on the list means this run stopped early. A later run that only names a type or spelling the statement does not contain must not change the diff, and it is not evidence this run stopped early. If any simplification landed since the last empty review pass, go back to the review loop. If a goal tool armed the objective, mark that goal complete then, and not before. On BLOCKED, close or fail the goal with the reason, so it does not keep the run going.

The objective block and Sibling walk list what is not an exit. Stop as BLOCKED when:

- Setup fails, or the goal tool fails.
- A check cannot be run. Name the exact missing input.
- A push, tool call, or permission is denied, for example `gh` is not authenticated or a headless run cannot push. Paste the denial.
- The loops oscillate: a finding or simplification undoes a change an earlier pass in this run made for a different reason, or the same finding returns after it was fixed. Name both passes and both changes. Do not pick one side and keep looping.
- The review loop or the simplify loop reaches 8 passes in total across the whole run, re-entries included. List every open finding.

Keep the working tree and its branch in every case, so the next run on this pull request is a fetch instead of a new tree and a new install. On BLOCKED after Setup, first restore any active mutation and run `git rebase --abort` if a rebase is in progress. Then, in a `review` tree, commit pending fixes locally without pushing: the next run resumes them. In a `feature` tree, commit nothing: leave pending fixes uncommitted for the developer and list them in the report, so the feature branch never gets commits its owner did not make. Put the path in the report.

## Report

End each pull request with this:

```markdown
## loop-review: <PR>

**Status:** DONE | BLOCKED

| Loop | Passes | Fixed | Last pass |
| --- | --- | --- | --- |
| Review | N | N findings | empty \| N open |
| Simplify | N | N simplifications | empty \| N open |

**Commits pushed:** <short sha> <subject>, one per line
**Siblings walked:** <condition> → <sibling>: hold (<command that passed>) | finding, one per line. Every name on the list is a line, including a name the condition leaves allowed. A type or spelling the statement does not name is not a line. A line with no command is an open finding. An allowed name on the list whose ban stays green is an open finding. A green mutation that only adds a type or spelling the statement does not name is not an open finding.
**Mutations:** <condition>: caught by <test> | finding, one per line
**Blocked on:** <the BLOCKED case and its evidence> (BLOCKED only)
**Open findings:** <finding>, one per line (BLOCKED only)
**Working tree:** <path> (<TREE_KIND from setup.py>)
```

With more than one pull request, end the run with the batch report, and nothing after it:

```markdown
## loop-review batch

| Pull request | Status | Review passes | Simplify passes | Commits pushed |
| --- | --- | --- | --- | --- |
| <PR> | DONE \| BLOCKED: <reason> | N | N | N |

**Mode:** parallel | sequential (host has no subagents)
**Skipped:** <input that is not a pull request>, one per line
```
