import { extractManaged } from './managed.js';

// html and hash files keep the team's own text around the managed block, so only the block counts.
// frontmatter and json files are managed whole.
const BLOCK_STYLES = new Set(['html', 'hash']);

export function managedPart(text, style) {
  if (!BLOCK_STYLES.has(style)) return text;
  return extractManaged(text, style)?.block ?? null;
}

// 'missing' no file, 'unmanaged' a file with no slicekit marker, 'drifted' differs from the
// reference copy slicekit wrote, 'same' otherwise (including when there is no reference to judge by).
export function compareManaged({ current, reference, style }) {
  if (current === null || current === undefined) return 'missing';
  if (!extractManaged(current, style)) return 'unmanaged';
  if (reference === null || reference === undefined) return 'same';
  const was = managedPart(reference, style);
  if (was === null) return 'same';
  return managedPart(current, style) === was ? 'same' : 'drifted';
}
