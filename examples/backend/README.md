# examples/backend

The smallest project a slice can be built in: one requirement (REQ-1.1), one slice (P1/S-01) and an empty `src/`.

Copy this directory into a new git repository, then run `slicekit init --shape backend` first. Init adds the kit's hooks, templates and the rest of the docs layout and keeps the files here as they are. Commit on `main`, then run `/slicekit build` to build P1/S-01 from `todo` to a draft pull request.
