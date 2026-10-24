import fs from 'node:fs';
import path from 'node:path';

const pad = (n) => String(n).padStart(2, '0');

// Writes a minimal valid slice file; returns its id.
export function writeSliceFixture(root, { phase = 1, n = 1, docsRoot = 'docs' } = {}) {
  const id = `P${phase}/S-${pad(n)}`;
  const dir = path.join(root, docsRoot, 'phases', `P${phase}-x`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `S-${pad(n)}-a.md`),
    `---
slice: ${id}
name: Fixture ${n}
repo: .
group: B
runbook: no
requirements: [REQ-1.8]
decisions: []
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`a.test.js » works\` | happy | REQ-1.8 |

## Expected changes

\`src/a.js\`.
`,
  );
  return id;
}

export function writeSliceFixtures(root, count, opts = {}) {
  return Array.from({ length: count }, (_, i) => writeSliceFixture(root, { ...opts, n: i + 1 }));
}
