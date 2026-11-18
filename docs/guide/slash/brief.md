# /slicekit brief

Interviews a person who has an idea but no requirement document, and writes the brief that `/slicekit intake` takes as its source.

## What you type

`/slicekit brief [<slug>]`. Run it before `/slicekit intake`, when there is no requirement document yet. With no slug, the session asks the person for a short name for the idea.

## Agents it spawns

None. The session itself asks the questions, one topic per question, in this order: the problem and who has it, what they do today, the use cases, what is out of scope, the success measures, the constraints, and the unknowns.

## Commands its procedure runs

- [`branch`](../commands/branch.md) as `branch spec <slug>`
- [`brief`](../commands/brief.md) as `brief start <slug>`, then `brief ask` before each question and `brief answer` after each answer, then `brief done`

Every step that touches git or the git host goes through the CLI. The procedure stops at the first command that exits with a code other than 0 and shows the person its message.

## What it leaves behind

The branch `spec/<slug>`. The brief `<docsRoot>/brief/<slug>.md`, committed, with the seven sections and only the person's answers; each topic the person could not answer is listed under `## Open questions`. The next command, printed as the last line: `/slicekit intake <docsRoot>/brief/<slug>.md`. No spec file and no pull request.

[Back to the guide](../README.md#pages)
