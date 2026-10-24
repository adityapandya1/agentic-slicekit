# Stack

The kit is written in **Node (JavaScript, ES modules), with zero runtime dependencies** (D-04).
Minimum Node 20. Tests use `node:test`. The visualize page is one static HTML file with inline
script; nothing is fetched from a CDN, so it works on an air-gapped laptop.

The repositories the kit is installed into can be in any language. The kit learns four commands at
init (`test`, `lint`, `build`, `e2e`, any may be empty) and runs them as given (D-11). It parses
test output only for an exit code.

Why zero dependencies: every supported agent tool already requires Node, so nothing new is installed;
a security team can read every file that runs in their repository; there is no supply chain to
audit beyond Node itself; and `npx slicekit` works on a machine that has never seen the package.

What this costs: the graph layout and the markdown parsing are written by hand and kept small. The
visualize page draws with the browser's own SVG. Neither needs to be clever.
