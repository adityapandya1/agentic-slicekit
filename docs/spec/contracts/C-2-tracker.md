# C-2 Tracker adapter

**Producer:** the kit; the adapter lives in `src/adapters/tracker/`. **Consumers:** `/slicekit build` step 8 (declined
should-haves), `/slicekit gaps` (optional: a gap as a ticket). **Version one implementation:**
GitHub Issues (D-09). Jira is the first expected second implementation; its fields map onto the same
three operations.

| Operation | Input | Output |
|---|---|---|
| `open` | title, body, labels, slice ID | id, url |
| `comment` | id, body | — |
| `find` | slice ID, finding ID | id, url or none |

`find` returns the ticket's state (open or closed) with its id and url. A finding ID names one
finding for the whole slice: a surviving finding keeps its ID across rounds and a new one takes a
number never used in that slice, so a ticket whose title begins `[<slice>] <finding>:` is that
finding's.

A ticket opened by the kit SHALL carry the slice ID in its title and the verdict excerpt in its
body, so the graph can attach it to the slice. The kit SHALL never close a ticket.
