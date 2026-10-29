Verdict: BLOCK
Head: abc1234abc1234abc1234abc1234abc1234abc12

| ID | File:line | What is wrong | Why it matters | How verified |
|---|---|---|---|---|
| B-1 | src/a.js:3 | wrong sum | bad totals | `npm test` printed "fail 2" |
| B-2 | src/b.js:9 | null deref | crash on empty input |  |
| H-1 | src/c.js | naming | readability | - |

## Checklists run

- correctness

## Not checked

- security
