// Loaded with `node --test --import` by scripts/test-shard.js (D-49). SLICEKIT_TEST_PARTS maps a test
// file (POSIX, relative to the working directory) to { parts, keep }: in that file, `node:test`
// resolves to test-parts-wrapper.js, whose `test` registers top-level test i only when i mod parts
// is in keep. Every other file, and every other module, gets the real `node:test`.
import { register } from 'node:module';

if (process.env.SLICEKIT_TEST_PARTS) {
  register('./test-parts-loader.js', import.meta.url, { data: { plan: process.env.SLICEKIT_TEST_PARTS, cwd: process.cwd() } });
}
