# Stack

- Language and runtime: JavaScript on Node 22, ES modules.
- Server: `node:http`, with no framework.
- Page: one HTML document the server writes, with no build step and no client library.
- Storage: none; the count is held in memory (D-01).
- Test runner: `node --test`.
- Hosting: none; the example runs only as its tests.

## Design rules

The designer agent judges the page against these rules and no others.

1. The `html` element names its language with `lang="en"`.
2. The page has one `h1`, and it reads "Counter".
3. The count is text inside the element with the id `count`; it is never drawn as an image.
4. Text and its background have a contrast ratio of 4.5 to 1 or more.
5. The page reads without horizontal scrolling at a width of 320 CSS pixels.
