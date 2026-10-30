Verdict: BLOCK
Head: abc1234abc1234abc1234abc1234abc1234abc12

Independent: yes

| ID | File:line | What is wrong | Why it matters | How verified |
|---|---|---|---|---|
| B-1 | src/verdict.js:12 | the parser drops CRLF rows | a Windows reviewer is refused | `node --test` printed "fail 1" |
| H-1 | src/verdict.js | a long function | hard to read | read only |
| H-2 | - | no fixture for an empty table | coverage gap | read only |

## Checklists run

- correctness
- tests

## Not checked

- performance
