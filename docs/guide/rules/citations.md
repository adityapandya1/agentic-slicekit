# Check rule: citations

Every requirement cites a source that exists, every slice file names requirements and decisions that exist, and no ID is defined twice.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `citations <file>:<line> <message>`.

## What fails

- A requirement heading at a level other than `##` or `###`.
- A requirement whose `Cites:` line names no decision row and no intake file that exists.
- A slice file that names a requirement or a decision that does not exist, or that cannot be read.
- A test of a slice's evaluation set that covers no requirement.
- A decision or requirement ID defined twice: `duplicate id <id> (<file>:<line> and <file>:<line>)`.
- On a slice branch, a test file the branch adds or modifies that names no REQ ID: `test file names no requirement`.

## When it judges

On every run. The test-file part judges only a slice branch, against its merge base with the default branch; deleted files and the default branch itself are not judged.

## How to clear a finding

Add the `Cites:` line or correct the ID. Name the REQ ID a test covers in the test file, in a comment or a test name.

## The failure it prevents

A requirement appears in the spec with nothing behind it, so nobody can say who asked for it or why, and a test exists that covers no requirement, so the graph cannot say what the test proves.
