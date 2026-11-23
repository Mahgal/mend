// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/** Move edits recorded while applying, for the `R` rows in run(). */
const moves: { old: string; new: string }[] = [];

const trimEndWS = (s: string): string => s.replace(/[ \t]+$/, '');
const trimWS = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const leadingWS = (s: string): string => {
  const m = /^[ \t]*/.exec(s);
  return m === null ? '' : m[0];
};

/** A file's lines, its line break and whether it ends with one (SPEC.md section 3). */
interface FileModel {
  lines: string[];
  br: '\r\n' | '\n';
  finalBreak: boolean;
}

function fileModel(text: string): FileModel {
  if (text === '') return { lines: [], br: '\n', finalBreak: false };
  const nl = text.indexOf('\n');
  const br: '\r\n' | '\n' = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const lines = text.split(br);
  let finalBreak = false;
  if (text.endsWith(br)) {
    lines.pop();
    finalBreak = true;
  }
  return { lines, br, finalBreak };
}

function renderModel(m: FileModel): string {
  if (m.lines.length === 0) return '';
  return m.lines.join(m.br) + (m.finalBreak ? m.br : '');
}

/** SPEC.md section 5: the first tier at which O occurs at least once at or after `from`. */
function matchLines(fileLines: string[], o: string[], strict: boolean, from: number): { tier: number; positions: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const positions: number[] = [];
    for (let i = Math.max(0, from); i + o.length <= fileLines.length; i++) {
      let ok = true;
      for (let j = 0; j < o.length; j++) {
        const a = o[j]!;
        const b = fileLines[i + j]!;
        if (tier === 0 ? a !== b : tier === 1 ? trimEndWS(a) !== trimEndWS(b) : trimWS(a) !== trimWS(b)) {
          ok = false;
          break;
        }
      }
      if (ok) positions.push(i);
    }
    if (positions.length > 0) return { tier, positions };
  }
  return null;
}

/** One line of N: `ctx` is its index in O when it is a context line, else null. */
interface NLine {
  text: string;
  ctx: number | null;
}

/** Resolve N against the matched lines: context lines are the file's own, tier 2 re-indents the rest. */
function resolveN(n: NLine[], fileLines: string[], pos: number, o: string[], tier: number): string[] {
  const p = leadingWS(o[0] ?? '');
  const f = leadingWS(fileLines[pos] ?? '');
  return n.map((e) => {
    if (e.ctx !== null) return fileLines[pos + e.ctx]!;
    if (tier === 2 && e.text !== '' && !/^[ \t]*$/.test(e.text) && e.text.startsWith(p)) return f + e.text.slice(p.length);
    return e.text;
  });
}

/** One body line of a unified hunk or a V4A chunk. */
interface BodyEntry {
  kind: 'ctx' | 'old' | 'new' | 'bs';
  text: string;
}

interface Hunk {
  a: number;
  o: string[];
  n: NLine[];
  noNLAfterLast: boolean;
  noNLAfterLastPlus: boolean;
}

/** Build O/N and the `\` flags from a hunk/chunk body's entries. */
function hunkFromEntries(entries: BodyEntry[], a: number): Hunk {
  const o: string[] = [];
  const n: NLine[] = [];
  for (const e of entries) {
    if (e.kind === 'ctx') {
      o.push(e.text);
      n.push({ text: e.text, ctx: o.length - 1 });
    } else if (e.kind === 'old') {
      o.push(e.text);
    } else if (e.kind === 'new') {
      n.push({ text: e.text, ctx: null });
    }
  }
  let lastCtxNew = -1;
  let lastNew = -1;
  for (let k = 0; k < entries.length; k++) {
    if (entries[k]!.kind === 'ctx' || entries[k]!.kind === 'new') lastCtxNew = k;
    if (entries[k]!.kind === 'new') lastNew = k;
  }
  return {
    a,
    o,
    n,
    noNLAfterLast: lastCtxNew >= 0 && entries[lastCtxNew + 1]?.kind === 'bs',
    noNLAfterLastPlus: lastNew >= 0 && entries[lastNew + 1]?.kind === 'bs',
  };
}

/** Parse a unified hunk's body starting at `i`; trailing empty-text context lines are not part of it. */
function parseHunkBody(lines: string[], i: number): { entries: BodyEntry[]; next: number } {
  const entries: BodyEntry[] = [];
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith('diff --git ')) break;
    if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) break;
    if (l === '') {
      entries.push({ kind: 'ctx', text: '' });
      i++;
      continue;
    }
    const c = l[0]!;
    if (c === ' ') {
      entries.push({ kind: 'ctx', text: l.slice(1) });
      i++;
      continue;
    }
    if (c === '-') {
      entries.push({ kind: 'old', text: l.slice(1) });
      i++;
      continue;
    }
    if (c === '+') {
      entries.push({ kind: 'new', text: l.slice(1) });
      i++;
      continue;
    }
    if (c === '\\') {
      entries.push({ kind: 'bs', text: l.slice(1) });
      i++;
      continue;
    }
    break;
  }
  while (entries.length > 0) {
    const last = entries[entries.length - 1]!;
    if (last.kind === 'ctx' && last.text === '') entries.pop();
    else break;
  }
  return { entries, next: i };
}

/** The path after a `--- `/`+++ ` header line: text after the four characters, up to the first tab, trimmed. */
function headerPath(line: string): string {
  const rest = line.slice(4);
  const tab = rest.indexOf('\t');
  return (tab >= 0 ? rest.slice(0, tab) : rest).trim();
}

/** Strip a leading `a/` or `b/`; `/dev/null` means no file. */
function stripAb(p: string): string | null {
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) return p.slice(2);
  return p;
}

interface UniSection {
  pairOld?: string | null;
  pairNew?: string | null;
  renameFrom?: string;
  renameTo?: string;
  diffOld?: string;
  diffNew?: string;
  creation: boolean;
  deletion: boolean;
  hunks: Hunk[];
}

interface ResolvedUni {
  oldPath: string | null;
  newPath: string | null;
  creation: boolean;
  deletion: boolean;
  hunks: Hunk[];
}

/** Resolve a unified section's paths: `---`/`+++` pair, else rename, else `diff --git`. */
function resolveUniSection(sec: UniSection): ResolvedUni | null {
  let oldPath: string | null;
  let newPath: string | null;
  if (sec.pairOld !== undefined || sec.pairNew !== undefined) {
    oldPath = sec.pairOld ?? null;
    newPath = sec.pairNew ?? null;
  } else if (sec.renameFrom !== undefined || sec.renameTo !== undefined) {
    oldPath = sec.renameFrom ?? null;
    newPath = sec.renameTo ?? null;
  } else {
    oldPath = sec.diffOld ?? null;
    newPath = sec.diffNew ?? null;
  }
  if (oldPath === null && newPath === null) return null;
  return { oldPath, newPath, creation: sec.creation, deletion: sec.deletion, hunks: sec.hunks };
}

/** Apply a section's hunks in order to a file's text (SPEC.md section 6). */
function applyHunks(text: string, hunks: Hunk[], strict: boolean, path: string): string {
  const model = fileModel(text);
  let d = 0;
  for (const h of hunks) {
    if (h.o.length === 0) {
      const insertAt = Math.max(0, Math.min(h.a + d, model.lines.length));
      const atEnd = insertAt === model.lines.length;
      const newLines = h.n.map((e) => e.text);
      model.lines.splice(insertAt, 0, ...newLines);
      if (atEnd) model.finalBreak = !h.noNLAfterLast;
      d += h.n.length;
      continue;
    }
    const m = matchLines(model.lines, h.o, strict, 0);
    if (m === null) throw new Fail('no-match', path);
    const target = h.a - 1 + d;
    let pos = m.positions[0]!;
    let best = Math.abs(pos - target);
    for (const p of m.positions) {
      const dd = Math.abs(p - target);
      if (dd < best) {
        best = dd;
        pos = p;
      }
    }
    const newLines = resolveN(h.n, model.lines, pos, h.o, m.tier);
    const atEnd = pos + h.o.length === model.lines.length;
    model.lines.splice(pos, h.o.length, ...newLines);
    if (atEnd) model.finalBreak = !h.noNLAfterLast;
    d += h.n.length - h.o.length;
  }
  return renderModel(model);
}

/** A creation's file: the `+` lines of all its hunks, in order (SPEC.md section 6). */
function buildCreation(hunks: Hunk[]): string {
  const plusLines: string[] = [];
  for (const h of hunks) {
    for (const e of h.n) {
      if (e.ctx === null) plusLines.push(e.text);
    }
  }
  if (plusLines.length === 0) return '';
  let finalBreak = true;
  for (let hi = hunks.length - 1; hi >= 0; hi--) {
    const h = hunks[hi]!;
    if (h.n.some((e) => e.ctx === null)) {
      finalBreak = !h.noNLAfterLastPlus;
      break;
    }
  }
  return plusLines.join('\n') + (finalBreak ? '\n' : '');
}

function uniSectionEdit(sec: ResolvedUni, strict: boolean): Edit {
  return (tree) => {
    if (sec.creation) {
      const np = sec.newPath ?? sec.oldPath;
      if (np === null) return;
      if (!safe(np)) throw new Fail('unsafe', np);
      if (tree.get(np) !== null) throw new Fail('exists', np);
      tree.now.set(np, buildCreation(sec.hunks));
      return;
    }
    if (sec.deletion) {
      const op = sec.oldPath ?? sec.newPath;
      if (op === null) return;
      if (!safe(op)) throw new Fail('unsafe', op);
      if (tree.get(op) === null) throw new Fail('missing', op);
      tree.now.set(op, null);
      return;
    }
    const op = sec.oldPath!;
    const np = sec.newPath!;
    if (op !== np) {
      if (!safe(op)) throw new Fail('unsafe', op);
      if (!safe(np)) throw new Fail('unsafe', np);
      const before = tree.get(op);
      if (before === null) throw new Fail('missing', op);
      if (tree.get(np) !== null) throw new Fail('exists', np);
      const result = applyHunks(before, sec.hunks, strict, op);
      tree.now.set(op, null);
      tree.now.set(np, result);
      moves.push({ old: op, new: np });
      return;
    }
    if (!safe(op)) throw new Fail('unsafe', op);
    const before = tree.get(op);
    if (before === null) throw new Fail('missing', op);
    tree.now.set(op, applyHunks(before, sec.hunks, strict, op));
  };
}

/** SPEC.md section 6: read a unified diff into one edit per section. */
function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  const sections: UniSection[] = [];
  let cur: UniSection | null = null;
  const finish = (): void => {
    if (cur !== null) sections.push(cur);
    cur = null;
  };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith('diff --git ')) {
      const m = /^diff --git a\/(\S+) b\/(\S+)[ \t]*$/.exec(l);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      finish();
      cur = { diffOld: m[1]!, diffNew: m[2]!, creation: false, deletion: false, hunks: [] };
      i++;
      continue;
    }
    if (l.startsWith('@@')) {
      if (cur === null) throw new Exit2(`error: parse ${i + 1}`);
      const hm = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
      if (hm === null) throw new Exit2(`error: parse ${i + 1}`);
      const body = parseHunkBody(lines, i + 1);
      cur.hunks.push(hunkFromEntries(body.entries, Number(hm[1])));
      i = body.next;
      continue;
    }
    if (cur === null) {
      if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
        cur = { creation: false, deletion: false, hunks: [] };
        cur.pairOld = stripAb(headerPath(l));
        cur.pairNew = stripAb(headerPath(lines[i + 1]!));
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (cur.hunks.length === 0) {
      if (l.startsWith('--- ')) {
        if ((lines[i + 1] ?? '').startsWith('+++ ')) {
          if (cur.pairOld !== undefined || cur.pairNew !== undefined) {
            finish();
            cur = { creation: false, deletion: false, hunks: [] };
          }
          cur.pairOld = stripAb(headerPath(l));
          cur.pairNew = stripAb(headerPath(lines[i + 1]!));
          i += 2;
          continue;
        }
        throw new Exit2(`error: parse ${i + 2}`);
      }
      if (l.startsWith('rename from ')) {
        cur.renameFrom = l.slice('rename from '.length).trim();
        i++;
        continue;
      }
      if (l.startsWith('rename to ')) {
        cur.renameTo = l.slice('rename to '.length).trim();
        i++;
        continue;
      }
      if (l === 'new file mode' || l.startsWith('new file mode ')) {
        cur.creation = true;
        i++;
        continue;
      }
      if (l === 'deleted file mode' || l.startsWith('deleted file mode ')) {
        cur.deletion = true;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      finish();
      cur = { creation: false, deletion: false, hunks: [] };
      cur.pairOld = stripAb(headerPath(l));
      cur.pairNew = stripAb(headerPath(lines[i + 1]!));
      i += 2;
      continue;
    }
    i++;
  }
  finish();
  const edits: Edit[] = [];
  for (const sec of sections) {
    const resolved = resolveUniSection(sec);
    if (resolved === null) continue;
    edits.push(uniSectionEdit(resolved, strict));
  }
  return edits;
}

interface SRBlock {
  path: string;
  old: string[];
  nw: string[];
}

function srBlockEdit(b: SRBlock, strict: boolean): Edit {
  return (tree) => {
    if (!safe(b.path)) throw new Fail('unsafe', b.path);
    if (b.old.length === 0) {
      if (tree.get(b.path) !== null) throw new Fail('exists', b.path);
      tree.now.set(b.path, b.nw.length === 0 ? '' : b.nw.join('\n') + '\n');
      return;
    }
    const before = tree.get(b.path);
    if (before === null) throw new Fail('missing', b.path);
    const model = fileModel(before);
    const m = matchLines(model.lines, b.old, strict, 0);
    if (m === null) throw new Fail('no-match', b.path);
    if (m.positions.length > 1) throw new Fail('ambiguous', b.path);
    const pos = m.positions[0]!;
    const newLines = resolveN(
      b.nw.map((t) => ({ text: t, ctx: null })),
      model.lines,
      pos,
      b.old,
      m.tier,
    );
    model.lines.splice(pos, b.old.length, ...newLines);
    tree.now.set(b.path, renderModel(model));
  };
}

/** SPEC.md section 7: read SEARCH/REPLACE blocks into one edit per block. */
function searchReplaceEdits(lines: string[], strict: boolean): Edit[] {
  const blocks: SRBlock[] = [];
  let prevReplace = -1;
  let prevPath: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') continue;
    const searchIdx = i;
    let path: string | null = null;
    for (let j = searchIdx - 1; j > prevReplace; j--) {
      const l = lines[j]!;
      if (blank(l)) continue;
      if (l.trim().startsWith('```')) continue;
      path = l.trim();
      break;
    }
    if (path === null) {
      if (prevPath === null) throw new Exit2(`error: parse ${searchIdx + 1}`);
      path = prevPath;
    }
    let eqIdx = -1;
    for (let j = searchIdx + 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === '=======') {
        eqIdx = j;
        break;
      }
      if (lines[j]!.trimEnd() === '<<<<<<< SEARCH') break;
    }
    if (eqIdx === -1) throw new Exit2(`error: parse ${searchIdx + 1}`);
    let repIdx = -1;
    for (let j = eqIdx + 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === '>>>>>>> REPLACE') {
        repIdx = j;
        break;
      }
      if (lines[j]!.trimEnd() === '<<<<<<< SEARCH') break;
    }
    if (repIdx === -1) throw new Exit2(`error: parse ${searchIdx + 1}`);
    blocks.push({ path, old: lines.slice(searchIdx + 1, eqIdx), nw: lines.slice(eqIdx + 1, repIdx) });
    prevPath = path;
    prevReplace = repIdx;
    i = repIdx;
  }
  return blocks.map((b) => srBlockEdit(b, strict));
}

interface V4AChunk {
  anchor: string | null;
  eof: boolean;
  o: string[];
  n: NLine[];
}

interface V4ASection {
  kind: 'add' | 'delete' | 'update';
  path: string;
  lines?: string[];
  moveTo?: string | null;
  chunks?: V4AChunk[];
  updateLine: number;
}

/** Parse a V4A chunk's body starting at `i`; stops at `*** End of File`, a new section, `@@` or End Patch. */
function parseV4aChunkBody(lines: string[], i: number, last: number): { o: string[]; n: NLine[]; eof: boolean; next: number } {
  const entries: BodyEntry[] = [];
  let eof = false;
  while (i < last) {
    const l = lines[i]!;
    if (l.trim() === '*** End Patch') break;
    if (l.startsWith('*** Add File: ') || l.startsWith('*** Delete File: ') || l.startsWith('*** Update File: ')) break;
    if (l.trim() === '*** End of File') {
      eof = true;
      i++;
      break;
    }
    if (l.startsWith('@@')) break;
    if (l === '') {
      entries.push({ kind: 'ctx', text: '' });
      i++;
      continue;
    }
    const c = l[0]!;
    if (c === ' ') {
      entries.push({ kind: 'ctx', text: l.slice(1) });
      i++;
      continue;
    }
    if (c === '-') {
      entries.push({ kind: 'old', text: l.slice(1) });
      i++;
      continue;
    }
    if (c === '+') {
      entries.push({ kind: 'new', text: l.slice(1) });
      i++;
      continue;
    }
    break;
  }
  while (entries.length > 0) {
    const lt = entries[entries.length - 1]!;
    if (lt.kind === 'ctx' && lt.text === '') entries.pop();
    else break;
  }
  const o: string[] = [];
  const n: NLine[] = [];
  for (const e of entries) {
    if (e.kind === 'ctx') {
      o.push(e.text);
      n.push({ text: e.text, ctx: o.length - 1 });
    } else if (e.kind === 'old') {
      o.push(e.text);
    } else if (e.kind === 'new') {
      n.push({ text: e.text, ctx: null });
    }
  }
  return { o, n, eof, next: i };
}

/** Apply V4A chunks in order with the cursor (SPEC.md section 8). */
function applyV4aChunks(text: string, chunks: V4AChunk[], strict: boolean, path: string): string {
  const model = fileModel(text);
  let cursor = 0;
  for (const ch of chunks) {
    if (ch.anchor !== null) {
      const am = matchLines(model.lines, [ch.anchor], strict, cursor);
      if (am === null) throw new Fail('no-match', path);
      cursor = am.positions[0]! + 1;
    }
    if (ch.o.length === 0) {
      const insertAt = ch.eof ? model.lines.length : cursor;
      const newLines = ch.n.map((e) => e.text);
      model.lines.splice(insertAt, 0, ...newLines);
      cursor = insertAt + newLines.length;
      continue;
    }
    const m = matchLines(model.lines, ch.o, strict, cursor);
    if (m === null) throw new Fail('no-match', path);
    const pos = m.positions[0]!;
    if (ch.eof && pos + ch.o.length !== model.lines.length) throw new Fail('no-match', path);
    const newLines = resolveN(ch.n, model.lines, pos, ch.o, m.tier);
    model.lines.splice(pos, ch.o.length, ...newLines);
    cursor = pos + newLines.length;
  }
  return renderModel(model);
}

function v4aSectionEdit(sec: V4ASection, strict: boolean): Edit {
  return (tree) => {
    if (sec.kind === 'add') {
      if (!safe(sec.path)) throw new Fail('unsafe', sec.path);
      if (tree.get(sec.path) !== null) throw new Fail('exists', sec.path);
      const ls = sec.lines ?? [];
      tree.now.set(sec.path, ls.length === 0 ? '' : ls.join('\n') + '\n');
      return;
    }
    if (sec.kind === 'delete') {
      if (!safe(sec.path)) throw new Fail('unsafe', sec.path);
      if (tree.get(sec.path) === null) throw new Fail('missing', sec.path);
      tree.now.set(sec.path, null);
      return;
    }
    if (!safe(sec.path)) throw new Fail('unsafe', sec.path);
    const np = sec.moveTo ?? null;
    if (np !== null && !safe(np)) throw new Fail('unsafe', np);
    const before = tree.get(sec.path);
    if (before === null) throw new Fail('missing', sec.path);
    if (np !== null && tree.get(np) !== null) throw new Fail('exists', np);
    const result = applyV4aChunks(before, sec.chunks ?? [], strict, sec.path);
    if (np !== null) {
      tree.now.set(sec.path, null);
      tree.now.set(np, result);
      moves.push({ old: sec.path, new: np });
    } else {
      tree.now.set(sec.path, result);
    }
  };
}

/** SPEC.md section 8: read a V4A patch into one edit per section. */
function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = -1;
  for (let k = lines.length - 1; k >= 0; k--) {
    if (!blank(lines[k]!)) {
      last = k;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const sections: V4ASection[] = [];
  let i = first + 1;
  while (i < last) {
    const l = lines[i]!;
    if (blank(l)) {
      i++;
      continue;
    }
    if (l.trim() === '*** End Patch') break;
    if (l.startsWith('*** Add File: ')) {
      const path = l.slice('*** Add File: '.length).trim();
      let end = i + 1;
      while (end < last) {
        const m = lines[end]!;
        if (m.startsWith('*** Add File: ') || m.startsWith('*** Delete File: ') || m.startsWith('*** Update File: ') || m.trim() === '*** End Patch') break;
        end++;
      }
      let lastContent = i;
      for (let k = i + 1; k < end; k++) {
        if (!blank(lines[k]!)) lastContent = k;
      }
      const secLines: string[] = [];
      for (let k = i + 1; k <= lastContent; k++) {
        const m = lines[k]!;
        if (m === '') {
          secLines.push('');
          continue;
        }
        if (m.startsWith('+')) {
          secLines.push(m.slice(1));
          continue;
        }
        throw new Exit2(`error: parse ${k + 1}`);
      }
      sections.push({ kind: 'add', path, lines: secLines, updateLine: 0 });
      i = end;
      continue;
    }
    if (l.startsWith('*** Delete File: ')) {
      const path = l.slice('*** Delete File: '.length).trim();
      sections.push({ kind: 'delete', path, updateLine: 0 });
      i++;
      continue;
    }
    if (l.startsWith('*** Update File: ')) {
      const path = l.slice('*** Update File: '.length).trim();
      const updateLine = i + 1;
      i++;
      let moveTo: string | null = null;
      if (i < last && lines[i]!.startsWith('*** Move to: ')) {
        moveTo = lines[i]!.slice('*** Move to: '.length).trim();
        i++;
      }
      const chunks: V4AChunk[] = [];
      while (i < last) {
        const m = lines[i]!;
        if (m.trim() === '*** End Patch') break;
        if (m.startsWith('*** Add File: ') || m.startsWith('*** Delete File: ') || m.startsWith('*** Update File: ')) break;
        if (m.startsWith('@@')) {
          const anchorText = m.slice(2).trim();
          i++;
          const r = parseV4aChunkBody(lines, i, last);
          chunks.push({ anchor: anchorText === '' ? null : anchorText, eof: r.eof, o: r.o, n: r.n });
          i = r.next;
          continue;
        }
        if (m.startsWith('*** End of File')) throw new Exit2(`error: parse ${i + 1}`);
        if (blank(m)) {
          if (chunks.length === 0) {
            const r = parseV4aChunkBody(lines, i, last);
            chunks.push({ anchor: null, eof: r.eof, o: r.o, n: r.n });
            i = r.next;
            continue;
          }
          i++;
          continue;
        }
        if (chunks.length === 0 && (m.startsWith(' ') || m.startsWith('-') || m.startsWith('+'))) {
          const r = parseV4aChunkBody(lines, i, last);
          chunks.push({ anchor: null, eof: r.eof, o: r.o, n: r.n });
          i = r.next;
          continue;
        }
        throw new Exit2(`error: parse ${i + 1}`);
      }
      if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${updateLine}`);
      sections.push({ kind: 'update', path, moveTo, chunks, updateLine });
      continue;
    }
    throw new Exit2(`error: parse ${i + 1}`);
  }
  return sections.map((s) => v4aSectionEdit(s, strict));
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  moves.length = 0;
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = unifiedEdits(lines, strict);
    else if (kind === 'search-replace') edits = searchReplaceEdits(lines, strict);
    else if (kind === 'v4a') edits = v4aEdits(lines, strict);
    else edits = [];
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const changed: string[] = [];
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    changed.push(p);
    if (check) continue;
    if (now === null) rmSync(p, { force: true });
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, now);
    }
  }
  const items: { key: string; text: string }[] = [];
  const rDone = new Set<string>();
  for (const mv of moves) {
    const wasOld = tree.original(mv.old);
    const wasNew = tree.original(mv.new);
    const nowOld = tree.now.get(mv.old);
    const nowNew = tree.now.get(mv.new);
    if (wasOld !== null && wasNew === null && nowOld === null && nowNew !== null) {
      items.push({ key: mv.new, text: `R ${mv.old} -> ${mv.new}` });
      rDone.add(mv.old);
      rDone.add(mv.new);
    }
  }
  for (const p of changed) {
    if (rDone.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    items.push({ key: p, text: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  items.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const rows = items.map((x) => x.text);
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
