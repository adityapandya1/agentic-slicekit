const MARKERS = {
  html: {
    start: (v) => `<!-- slicekit:managed:start v${v} -->`,
    end: '<!-- slicekit:managed:end -->',
    startRe: /^<!-- slicekit:managed:start v(.*?) -->\r?$/,
    endRe: /^<!-- slicekit:managed:end -->\r?$/,
  },
  hash: {
    start: (v) => `# slicekit:managed:start v${v}`,
    end: '# slicekit:managed:end',
    startRe: /^# slicekit:managed:start v(.*?)\r?$/,
    endRe: /^# slicekit:managed:end\r?$/,
  },
};

const KEY = 'slicekit-managed';
const KEY_RE = /^slicekit-managed:\s*v(.*?)\s*$/;

const bare = (line) => line.replace(/\r$/, '');

// A file whose first line is --- keeps it there: the version rides inside the front matter.
function frontmatterEnd(lines) {
  return bare(lines[0]) === '---' ? lines.findIndex((l, i) => i > 0 && bare(l) === '---') : -1;
}

export function markerStyle(path, content) {
  const base = String(path).split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (ext === 'md' && typeof content === 'string' && /^---\r?\n/.test(content)) return 'frontmatter';
  if (ext === 'md' || ext === 'html') return 'html';
  if (ext === 'json') return 'json';
  return 'hash';
}

function markersFor(style) {
  const m = MARKERS[style];
  if (!m) throw new Error(`unknown managed style: ${style}`);
  return m;
}

function oneNewline(s) {
  return s.replace(/\n+$/, '') + '\n';
}

function jsonWith(content, version) {
  const obj = JSON.parse(content);
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) throw new Error('managed json must be an object');
  obj._slicekit = { managed: true, version };
  return JSON.stringify(obj, null, 2) + '\n';
}

function frontmatterWith(content, version) {
  const lines = content.split('\n');
  const end = frontmatterEnd(lines);
  if (end < 0) throw new Error('managed frontmatter: no front matter block');
  const cr = lines[0].endsWith('\r') ? '\r' : '';
  const kept = lines.slice(1, end).filter((l) => !KEY_RE.test(bare(l)));
  return [lines[0], ...kept, `${KEY}: v${version}${cr}`, ...lines.slice(end)].join('\n');
}

export function wrapManaged(content, { version, style }) {
  if (style === 'frontmatter') return frontmatterWith(content, version);
  if (style === 'json') return jsonWith(content, version);
  const m = markersFor(style);
  return `${m.start(version)}\n${oneNewline(content)}${m.end}\n`;
}

export function extractManaged(text, style) {
  if (style === 'frontmatter') {
    const lines = text.split('\n');
    const end = frontmatterEnd(lines);
    if (end < 0) return null;
    for (const l of lines.slice(1, end)) {
      const hit = KEY_RE.exec(bare(l));
      if (hit) return { before: '', block: text, after: '', version: hit[1] };
    }
    return null;
  }
  if (style === 'json') {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return null;
    }
    const meta = obj && typeof obj === 'object' ? obj._slicekit : null;
    if (!meta || meta.managed !== true) return null;
    return { before: '', block: text, after: '', version: meta.version };
  }
  const m = markersFor(style);
  let offset = 0;
  let startEnd = -1;
  let endStart = -1;
  let version = null;
  for (const line of text.split('\n')) {
    const next = offset + line.length + 1;
    if (startEnd < 0) {
      const hit = m.startRe.exec(line);
      if (hit) {
        startEnd = Math.min(next, text.length);
        version = hit[1];
      }
    } else if (m.endRe.test(line)) {
      endStart = offset;
      break;
    }
    offset = next;
  }
  if (startEnd < 0 || endStart < 0) return null;
  return {
    before: text.slice(0, startEnd),
    block: text.slice(startEnd, endStart),
    after: text.slice(endStart),
    version,
  };
}

export function replaceManaged(text, newBlock, { version, style }) {
  const got = extractManaged(text, style);
  if (!got) throw new Error('no managed block found');
  if (style === 'json' || style === 'frontmatter') return wrapManaged(newBlock, { version, style });
  const m = markersFor(style);
  const nl = got.before.endsWith('\r\n') ? '\r\n' : '\n';
  const lineStart = got.before.lastIndexOf('\n', got.before.length - 2) + 1;
  const before = got.before.slice(0, lineStart) + m.start(version) + nl;
  return before + oneNewline(newBlock) + got.after;
}
