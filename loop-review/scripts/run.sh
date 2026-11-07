#!/usr/bin/env bash
# run.sh <label> <command> [args...]
#
# Runs one command with its whole output in a log file, and prints one verdict
# line, plus the last lines of the log when it fails. Exits with the command's
# status (124 when it ran past the time limit), so `run.sh test pnpm test &&
# git push ...` still works.
#
# LOOP_REVIEW_LOGS (default: <git dir>/loop-review) holds the logs.
# LOOP_REVIEW_TAIL (default: 40) is how many lines a failure prints.
# LOOP_REVIEW_TIMEOUT (default: 1800) is the time limit in seconds.
# <logs>/node-bin, written by setup.py when package.json pins another Node.js
# major than the node on PATH, is put first on PATH.
set -u
[ $# -ge 2 ] || { echo "usage: run.sh <label> <command> [args...]" >&2; exit 64; }
label=$1; shift
logs=${LOOP_REVIEW_LOGS:-$(git rev-parse --path-format=absolute --git-path loop-review 2>/dev/null || echo "${TMPDIR:-/tmp}/loop-review-logs")}
mkdir -p "$logs"
node_bin=$(git rev-parse --path-format=absolute --git-path loop-review/node-bin 2>/dev/null)
[ -s "$node_bin" ] && PATH="$(cat "$node_bin"):$PATH"
log="$logs/$(printf %s "$label" | tr -c 'A-Za-z0-9._-' '_').log"
limit=${LOOP_REVIEW_TIMEOUT:-1800}
start=$(date +%s)
exec 2>/dev/null
set -m
"$@" >"$log" 2>&1 </dev/null &
pid=$!
( sleep "$limit"; kill -KILL -- "-$pid" 2>/dev/null ) >/dev/null 2>&1 &
watchdog=$!
wait "$pid"
code=$?
kill -KILL -- "-$watchdog" 2>/dev/null
seconds=$(( $(date +%s) - start ))
[ "$code" -eq 137 ] && [ "$seconds" -ge "$limit" ] && code=124
if [ "$code" -eq 0 ]; then
  echo "PASS $label (${seconds}s) log=$log"
else
  reason="exit=$code"
  [ "$code" -eq 124 ] && reason="timed out after ${limit}s"
  echo "FAIL $label $reason (${seconds}s) log=$log"
  sed -e 's/\x1b\[[0-9;?]*[A-Za-z]//g' "$log" | grep -v '^[[:space:]]*$' | tail -n "${LOOP_REVIEW_TAIL:-40}"
fi
exit "$code"
