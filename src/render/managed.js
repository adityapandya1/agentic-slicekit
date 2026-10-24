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

export function markerStyle(path) {
  const base = String(path).split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (ext === 'md' || ext === 'html') return 'html';
  if (ext === 'json') return 'json';
  return 'hash';
}

function oneNewline(s) {
  return s.replace(/\n+$/, '') + '\n';
}

function jsonWith(content, version) {
  const obj = JSON.parse(content);
  obj._slicekit = { managed: true, version };
  return JSON.stringify(obj, null, 2) + '\n';
}

export function wrapManaged(content, { version, style }) {
  if (style === 'json') return jsonWith(content, version);
  const m = MARKERS[style];
  return `${m.start(version)}\n${oneNewline(content)}${m.end}\n`;
}

export function extractManaged(text, style) {
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
  const m = MARKERS[style];
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
  if (style === 'json') return wrapManaged(newBlock, { version, style });
  const m = MARKERS[style];
  const nl = got.before.endsWith('\r\n') ? '\r\n' : '\n';
  const lineStart = got.before.lastIndexOf('\n', got.before.length - 2) + 1;
  const before = got.before.slice(0, lineStart) + m.start(version) + nl;
  return before + oneNewline(newBlock) + got.after;
}
