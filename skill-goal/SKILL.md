---
name: skill-goal
description: >-
  Run /code-review-and-quality on a pull request until one pass has walked
  every sibling of every new check and then names nothing, then
  /code-simplification until a fresh pass names nothing to simplify. Use
  when the user invokes /skill-goal <PR>.
disable-model-invocation: true
---

# Skill goal

Two passes, in this order, on one pull request. Review until there is nothing left to change. Then simplify until there is nothing left to simplify. If a simplification edits the diff, review that diff again before stopping.

One invocation owns the whole surface. The next invocation is not where the next hole is allowed to appear.

## Usage

```text
/skill-goal <PR>
```

`<PR>` is a pull request URL, or `owner/repo#number`. If it is missing, stop and show the usage line. Do not guess the pull request.

## Start

1. Read both skills in full before the first pass. Resolve each name from the first match: `~/.agents/skills/<name>/SKILL.md`, `~/.cursor/skills/<name>/SKILL.md`, the current repo's `.agents/skills/<name>/SKILL.md`, then `.cursor/skills/<name>/SKILL.md`. The names are `code-review-and-quality` and `code-simplification`. If either is missing, stop and name the paths that were checked.
2. Call `CreateGoal` once. The objective is the block below with only `<PR>` replaced. Do not add "with a concrete fix", "promotable", or any other qualifier. If creation fails, report that no goal was armed and stop.

```text
On <PR>, run /code-review-and-quality until a fresh pass lists zero findings, then run /code-simplification until a fresh pass lists zero simplifications. If simplification edits the diff, review again. Stop only when a review pass and the simplification pass after it both list nothing.

Pass this objective to CreateGoal unchanged. Do not add "with a concrete fix", "promotable", or any other qualifier.

Inside the review loop the severity table does not authorize skipping. Critical, required, Nit, Optional, Consider, and FYI are all work. Implement each one in the pull request, or run the check it names and record the result.

A sentence that something was not run is an open finding. Run it. If it cannot be run, stop as BLOCKED and name the exact missing input. Do not relabel that sentence FYI and exit.

Before a review pass can list nothing, walk every sibling of every condition the diff adds, in this same run. A sibling is the other branch of the same decision, the other input the platform treats the same way, and the other call that does the same thing. Test each one now. Mutate every new condition in this pass. An empty list that skipped that walk is not an exit. Finding one hole and stopping is not an exit.

After the changes, run the same skill again from the current diff, with no memory of the previous findings. The only exit is a pass whose list is empty after that walk. "Nothing to promote" and "no code change left" are not exits.
```

3. Start the review pass in the same turn. Do not stop after creating the goal. Do not simplify while the review list is non-empty.

## One run

A later run of this skill found the next hole because the previous run fixed the one it noticed and stopped. That split is the failure this section exists to prevent.

Before a review pass can list nothing, do this walk in the same run. Write the siblings down. An untested sibling is a finding.

For every condition the diff adds, name:

- **The other branch.** The catch next to the success path. The host check next to the gateway check. If one path decides an outcome, the other path that reports the same outcome is part of this pass.
- **The other input the platform treats the same way.** A missing header, a byte-order mark in front of the bytes the check reads, a type the browser still executes. If the check sniffs or matches a string, the shapes that still reach that code are part of this pass.
- **The other call that does the same thing.** `window.open` and a click. `location` and `document.location`. If one caller is guarded, the other caller is part of this pass.

Run each sibling now. When it fails, fix it before this pass ends. When it does not fail, record the result and do not add a branch for it. A check whose test stays green after the check is removed does not lock the line: delete the check, or write the test that fails, in this pass.

Mutate every condition this diff adds, in this pass. Invert it, run the test that should catch it, and restore the file. One mutation is not the walk. A mutation that stays green is a finding: the test does not lock that line.

These are not exits: an empty list that skipped the walk, fixing one hole and declaring the rest for later, or completing the goal while a sibling is still untested.

## Review loop

A review finding is anything `/code-review-and-quality` names: Critical, required, Nit, Optional, Consider, FYI, a sentence that a test, command, or check was not run, or an untested sibling from the walk above.

1. Run `/code-review-and-quality` on the current diff. Include the sibling walk in that pass, before the list can be empty.
2. Do every finding. Land the change on the pull request, or run the named check and record the result.
3. Run `/code-review-and-quality` again on the diff as it is now. Forget that earlier items were labeled optional. Walk the siblings of any condition the fixes added.
4. If that pass names anything, go back to step 2.
5. Leave this loop only when the pass names nothing and the sibling walk for the diff as it is now is done.

These are not exits: "nothing to promote", "no code change left", relabeling an open item as FYI, treating Nit, Optional, Consider, or FYI as skippable, or stopping after the first hole.

## Simplify loop

Start only after the review loop has exited. A simplification is a change `/code-simplification` would make. A pass that correctly says the code is already clean lists zero. Do not invent one. Follow that skill's own limits: preserve behavior, stay on the pull request diff, and do not make a change its "do not" section rejects.

1. Run `/code-simplification` on the current diff.
2. Apply every simplification it names. Tests stay green without being rewritten to fit a behavior change.
3. Run `/code-simplification` again on the diff as it is now.
4. If that pass names a simplification, go back to step 2.
5. Leave this loop only when the pass names nothing.

## Exit

Simplification can make the last review stale. If this simplify loop edited the diff, go back to the review loop, then simplify again. The sibling walk applies to that review too.

Mark the goal complete only when both are true, in this order: a review pass lists nothing after the sibling walk, and the simplification pass that follows it lists nothing and does not edit the diff.
