// `slicekit intake` (REQ-1.2, REQ-2.2): frozen snapshots of the source documents. A snapshot is
// written once, next to a sidecar that pins its bytes, and committed by the command (D-19).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GitError, commitPaths, currentBranch, git, gitUser } from './git.js';
import { kitPaths } from './paths.js';

// `code` 1: refused (a protected branch, a failed fetch, a text rule on the target). `code` 2: bad
// input (no such file, a bad slug, a URL with a password, a source over the size cap).
export class IntakeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntakeError';
    this.code = code;
  }
}

const FETCH_TIMEOUT_MS = 30_000;
export const MAX_BYTES = 50 * 1024 * 1024;
const CONTENT_TYPES = {
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/html': 'html',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const EXT = /^[a-z0-9]{1,10}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const SECRET_PARAMS = new Set(['token', 'key', 'sig', 'signature', 'auth', 'password', 'secret', 'access_token', 'code']);

const posix = (p) => p.split(path.sep).join('/');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const isUrl = (source) => /^https?:\/\//i.test(source);
const tooBig = (what) => new IntakeError(2, `${what} is larger than ${MAX_BYTES / 1024 / 1024} MB`);

// Lower-cased, each run of characters other than a-z0-9 one dash, dashes trimmed, at most 60
// characters; `source` when nothing is left.
export function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug === '' ? 'source' : slug;
}

const secretParam = (name) => {
  const n = name.toLowerCase();
  return SECRET_PARAMS.has(n) || n.startsWith('x-amz-');
};

// `a=1&token=x` with each secret value replaced by `***`; the other pairs are kept as written.
function maskPairs(text) {
  if (!text.includes('=')) return text;
  return text
    .split('&')
    .map((pair) => {
      const i = pair.indexOf('=');
      if (i < 0) return pair;
      const key = pair.slice(0, i);
      let name = key;
      try {
        name = decodeURIComponent(key.replace(/\+/g, ' '));
      } catch {
        // A malformed escape: judge the name as written.
      }
      return secretParam(name) ? `${key}=***` : pair;
    })
    .join('&');
}

// The form of a URL that may be written down: no user name or password, and the value of each
// query (or fragment) parameter that names a secret replaced by `***`.
export function maskUrl(url) {
  const u = new URL(url);
  u.username = '';
  u.password = '';
  if (u.search) u.search = maskPairs(u.search.slice(1));
  if (u.hash) u.hash = maskPairs(u.hash.slice(1));
  return u.href;
}

// A base name's extension, lower-cased, or null when it has none fit for a file name.
function extOf(base) {
  const ext = path.posix.extname(base).slice(1).toLowerCase();
  return EXT.test(ext) ? ext : null;
}

function urlBase(url) {
  const { pathname } = new URL(url);
  try {
    return path.posix.basename(decodeURIComponent(pathname));
  } catch {
    return path.posix.basename(pathname);
  }
}

async function readCapped(res, shown) {
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw tooBig(shown);
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > MAX_BYTES) throw tooBig(shown);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchSource(source, fetchImpl) {
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new IntakeError(2, 'the source is not a valid URL');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new IntakeError(2, 'the URL carries a user name or password; remove it');
  }
  const shown = maskUrl(source);
  let res;
  let bytes;
  try {
    res = await fetchImpl(parsed.href, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (res.ok) bytes = await readCapped(res, shown);
  } catch (e) {
    if (e instanceof IntakeError) throw e;
    const reason = String(e.cause?.message ?? e.message).split(source).join(shown).split(parsed.href).join(shown);
    throw new IntakeError(1, `could not fetch ${shown}: ${reason}`);
  }
  if (!res.ok) throw new IntakeError(1, `could not fetch ${shown}: ${res.status}`);
  const final = typeof res.url === 'string' && res.url !== '' && res.url !== parsed.href ? res.url : null;
  const base = urlBase(final ?? parsed.href);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return {
    bytes,
    base,
    ext: extOf(base) ?? CONTENT_TYPES[type] ?? 'bin',
    origin: { origin: shown, ...(final ? { finalUrl: maskUrl(final) } : {}) },
  };
}

function readSource(root, source) {
  const abs = path.resolve(root, source);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw new IntakeError(2, `no such file ${source}`);
    throw e;
  }
  if (!stat.isFile()) throw new IntakeError(2, `not a file ${source}`);
  if (stat.size > MAX_BYTES) throw tooBig(source);
  const base = path.basename(abs);
  return { bytes: fs.readFileSync(abs), base, ext: extOf(base) ?? 'bin', origin: { origin: posix(abs) } };
}

// The `.gitattributes` rule that keeps every intake file byte for byte in every clone: without it a
// `text=auto` or `core.autocrlf` setting rewrites line endings and the sidecar's SHA-256 stops
// matching. `init` writes its own rules; this one is written here, when a snapshot is taken.
const squash = (line) => line.trim().replace(/\s+/g, ' ');
const holdsRule = (text, rule) => text.split(/\r?\n/).some((l) => squash(l) === rule || squash(l) === `/${rule}`);

// Appends `rule` when the file lacks it; returns the function that puts the file back.
function ensureAttribute(file, rule) {
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (before !== null && holdsRule(before, rule)) return () => {};
  const eol = before?.includes('\r\n') ? '\r\n' : '\n';
  const sep = before === null || before === '' || before.endsWith('\n') ? '' : eol;
  fs.writeFileSync(file, `${before ?? ''}${sep}${rule}${eol}`);
  return () => (before === null ? fs.rmSync(file, { force: true }) : fs.writeFileSync(file, before));
}

function committedHoldsRule(root, rule) {
  try {
    return holdsRule(git(root, ['show', 'HEAD:./.gitattributes']), rule);
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

function textAttribute(root, rel) {
  const out = git(root, ['--literal-pathspecs', 'check-attr', 'text', '--', rel]);
  return out.slice(out.lastIndexOf(': ') + 2);
}

// Copies `source` (a file path, or an http(s) URL) into `<docsRoot>/intake/` as
// `<UTC date>-<slug>.<ext>` with a sidecar `<name>.meta.json` holding {origin, [finalUrl,] sha256,
// by, at}, and commits both. A snapshot is never overwritten: the same bytes under the same name are
// reported with `created: false` (and committed, when an earlier commit was refused); other bytes
// take the next free `-2`, `-3`, ... name.
export async function snapshot(root, cfg, source, { slug, who, now = new Date(), fetchImpl = fetch } = {}) {
  if (slug !== undefined && !SLUG.test(slug)) {
    throw new IntakeError(2, `slug '${slug}' must be lowercase letters, digits and dashes, at most 60, not starting with a dash`);
  }
  const branch = currentBranch(root);
  if (branch === null || branch === cfg.defaultBranch || cfg.protectedBranches.includes(branch)) {
    throw new IntakeError(1, 'snapshot on a work branch; run slicekit branch spec <slug>');
  }
  const dir = kitPaths(root, cfg).intake;
  const rule = `${posix(path.relative(root, dir))}/** -text`;
  // The snapshot commit carries .gitattributes when it adds the rule: a person's other edits to it
  // must not ride along.
  const attributes = path.join(root, '.gitattributes');
  const current = fs.existsSync(attributes) ? fs.readFileSync(attributes, 'utf8') : null;
  if (!(current !== null && holdsRule(current, rule)) && git(root, ['status', '--porcelain', '--', '.gitattributes']) !== '') {
    throw new IntakeError(1, '.gitattributes has uncommitted changes; commit or stash them first');
  }
  const src = isUrl(source) ? await fetchSource(source, fetchImpl) : readSource(root, source);
  const digest = sha256(src.bytes);
  const stem = `${now.toISOString().slice(0, 10)}-${slug ?? slugify(path.posix.basename(src.base, path.posix.extname(src.base)))}`;

  let name;
  let created = true;
  for (let n = 1; ; n++) {
    name = `${stem}${n === 1 ? '' : `-${n}`}.${src.ext}`;
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) {
      if (sha256(fs.readFileSync(candidate)) !== digest) continue;
      created = false;
      break;
    }
    if (!fs.existsSync(`${candidate}.meta.json`)) break;
  }
  const file = path.join(dir, name);
  const sidecar = `${file}.meta.json`;
  const fileRel = posix(path.relative(root, file));
  const sidecarRel = posix(path.relative(root, sidecar));

  const restore = ensureAttribute(attributes, rule);
  const text = textAttribute(root, fileRel);
  if (text !== 'unset') {
    restore();
    throw new IntakeError(1, `${fileRel} would not be stored byte for byte: git check-attr text gives '${text}'; a .gitattributes rule overrides '${rule}'`);
  }

  if (created) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, src.bytes, { flag: 'wx' });
    const meta = { ...src.origin, sha256: digest, by: who || gitUser(root) || 'unknown', at: now.toISOString() };
    fs.writeFileSync(sidecar, `${JSON.stringify(meta, null, 2)}\n`, { flag: 'wx' });
  }
  const paths = [fileRel, sidecarRel, ...(committedHoldsRule(root, rule) ? [] : ['.gitattributes'])];
  commitPaths(root, paths, `docs(intake): snapshot ${name}`);
  return { file, sidecar, created };
}
