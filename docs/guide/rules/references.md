# Check rule: references

Every path, anchor and ID a doc names exists.

A ratchet rule: a file fails only when its count of findings is above its baseline; see [`baseline`](../commands/baseline.md). It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `references <file>:<line> <message>`.

## What fails

- `missing file <path>`: a link target, or a path in backticks, that does not exist with exactly that spelling.
- `missing anchor #<anchor> in <file>`: a link into a Markdown file that has no such heading.
- `unknown id <id>`: a requirement, decision, gap, contract or slice ID that nothing defines.
- `intake file has no valid sidecar`.
- `stale pending marker for <slice>; the slice is done, remove it`.

## When it judges

On every run, over every Markdown file under the docs root, `BUILD.md`, `README.md`, the verdicts and the rendered agent files. Text in a fenced code block is not read. A line that carries the example marker, the HTML comment `slicekit:example`, is skipped. A line that carries a pending marker naming a slice is skipped until that slice is merged. In an unmerged slice file, the paths under Expected changes are promises and are not checked. A frozen intake snapshot is not checked. The rule is a ratchet: each file has a baseline, and only a count above it fails.

## How to clear a finding

Correct the path or the ID, or create the file. After fixing findings in a repository that started with some, run `slicekit baseline update` to lower the baseline.

## The failure it prevents

A spec, a runbook or a slice file points at a file that was renamed or a decision that was never recorded, and the person or agent who follows the reference at the moment it matters finds nothing there.
