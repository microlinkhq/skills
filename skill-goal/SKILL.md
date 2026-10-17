---
name: skill-goal
description: >-
  Run /code-review-and-quality on a pull request until a fresh pass names no
  changes, then /code-simplification until a fresh pass names nothing to
  simplify. Use when the user invokes /skill-goal <PR>.
disable-model-invocation: true
---

# Skill goal

Two passes, in this order, on one pull request. Review until there is nothing left to change. Then simplify until there is nothing left to simplify. If a simplification edits the diff, review that diff again before stopping.

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

After the changes, run the same skill again from the current diff, with no memory of the previous findings. The only exit is a pass whose list is empty. "Nothing to promote" and "no code change left" are not exits.
```

3. Start the review pass in the same turn. Do not stop after creating the goal. Do not simplify while the review list is non-empty.

## Review loop

A review finding is anything `/code-review-and-quality` names: Critical, required, Nit, Optional, Consider, FYI, or a sentence that a test, command, or check was not run.

1. Run `/code-review-and-quality` on the current diff.
2. Do every finding. Land the change on the pull request, or run the named check and record the result.
3. Run `/code-review-and-quality` again on the diff as it is now. Forget that earlier items were labeled optional.
4. If that pass names anything, go back to step 2.
5. Leave this loop only when the pass names nothing.

These are not exits: "nothing to promote", "no code change left", relabeling an open item as FYI, or treating Nit, Optional, Consider, or FYI as skippable.

## Simplify loop

Start only after the review loop has exited. A simplification is a change `/code-simplification` would make. A pass that correctly says the code is already clean lists zero. Do not invent one. Follow that skill's own limits: preserve behavior, stay on the pull request diff, and do not make a change its "do not" section rejects.

1. Run `/code-simplification` on the current diff.
2. Apply every simplification it names. Tests stay green without being rewritten to fit a behavior change.
3. Run `/code-simplification` again on the diff as it is now.
4. If that pass names a simplification, go back to step 2.
5. Leave this loop only when the pass names nothing.

## Exit

Simplification can make the last review stale. If this simplify loop edited the diff, go back to the review loop, then simplify again.

Mark the goal complete only when both are true, in this order: a review pass lists nothing, and the simplification pass that follows it lists nothing and does not edit the diff.
