// A test of the evaluation set, found in its file by its name (REQ-3.3, REQ-3.15, D-102), and the
// frozen entries of a state file read as { file, name }.
//
// `findTest(text, name)` finds the one `test(...)` or `it(...)` call, at any depth, whose first argument
// is a string literal (single, double or backtick quotes, no substitution) equal to `name`. It returns
// { line, text }: the 1-based line the call starts on, and the text from `test`/`it` to the call's
// matching close parenthesis; null when no call has the name. Strings, template literals, comments
// and regular expression literals are skipped, so a parenthesis or a brace inside them does not count.
// A file the reader cannot parse (an unterminated string, comment or call), or a name given to two
// calls, throws a TestNameError: every caller treats it as "cannot judge".
//
// Only `node:` modules (D-04): none are needed.

export class TestNameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TestNameError';
  }
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;
// An escaped quote or backslash keeps a literal plain; any other escape does not.
const QUOTE_ESCAPE = /['"`\\]/;
// After one of these tokens a `/` starts a regular expression literal, not a division.
const REGEX_AFTER_PUNCT = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

// The tokens of `text` that matter here: identifiers, punctuation, and string literals (a template
// with no substitution counts as one). Each is { type, value, start, end, line }; a string's value is
// its raw content between the quotes, and `plain` is false when it holds an escape or a substitution.
function tokens(text) {
  const out = [];
  let i = 0;
  let line = 1;
  // Each open `{` in code, and each `${` of a template: a `}` closing a `${` resumes the template.
  const braces = [];
  const prevSignificant = () => out.at(-1);
  const regexAllowed = () => {
    const p = prevSignificant();
    if (!p) return true;
    if (p.type === 'punct') return REGEX_AFTER_PUNCT.has(p.value);
    if (p.type === 'ident') return REGEX_AFTER_WORD.has(p.value);
    return false;
  };
  const fail = (what, at) => {
    throw new TestNameError(`cannot read the test file: ${what} at line ${at}`);
  };

  // Reads a template literal from just after a backtick or a `}` closing a substitution. -> whether it
  // ended at a backtick (true) or at a `${` (false); adds a string token for the part read.
  const template = (start, startLine, fromBacktick) => {
    let plain = fromBacktick;
    let j = i;
    while (j < text.length) {
      const c = text[j];
      if (c === '\\') {
        if (!QUOTE_ESCAPE.test(text[j + 1] ?? '')) plain = false;
        if (text[j + 1] === '\n') line += 1;
        j += 2;
        continue;
      }
      if (c === '\n') line += 1;
      if (c === '`') {
        out.push({ type: 'string', value: text.slice(i, j), plain, start, end: j + 1, line: startLine });
        i = j + 1;
        return true;
      }
      if (c === '$' && text[j + 1] === '{') {
        out.push({ type: 'string', value: text.slice(i, j), plain: false, start, end: j + 2, line: startLine });
        i = j + 2;
        braces.push('template');
        return false;
      }
      j += 1;
    }
    return fail('an unterminated template literal', startLine);
  };

  while (i < text.length) {
    const c = text[i];
    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\uFEFF') {
      i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) fail('an unterminated comment', line);
      for (let k = i; k < close; k += 1) if (text[k] === '\n') line += 1;
      i = close + 2;
      continue;
    }
    if (c === '#' && i === 0 && text[1] === '!') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      const startLine = line;
      let plain = true;
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\n') fail('an unterminated string', startLine);
        if (text[j] === '\\') {
          if (!QUOTE_ESCAPE.test(text[j + 1] ?? '')) plain = false;
          if (text[j + 1] === '\n') line += 1;
          j += 2;
          continue;
        }
        j += 1;
      }
      if (j >= text.length) fail('an unterminated string', startLine);
      out.push({ type: 'string', value: text.slice(i + 1, j), plain, start, end: j + 1, line: startLine });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      const start = i;
      i += 1;
      template(start, line, true);
      continue;
    }
    if (c === '/' && regexAllowed()) {
      const startLine = line;
      let j = i + 1;
      let inClass = false;
      while (j < text.length) {
        const d = text[j];
        if (d === '\n') fail('an unterminated regular expression', startLine);
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j += 1;
      }
      if (j >= text.length) fail('an unterminated regular expression', startLine);
      j += 1;
      while (j < text.length && IDENT.test(text[j])) j += 1;
      out.push({ type: 'regex', value: text.slice(i, j), start: i, end: j, line: startLine });
      i = j;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < text.length && IDENT.test(text[j])) j += 1;
      out.push({ type: 'ident', value: text.slice(i, j), start: i, end: j, line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < text.length && /[0-9A-Za-z_.]/.test(text[j])) j += 1;
      out.push({ type: 'number', value: text.slice(i, j), start: i, end: j, line });
      i = j;
      continue;
    }
    if (c === '}' && braces.at(-1) === 'template') {
      braces.pop();
      const start = i;
      i += 1;
      template(start, line, false);
      continue;
    }
    if (c === '{') braces.push('code');
    if (c === '}') braces.pop();
    if (c === '=' && text[i + 1] === '>') {
      out.push({ type: 'punct', value: '=>', start: i, end: i + 2, line });
      i += 2;
      continue;
    }
    out.push({ type: 'punct', value: c, start: i, end: i + 1, line });
    i += 1;
  }
  return out;
}

// A literal's raw content with its quote and backslash escapes read; any other escape keeps its
// backslash, so a name with one never matches.
const unescape = (raw) => raw.replace(/\\(['"`\\])/g, '$1');

const OPEN = { '(': ')', '[': ']', '{': '}' };

// The index of the token closing the call whose `(` is at index `open`, or a TestNameError.
function closeOf(toks, open) {
  const stack = [];
  for (let k = open; k < toks.length; k += 1) {
    const t = toks[k];
    if (t.type !== 'punct') continue;
    if (OPEN[t.value]) stack.push(OPEN[t.value]);
    else if (t.value === ')' || t.value === ']' || t.value === '}') {
      if (stack.pop() !== t.value) throw new TestNameError(`cannot read the test file: an unbalanced ${t.value} at line ${t.line}`);
      if (stack.length === 0) return k;
    }
  }
  throw new TestNameError(`cannot read the test file: the call at line ${toks[open].line} is not closed`);
}

// Every `test(...)` or `it(...)` call named `name`: [{ line, text }].
function calls(text, name) {
  const toks = tokens(text);
  const found = [];
  for (let k = 0; k + 2 < toks.length; k += 1) {
    const t = toks[k];
    if (t.type !== 'ident' || (t.value !== 'test' && t.value !== 'it')) continue;
    const before = toks[k - 1];
    if (before && before.type === 'punct' && before.value === '.') continue;
    const open = toks[k + 1];
    const label = toks[k + 2];
    if (open.type !== 'punct' || open.value !== '(' || label.type !== 'string' || !label.plain) continue;
    if (unescape(label.value) !== name) continue;
    const end = closeOf(toks, k + 1);
    found.push({ line: t.line, text: text.slice(t.start, toks[end].end) });
  }
  return found;
}

export function findTest(text, name) {
  const found = calls(String(text).replace(/\r\n/g, '\n'), name);
  if (found.length > 1) {
    throw new TestNameError(`the test name "${name}" is given twice, at lines ${found.map((f) => f.line).join(' and ')}`);
  }
  return found[0] ?? null;
}

// ---- the evaluation set's rows and the state file's frozen entries ----

export const SEP = ' » ';

// One evaluation-set cell, `<file> » <name>` or a bare `<file>`: { row, file, name } (name null).
export function parseRow(cell) {
  const row = String(cell).replace(/^`|`$/g, '').trim();
  const at = row.indexOf(SEP);
  return {
    row,
    file: (at === -1 ? row : row.slice(0, at)).trim(),
    name: at === -1 ? null : row.slice(at + SEP.length).trim(),
  };
}

// The rows of a parsed slice file's evaluation set.
export const evaluationRows = (slice) => (slice?.evaluation ?? []).map(({ test }) => parseRow(test));

// A listed test path ends with a row's file: the row `hooks/a.test.js` names `test/hooks/a.test.js`.
export const endsWithFile = (t, file) => t === file || t.endsWith(`/${file}`);

// An entry as a state file stores it: a path string (a whole file, written before P8/S-60, or a file
// `build amend --test <file>` unfroze whole), or { file, name }.
export const isEntry = (e) =>
  (typeof e === 'string' && e !== '') ||
  (e !== null && typeof e === 'object' && !Array.isArray(e) && typeof e.file === 'string' && e.file !== '' && typeof e.name === 'string' && e.name !== '');

export const entryFile = (e) => (typeof e === 'string' ? e : e.file);
export const entryLabel = (e) => (typeof e === 'string' || e.name === null ? entryFile(e) : `${e.file}${SEP}${e.name}`);

// The frozen entries as [{ file, name }], `name` null for a whole file. A path string, the form of a
// state file written before P8/S-60, is read as every evaluation test of that file by name when
// `rows` (the slice file's evaluation set) names tests in it; else as the whole file. `same` compares
// two paths (case-folded on win32 by callers that need it).
export function frozenEntries(list, rows = [], same = (a, b) => a === b) {
  const out = [];
  const add = (e) => {
    if (!out.some((o) => same(o.file, e.file) && o.name === e.name)) out.push(e);
  };
  for (const e of list ?? []) {
    if (typeof e !== 'string') {
      add({ file: e.file, name: e.name });
      continue;
    }
    const named = rows.filter((r) => r.name !== null && endsWithFile(e, r.file));
    if (named.length === 0) add({ file: e, name: null });
    else for (const r of named) add({ file: e, name: r.name });
  }
  return out;
}

// Whether `unfrozen` lifts the freeze on entry { file, name }: it lists the file whole, or the same test.
export function isUnfrozen(entry, unfrozen, same = (a, b) => a === b) {
  return (unfrozen ?? []).some((u) => (typeof u === 'string' ? same(u, entry.file) : same(u.file, entry.file) && u.name === entry.name));
}
