# mend

`main.ts` is mend, finished: one command-line tool that applies the edits AI models write, in four formats, to a tree
of files. `SPEC.md` is the whole specification. The checks that score you are drawn after the deadline from a pool
nobody outside the house has seen; the practice checks are public.

## Usage

    node main.ts [--format=NAME] [--check] [--strict] [PATCH]

`PATCH` is the patch file, or `-`/absent to read from standard input. `--format` picks one format (`unified`,
`search-replace`, `v4a`, `json`); `auto` (the default) detects it. `--check` reports what would change without
writing anything. `--strict` matches lines exactly (tier 0 only).

Unified diff (wrong line numbers are tolerated — hunks match at the nearest occurrence):

    node main.ts fix.patch
    --- a/server.ts
    +++ b/server.ts
    @@ -12,3 +12,3 @@
       const total = items.length;
    -  if (total > limit) return;
    +  if (total >= limit) return;

SEARCH/REPLACE blocks (the path is the nearest non-blank, non-fence line above the block):

    node main.ts edit.patch
    server.ts
    <<<<<<< SEARCH
      if (total > limit) return;
    =======
      if (total >= limit) return;
    >>>>>>> REPLACE

V4A patches (chunks match at the first occurrence at or after the cursor; `*** End of File` anchors to the end):

    node main.ts change.patch
    *** Begin Patch
    *** Update File: server.ts
    @@   if (total > limit) return;
    -  if (total > limit) return;
    +  if (total >= limit) return;
    *** End Patch

JSON tool calls (one array, or one object per line):

    node main.ts edits.json
    [{"command": "str_replace", "path": "server.ts", "old_str": "if (total > limit) return;", "new_str": "if (total >= limit) return;"}]

Dry run and strict matching:

    node main.ts --check fix.patch
    node main.ts --strict fix.patch

Every run is all or nothing: when any edit fails, nothing is written and every failure is reported; when none fails,
each changed path is listed (`A`/`D`/`M`, or `R old -> new` for a move) and the run ends with `ok: N files`.

## The files

- `main.ts`: the CLI, Node 22 and its standard library alone, run as `node main.ts [options] [PATCH]`. It does all of
  SPEC.md: the command line, the output, safe paths, format detection, three-tier line matching, unified diffs,
  SEARCH/REPLACE blocks, V4A patches, JSON edits and the all-or-nothing write. Its last lines hand a trial over to
  `runner.ts` when `MAKEFUN_ENV_URL` is set: keep them.
- `runner.ts`: keep it as it is. In a trial it reads the checks from the env, runs `node main.ts` on each one in a
  fresh directory, and posts what main.ts did (its exit code, its stdout and the files left in the directory).
- `check.ts`: the practice set on your own machine. The kit carries it at `program/generator/practice.json`:

      node check.ts ../program/generator/practice.json
      node check.ts ../program/generator/practice.json u-offset s-basic

  It prints every check main.ts gets wrong, with what differed, and the practice score.
- `SPEC.md`: the specification.
- `LICENSE`: MIT. Your repository needs an OSI-approved licence of your choosing.

## A check

A check is one run: its arguments, its standard input (or none) and the files it starts with. It passes when the exit
code, everything written to stdout and every file afterwards are exactly what SPEC.md says. stderr is never compared,
so write what you like there. Each run has 10 seconds; the whole trial of 100 checks runs inside the trial's wall time.

## What makes a good entry

The checks are written the way models get edits wrong: wrong line numbers, drifted whitespace and indentation, blank
context lines without their leading space, prose and code fences around the patch, CRLF files, files without a final
line break, blocks that occur twice. Read SPEC.md sentence by sentence; the hidden checks test sentences the practice
set does not.
