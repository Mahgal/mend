# mend — BUILD.md

## Status — DONE, ready to submit (2026-11-23 ~16:00 CST)

- Repo: https://github.com/Mahgal/mend (public, created, HTTP 201, id 1468430217). Local work dir `~/workspace/makefun/hidden-spec-cli-01/` — git init done, remote `origin` set.
- **Final commit: `9fb1c9ec322d05ef65add000933417b90d773db7`** (root commit, 7 files, 1586 insertions, author Mahgal <imahgal@gmail.com>). Pushed to `main`; API read-back confirms the commit on main and the tree (BUILD.md, LICENSE, README.md, SPEC.md, check.ts, main.ts, runner.ts). Topics: cli, diff, makefun, patch, typescript. Homepage: https://make.fun/bounty/hidden-spec-cli-01. Description set.
- Kit: `~/workspace/makefun/hidden-spec-cli-01-kit/hidden-spec-cli-01-run-20261122-kit/` (9,575,573 B). Starter files copied to work dir: `main.ts`, `runner.ts`, `check.ts`, `README.md`, `SPEC.md`, `LICENSE`.
- **BLOCK (resolved):** the system flagged the kit content on an execution-risk check (exec call `call_01a20753a3ce768091965db8aecb9cf8`). User approved continuing at 2026-11-23 15:37 ("两个都继续"). Parent agent read-only inspected main.ts/runner.ts/check.ts: clean (runner only spawns the candidate program and fetches the trial URL). Work resumed.
- Implementation: `main.ts` now covers SPEC.md §§1–10: §5 three-tier matching + re-indent, §6 unified (sections/hunks/nearest-occurrence/`\` final-break/R rows), §7 SEARCH/REPLACE, §8 V4A (anchors/cursor/EOF chunks/Move to), §9 JSON (starter, untouched), §10 order/atomicity (starter). `runner.ts`/`check.ts` untouched.
- Deadline: 2026-11-24 14:00 UTC (22:00 CST). Prize $100, 6,501 entries at dispatch. Do NOT submit (submission goes through the parent; transcript bundle by parent after completion).

## Verification (all STRONG)

- **Practice 100/100, score 1000** — `node check.ts <practice.json>` under Node 22.23.4, run three times (first run + determinism double-run), identical output each time: `100 of 100 passed: practice score 1000`.
- **Determinism**: two consecutive full practice runs, byte-identical results (both 100/100).
- **tsc --strict: zero errors** — typescript 5.9 + @types/node, ESM module mode (the only errors in a naive run are the starter's own top-level await / import.meta under a CommonJS assumption; with `type: module` the whole tree is clean).
- **Smoke tests (manual, 6/6)**: unified rename → `R old.txt -> new.txt`, `ok: 1 file`; chained V4A moves a→b→c → `D a.txt` + `A c.txt`, no R; `--check` reports `M` without writing; stdin patch works; empty patch → `error: format` exit 2; bad flag → `error: usage` exit 2.
- Node 22.23.4 re-downloaded to /tmp/node-v22.23.4-linux-x64 (the earlier copy was wiped with /tmp); default node is v24.22.1.
- OPEN item 13 (V4A EOF chunk tier semantics) resolved as (B) — literal composition: first tier with any occurrence at/after cursor, then the taken occurrence must end at the file's last line. Both practice v-eof checks pass under (B); the hidden set may distinguish, but the SPEC text supports (B).

## Analysis done (practice.json, 100 checks — all read, key families dumped)

Findings that override or sharpen the SPEC text (practice checks are ground truth):

1. Empty patch → `error: format`, NOT `no-patch`. `no-patch` only when the named patch file is missing/unreadable (starter `run()` already does this; SPEC §2 text differs — trust starter + practice).
2. V4A: missing `*** End Patch` → `error: parse <number of patch lines + 1>`; first non-blank line not `*** Begin Patch` → parse at that line.
3. SEARCH/REPLACE: missing `=======` or `>>>>>>> REPLACE` → `error: parse <SEARCH line>`; no path line → parse at SEARCH line; path = nearest non-blank, non-fence (trim not starting with ```) line before SEARCH, after previous block's REPLACE.
4. Unified: `--- ` NOT followed by `+++ ` → not detected as unified (falls through to `error: format`); `@@` line without `-`/`+` numbers → parse at its line; `--- ` inside a section header without `+++ ` after → parse at the line after it.
5. Trailing body lines whose text is empty (raw `""` or `" "`) are stripped from hunk/chunk bodies (proven by v-cursor eeb74bea45e6 — the trailing `" "` context line must NOT be part of O, else no-match).
6. V4A chunk takes the FIRST occurrence of O at/after cursor; unified takes the NEAREST occurrence to A-1+d (ties → earlier); SR needs exactly 1 occurrence at the first tier with one, else ambiguous/no-match.
7. Re-indent (tier 2): P = leading whitespace of O's first line, F = leading whitespace of the file's first matched line; non-empty, non-whitespace-only N lines starting with P get P replaced by F; context lines are written as the file's own matched lines.
8. Final line break (unified): result ends WITH a break unless a `\` line follows the hunk's last context or `+` line; a created file ends with a break unless `\` follows its last `+` line; SR/V4A keep the file's original final-break state; created files use LF.
9. R lines: `R <old> -> <new>`, sorted by the NEW path (UTF-8 byte order). A move counts only when old existed before and not after, and new did not exist before and does after. Chained moves (a→b, b→c) yield NO R line — output is `D a` + `A c`.
10. `--strict` = tier 0 only (proven by c-strict 84c5ab28e668: trailing-space context lines → no-match under --strict).
11. No-op edit (old == new) → exit 0, `ok: 0 files`.
12. Detection order: v4a → json → search-replace → unified (starter `detect()`).
13. **OPEN — V4A end-of-file chunk tier semantics.** Two readings of "at the first tier with one; an end-of-file chunk takes only an occurrence that ends at the file's last line": (A) tier search considers only EOF-ending occurrences; (B) tier = first tier with any occurrence at/after cursor, then the taken occurrence must end at the last line. The two v-eof practice checks pass under both. Default to (B) (literal composition — §5 tier rule is referenced as-is, EOF is an extra filter); if a synthetic probe contradicts, flip to (A).

## Implementation plan (to do after user go-ahead)

Extend the starter `main.ts` (keep its §§1–4, 9, 10 code, `run()`, trial handoff, and `runner.ts`/`check.ts` untouched except as noted):

- Line model: split file at its own break (CRLF iff first `\n` follows `\r`), track final-break flag; empty file = no lines, no break.
- Tier matching (§5): `matchLines(fileLines, oLines, strict, from)` → first tier with ≥1 occurrence at/after `from`; returns positions. Re-indent per §5 for tier 2.
- Unified parser (§6): sections from `diff --git` / `--- `+`+++ ` pair; header lines (rename from/to, new/deleted file mode, index); hunk header regex `@@ -A[,B] +C[,D] @@`; body = lines starting with ` `, `-`, `+`, `\`, or empty, ending at first other line / `diff --git` / `--- `+`+++ `; strip trailing empty-text body lines. Apply per hunk with offset `d`; empty O inserts after A+d lines; `\` rule for final break; creation = all `+` lines, LF, final break per `\`; deletion = hunks not read.
- SEARCH/REPLACE parser (§7): blocks as in finding 3; each block = one edit; empty old = create (exists → exists error).
- V4A parser (§8): Begin/End Patch checks per finding 2; sections Add/Delete/Update (+ optional `*** Move to:` as first line of Update); chunks with `@@` anchor (single-line tier match at/after cursor, cursor moves past anchor) and `*** End of File` (EOF chunk); trailing empty lines at section end stripped.
- JSON: keep starter implementation (verified against §9).
- Moves: record successful move edits in a list; in `run()` output, replace the A/D pair with an `R` row when the before/after conditions hold; sort rows by path bytes (R rows by new path). Keep `--check` no-write behaviour.
- `strict` must be threaded into all three line-based parsers (JSON unaffected).

## Verification plan (after go-ahead)

- Node 22.23.4 at `/tmp/node-v22.23.4-linux-x64` (default node is v24.22.1; grader uses 22.23.4). Run `node check.ts ../program/generator/practice.json` from the work dir; iterate to 100/100.
- Determinism: run the checker twice, diff outputs.
- `tsc --strict` zero errors; `node main.ts` smoke tests (one real patch per format, incl. CRLF and no-EOL cases).
- Demo: add usage examples to README.md (four formats + --check/--strict); no screenshots required — deliverables per requirements API are only repo_url, commit_sha, bundle.
- Push: git add/commit/push to Mahgal/mend (PAT in `~/.git-credentials-mahgal`, never print); set topics + description via API; read back commit SHA.
- Transcript bundle must be run by the PARENT agent after completion (subagent cannot bundle its own session); `--redact` only user personal data (Borjigin Mahgal, Mahagala Boerzhijin, imahgal@gmail.com, admin@khaan.si, +1 9787565566) — never redact code/commands/reasoning.

## Resume checklist (for the next agent, after approval)

1. Copy `LICENSE` from kit `starter/` into the work dir.
2. Write the implementation into `main.ts` per the plan above.
3. `cd ~/workspace/makefun/hidden-spec-cli-01 && /tmp/node-v22.23.4-linux-x64/bin/node check.ts ../hidden-spec-cli-01-kit/hidden-spec-cli-01-run-20261122-kit/program/generator/practice.json` — iterate to 100/100; resolve OPEN item 13 with a synthetic probe if needed.
4. Determinism + tsc + smoke tests; update this BUILD.md with evidence.
5. Commit + push + topics; record final SHA; hand the parent repo URL, SHA, verification and self-check evidence.
