// Masks secrets in a line of text with ***, so a command line can be stored in a committed file (the
// pre-compact handoff; later the journal). It masks known shapes only and is not a guarantee: a
// secret in an unknown shape passes through. Apply it before any cut, so a secret straddling the cut
// is masked whole.
const MASK = '***';

const RULES = [
  // URL credentials: ://user:pass@ -> ://***@
  [/:\/\/[^\s/@:]+:[^\s/@]+@/g, `://${MASK}@`],
  // Token shapes.
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, MASK],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  [/\bxox[abpr]-[A-Za-z0-9-]+/g, MASK],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, MASK],
  // Authorization schemes.
  [/\b(Bearer|Basic)\s+[^\s'"]+/gi, `$1 ${MASK}`],
  // key=value.
  [/\b(token|password|passwd|secret|api[_-]?key)=[^\s&'"]+/gi, `$1=${MASK}`],
  // --flag=value and --flag value.
  [/(--(?:password|token|secret))(=|\s+)[^\s'"]+/gi, `$1$2${MASK}`],
  // -p<value> / -p <value> for the MySQL clients only (psql -p and mysql -P are ports). Case-sensitive.
  [/(\b(?:mysql|mysqldump|mariadb)\b[^;&|\n]*?\s-p)(\s+[^\s'"]+|[^\s'"]+)/g,
    (_m, head, value) => `${head}${/^\s/.test(value) ? `${value.match(/^\s+/)[0]}${MASK}` : MASK}`],
];

export function redact(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  for (const [re, by] of RULES) out = out.replace(re, by);
  return out;
}
