#!/usr/bin/env python3
"""Run every mutation of a review pass in one call.

    mutate.py <spec.tsv>      (or - for stdin)

Each spec line is five tab-separated fields:

    <file>  <line>  <text to find on that line>  <replacement>  <test command>

Every distinct command first runs once on the unmutated tree and must pass, so a
broken command can never count as catching a mutation. Then, for each line, the
first occurrence of the text on that line is replaced, the command runs through
the shell from the tree root, and the file is restored from HEAD.

    CAUGHT    the command failed (or ran past LOOP_REVIEW_TIMEOUT, default 600s)
    SURVIVED  the command passed: no test locks this condition
    SKIPPED   the text is not on that line; fix the spec row

Files must be tracked and the tree clean, so a restore never drops a pending fix.
The file being mutated is recorded in <git dir>/loop-review/active-mutation, and a
run killed mid-mutation is undone by the next mutate.py or setup.py. A file that
changed under a mutation (someone edited it) is not restored: the run stops.

Exits 0 when every mutation was caught, 1 when any survived or was skipped, and 2
when the spec, the tree or a baseline run is not usable.
"""

import os
import re
import signal
import subprocess
import sys
import time

TIMEOUT = int(os.environ.get('LOOP_REVIEW_TIMEOUT', '600'))


class Unusable(Exception):
    pass


def git(*args, check=True):
    proc = subprocess.run(['git', *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise Unusable(f"`git {' '.join(args)}` failed: {proc.stderr.strip()}")
    return proc.stdout.strip()


def parse(text):
    rows = []
    for number, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        fields = raw.split('\t')
        if len(fields) != 5 or not fields[1].isdigit() or int(fields[1]) < 1:
            raise Unusable(f'spec line {number}: want file, line (from 1), find, replace, command separated by tabs')
        if not fields[2] or fields[2] == fields[3]:
            raise Unusable(f'spec line {number}: the text to find must be non-empty and differ from its replacement')
        rows.append(dict(file=fields[0], line=int(fields[1]), find=fields[2], replace=fields[3], command=fields[4]))
    if not rows:
        raise Unusable('spec has no mutations')
    for path in sorted({row['file'] for row in rows}):
        if git('ls-files', '--error-unmatch', '--', path, check=False) == '':
            raise Unusable(f'{path} is not a tracked file: mutations restore from HEAD, so only tracked files can be mutated')
    return rows


def run(command, log):
    """Exit code of `command`, or None when it ran past TIMEOUT. Kills its whole process group."""
    with open(log, 'w') as out:
        proc = subprocess.Popen(command, shell=True, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            return proc.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            return None


def restore(path):
    git('restore', '--source=HEAD', '--staged', '--worktree', '--', path)


def recover(marker):
    if os.path.exists(marker):
        with open(marker) as file:
            path = file.read().strip()
        restore(path)
        os.remove(marker)
        print(f'restored {path}, which an interrupted run left mutated')


def mutate(row):
    with open(row['file'], newline='') as file:
        lines = file.read().split('\n')
    index = row['line'] - 1
    if index >= len(lines) or row['find'] not in lines[index]:
        return None
    lines[index] = lines[index].replace(row['find'], row['replace'], 1)
    content = '\n'.join(lines)
    with open(row['file'], 'w', newline='') as file:
        file.write(content)
    return content


def log_name(logs, number, row):
    return os.path.join(logs, f"{number:03d}-{re.sub(r'[^A-Za-z0-9._-]', '_', row['file'])}_{row['line']}.log")


def main(argv):
    if len(argv) != 1:
        print('usage: mutate.py <spec.tsv | ->', file=sys.stderr)
        return 2
    try:
        os.chdir(git('rev-parse', '--show-toplevel'))
        logs = os.path.join(git('rev-parse', '--path-format=absolute', '--git-path', 'loop-review'), 'mutations')
        os.makedirs(logs, exist_ok=True)
        marker = os.path.join(os.path.dirname(logs), 'active-mutation')
        recover(marker)
        rows = parse(sys.stdin.read() if argv[0] == '-' else open(argv[0]).read())
        if git('status', '--porcelain', '--untracked-files=no'):
            raise Unusable('commit or restore tracked changes first, so a restore cannot drop them')
        for index, command in enumerate(dict.fromkeys(row['command'] for row in rows), 1):
            log = os.path.join(logs, f'baseline-{index}.log')
            if run(command, log) != 0:
                raise Unusable(f'the command fails before any mutation, so it cannot catch one: {command} (log {log})')
    except (OSError, Unusable) as error:
        print(f'mutate: {error}', file=sys.stderr)
        return 2

    open_rows = 0
    for number, row in enumerate(rows, 1):
        where = f"{row['file']}:{row['line']}"
        change = f"{row['find']!r} -> {row['replace']!r}"
        if git('status', '--porcelain', '--untracked-files=no'):
            print(f'mutate: tracked files changed during the run; stopped before row {number}', file=sys.stderr)
            return 2
        with open(marker, 'w') as file:
            file.write(row['file'])
        mutated = mutate(row)
        if mutated is None:
            os.remove(marker)
            open_rows += 1
            print(f'{number:>3} SKIPPED  {where} {change}: text not on that line')
            continue
        log = log_name(logs, number, row)
        started = time.time()
        code = run(row['command'], log)
        with open(row['file'], newline='') as file:
            untouched = file.read() == mutated
        if not untouched:
            print(f'mutate: {row["file"]} changed while row {number} ran; it was not restored, check it by hand', file=sys.stderr)
            return 2
        restore(row['file'])
        os.remove(marker)
        verdict = 'SURVIVED' if code == 0 else 'CAUGHT  '
        open_rows += code == 0
        timeout = ', timed out' if code is None else ''
        print(f'{number:>3} {verdict} {where} {change} ({time.time() - started:.0f}s{timeout}) log={log}')
    print(f'{len(rows) - open_rows}/{len(rows)} caught')
    return 0 if open_rows == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
