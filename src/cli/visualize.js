// slicekit visualize [--port <n>] [--write <file>] (REQ-4.7): the graph as one self-contained page.
// --write writes the page to a file and prints its path; otherwise the page and graph.json are served
// from node:http on 127.0.0.1, the URL printed, nothing opened, until Ctrl-C. No git, no host call.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { loadGraph } from '../graph/load.js';
import { GraphError, serializeGraph } from '../graph/schema.js';
import { renderPage } from '../visualize/page.js';
import { startServer } from '../visualize/server.js';

const USAGE = 'visualize [--port <n>] [--write <file>]';

function usage(io, message) {
  io.stderr(`slicekit: ${message}\nusage: slicekit ${USAGE}\n`);
  return 2;
}

// Resolves when the process receives Ctrl-C.
function interrupted() {
  return new Promise((resolve) => process.once('SIGINT', resolve));
}

async function run(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { port: { type: 'string' }, write: { type: 'string' } }, allowPositionals: false }));
  } catch (e) {
    return usage(io, e.message);
  }
  if (values.port !== undefined && values.write !== undefined) return usage(io, 'give --port or --write, not both');
  let port = 0;
  if (values.port !== undefined) {
    if (!/^\d{1,5}$/.test(values.port) || Number(values.port) > 65535) return usage(io, `--port must be an integer from 0 to 65535, not ${values.port}`);
    port = Number(values.port);
  }
  if (values.write === '') return usage(io, '--write needs a file');

  let graph;
  try {
    graph = loadGraph(io.cwd, loadConfig(io.cwd));
  } catch (e) {
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (e instanceof GraphError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return e.code;
    }
    throw e;
  }
  const html = renderPage(graph);

  if (values.write !== undefined) {
    const file = path.resolve(io.cwd, values.write);
    if (!fs.existsSync(path.dirname(file))) {
      io.stderr(`slicekit: ${path.dirname(values.write)} does not exist\n`);
      return 1;
    }
    fs.writeFileSync(file, html);
    io.stdout(`${values.write}\n`);
    return 0;
  }

  let server;
  try {
    server = await startServer({ html, graphJson: serializeGraph(graph), port });
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return e.code;
  }
  io.stdout(`${server.url}\n`);
  io.stderr('serving the graph on 127.0.0.1 only; Ctrl-C stops it\n');
  await (io.interrupted ?? interrupted)();
  await server.close();
  return 0;
}

export const visualizeCommand = { run, usage: USAGE };
