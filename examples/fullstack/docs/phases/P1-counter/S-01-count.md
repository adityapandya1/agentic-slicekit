---
slice: P1/S-01
name: Count over HTTP and on the page
repo: .
group: A
runbook: no
requirements: [REQ-1.1, REQ-1.2]
decisions: [D-01]
---

## Done when

1. `GET /count` on a server that has just started answers 200 with `{"count": 0}`.
2. `GET /` answers an HTML page whose element with the id `count` holds 0, with `lang="en"` on `html` and one `h1`.
3. `GET /other` answers 404 and no page.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `count.test.js » answers the count as JSON` | happy | REQ-1.1 |
| `page.test.js » shows the count at the root and answers 404 for any other path` | negative | REQ-1.2 |

## Expected changes

`src/server.js`, `src/page.js`, `test/count.test.js`, `test/page.test.js`.
