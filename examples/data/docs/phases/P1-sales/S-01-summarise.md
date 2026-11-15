---
slice: P1/S-01
name: Summarise sales by region
repo: .
group: A
runbook: no
requirements: [REQ-1.1]
decisions: [D-01]
---

## Done when

1. `summarise` over the five rows of `data/sales.csv` returns `{"north": 150, "south": 100, "east": 55}`.
2. `summarise([])` returns `{}`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `summarise.test.js » totals each region's sales` | happy | REQ-1.1 |
| `summarise-empty.test.js » no rows give an empty summary` | negative | REQ-1.1 |

## Expected changes

`src/summarise.js`, `test/summarise.test.js`, `test/summarise-empty.test.js`.
