import { extractManaged } from './managed.js';

// html and hash files keep the team's own text around the managed block, so only the block counts.
// frontmatter and json files are managed whole.
const BLOCK_STYLES = new Set(['html', 'hash']);

export function managedPart(text, style) {
  if (!BLOCK_STYLES.has(style)) return text;
  return extractManaged(text, style)?.block ?? null;
}

// 'missing' no file, 'unmanaged' a file with no slicekit marker, 'drifted' differs from what slicekit
// wrote (the reference copy, or with none the fresh render: an unprovable edit is kept, never overwritten),
// 'same' otherwise. With neither a reference nor a fresh render there is nothing to judge by: 'same'.
export function compareManaged({ current, reference, fresh, style }) {
  if (current === null || current === undefined) return 'missing';
  if (!extractManaged(current, style)) return 'unmanaged';
  const basis = reference ?? fresh;
  if (basis === null || basis === undefined) return 'same';
  const was = managedPart(basis, style);
  if (was === null) return 'same';
  return managedPart(current, style) === was ? 'same' : 'drifted';
}
