// `slicekit intake` (REQ-1.2, REQ-2.2): frozen snapshots of the source documents. A snapshot is
// written once, next to a sidecar that pins its bytes, and committed by the command (D-19).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { commitPaths, currentBranch, gitUser } from './git.js';
import { kitPaths } from './paths.js';

// `code` 1: refused (a protected branch, a failed fetch). `code` 2: bad input (no such file).
export class IntakeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntakeError';
    this.code = code;
  }
}

const FETCH_TIMEOUT_MS = 30_000;
const CONTENT_TYPES = {
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/html': 'html',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const EXT = /^[a-z0-9]{1,10}$/;

const posix = (p) => p.split(path.sep).join('/');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const isUrl = (source) => /^https?:\/\//i.test(source);

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

async function fetchSource(url, fetchImpl) {
  let res;
  let bytes;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new IntakeError(1, `could not fetch ${url}: ${e.cause?.message ?? e.message}`);
  }
  if (!res.ok) throw new IntakeError(1, `could not fetch ${url}: ${res.status}`);
  const base = urlBase(url);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return { bytes, base, ext: extOf(base) ?? CONTENT_TYPES[type] ?? 'bin', origin: url };
}

function readSource(root, source) {
  const abs = path.resolve(root, source);
  let bytes;
  try {
    bytes = fs.readFileSync(abs);
  } catch (e) {
    if (e.code === 'ENOENT') throw new IntakeError(2, `no such file ${source}`);
    if (e.code === 'EISDIR') throw new IntakeError(2, `not a file ${source}`);
    throw e;
  }
  const base = path.basename(abs);
  return { bytes, base, ext: extOf(base) ?? 'bin', origin: posix(abs) };
}

// Copies `source` (a file path, or an http(s) URL) into `<docsRoot>/intake/` as
// `<UTC date>-<slug>.<ext>` with a sidecar `<name>.meta.json` holding {origin, sha256, by, at}, and
// commits both. A snapshot is never overwritten: the same bytes under the same name are reported
// with `created: false`; other bytes take the next free `-2`, `-3`, ... name.
export async function snapshot(root, cfg, source, { slug, who, now = new Date(), fetchImpl = fetch } = {}) {
  const branch = currentBranch(root);
  if (branch === null || branch === cfg.defaultBranch || cfg.protectedBranches.includes(branch)) {
    throw new IntakeError(1, 'snapshot on a work branch; run slicekit branch spec <slug>');
  }
  const src = isUrl(source) ? await fetchSource(source, fetchImpl) : readSource(root, source);
  const digest = sha256(src.bytes);
  const name0 = slug ?? slugify(path.posix.basename(src.base, path.posix.extname(src.base)));
  const stem = `${now.toISOString().slice(0, 10)}-${name0}`;
  const dir = kitPaths(root, cfg).intake;

  for (let n = 1; ; n++) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}.${src.ext}`;
    const file = path.join(dir, name);
    const sidecar = `${file}.meta.json`;
    if (fs.existsSync(file)) {
      if (sha256(fs.readFileSync(file)) === digest) return { file, sidecar, created: false };
      continue;
    }
    if (fs.existsSync(sidecar)) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, src.bytes, { flag: 'wx' });
    const meta = { origin: src.origin, sha256: digest, by: who ?? gitUser(root) ?? 'unknown', at: now.toISOString() };
    fs.writeFileSync(sidecar, `${JSON.stringify(meta, null, 2)}\n`, { flag: 'wx' });
    commitPaths(root, [posix(path.relative(root, file)), posix(path.relative(root, sidecar))], `docs(intake): snapshot ${name}`);
    return { file, sidecar, created: true };
  }
}
