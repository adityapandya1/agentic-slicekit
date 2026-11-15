# 01 — Counter

## REQ-1.1 The count over HTTP

`GET /count` SHALL answer status 200 with the JSON body `{"count": <n>}`, where `<n>` is the count the server holds, 0 after a start.

Scenario: GIVEN a server that has just started WHEN a client sends `GET /count` THEN the answer is 200 with the body `{"count": 0}`.

Cites: D-01.

Enforced by: the tests of P1/S-01.

## REQ-1.2 The page shows the count

`GET /` SHALL answer an HTML page that shows the count `GET /count` answers. The page SHALL follow the design rules in `docs/spec/stack.md`, which the designer agent judges it against. A path other than `/` and `/count` SHALL be answered with status 404 and no page.

Scenario: GIVEN a server whose count is 0 WHEN a browser opens `/` THEN the element with the id `count` holds the text 0.

Scenario: GIVEN a running server WHEN a client sends `GET /other` THEN the answer is 404 and its body is not the page.

Cites: D-01.

Enforced by: the tests of P1/S-01; the designer's verdict on the page.
