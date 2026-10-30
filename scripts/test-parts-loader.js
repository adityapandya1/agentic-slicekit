// The module hooks test-parts-hook.js registers: `node:test` imported by a planned test file itself
// resolves to the wrapper, with the file named in the URL. Nothing else is redirected.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let plan = {};
let cwd = process.cwd();
const WRAPPER = new URL('./test-parts-wrapper.js', import.meta.url);

export function initialize(data) {
  plan = JSON.parse(data.plan);
  cwd = data.cwd;
}

export async function resolve(specifier, context, next) {
  if (specifier === 'node:test' && context.parentURL?.startsWith('file:')) {
    const rel = path.relative(cwd, fileURLToPath(context.parentURL)).split(path.sep).join('/');
    if (Object.hasOwn(plan, rel)) {
      const url = new URL(WRAPPER);
      url.searchParams.set('file', rel);
      return { url: url.href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
