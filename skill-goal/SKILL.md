---
name: skill-goal
description: >-
  Run a named skill against a pull request in a loop until a fresh pass lists
  nothing left to change. Use when the user invokes /skill-goal <skill> <PR>,
  including /code-review-and-quality and /code-simplification.
disable-model-invocation: true
---

# Skill goal

Run `<skill>` against `<PR>`, do every item that pass names, then run it again. Stop only when a fresh pass names nothing.

## Usage

```text
/skill-goal <skill> <PR>
```

- `<skill>` is the skill name after the slash, such as `code-review-and-quality` or `code-simplification`. A path to a `SKILL.md` is also accepted.
- `<PR>` is a pull request URL, or `owner/repo#number`.

If either argument is missing, stop and show the usage line. Do not guess the skill or the pull request.

## Start

1. Read the target `SKILL.md` in full before the first pass. Resolve a name from the first match: `~/.agents/skills/<skill>/SKILL.md`, `~/.cursor/skills/<skill>/SKILL.md`, the current repo's `.agents/skills/<skill>/SKILL.md`, then `.cursor/skills/<skill>/SKILL.md`. If none exist, stop and name the paths that were checked.
2. Call `CreateGoal` once. The objective is the block below with only `<skill>` and `<PR>` replaced. Do not add "with a concrete fix", "promotable", or any other qualifier. If creation fails, report that no goal was armed and stop.

```text
Fix every finding from /<skill> on <PR>, then run /<skill> again, until a fresh pass lists zero findings.

Pass this objective to CreateGoal unchanged. Do not add "with a concrete fix", "promotable", or any other qualifier.

Inside this loop the target skill's severity or optionality table does not authorize skipping. Critical, required, Nit, Optional, Consider, and FYI are all work. A simplification the pass names is work. Implement each one in the pull request, or run the check it names and record the result.

A sentence that something was not run is an open finding. Run it. If it cannot be run, stop as BLOCKED and name the exact missing input. Do not relabel that sentence FYI and exit.

After the changes, run /<skill> again from the current diff, with no memory of the previous findings. If that pass contains any finding, fix those and run it again. The only exit is a pass whose findings list is empty. "Nothing to promote" and "no code change left" are not exits.
```

3. Start the first pass in the same turn. Do not stop after creating the goal.

## What a finding is

A finding is anything the target pass names: a Critical, required, Nit, Optional, Consider, or FYI item, a simplification that pass would make, or a sentence that a test, command, or check was not run.

"Nothing to promote" means that list is empty. It does not mean "no code change" and it does not mean "no concrete fix". Do not invent a narrower definition when arming the goal or when deciding to stop.

The target skill still decides how a change is made. A review fix still has to be the change that review named. A simplification still has to preserve behavior, and a pass that correctly says the code is already clean is an empty list. Do not add a change that the target skill's own "do not" section rejects.

## Loop

1. Run the target skill on the current diff of `<PR>`.
2. Do every finding. Land a code or test change on the pull request, or run the named check and record the result.
3. Run the target skill again on the diff as it is now. Forget that the previous items were labeled optional.
4. If the new pass names anything, go back to step 2.
5. Stop when the new pass names nothing. Mark the goal complete only then.

These are not exits: "nothing to promote", "no code change left", relabeling an open item as FYI, or treating Nit, Optional, Consider, or FYI as skippable because the target skill says so.
