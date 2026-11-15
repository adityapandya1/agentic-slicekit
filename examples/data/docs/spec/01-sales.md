# 01 — Sales summary

## REQ-1.1 Total each region's sales

`summarise(rows)` SHALL return an object with one key per region in `rows`, whose value is the sum of that region's amounts. Given no rows it SHALL return an empty object.

Scenario: GIVEN the five rows of `data/sales.csv` WHEN `summarise` runs THEN it returns `{"north": 150, "south": 100, "east": 55}`.

Scenario: GIVEN no rows WHEN `summarise` runs THEN it returns `{}`.

Cites: D-01.

Enforced by: the tests of P1/S-01.
