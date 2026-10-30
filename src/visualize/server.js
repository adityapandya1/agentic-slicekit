// The visualize server (REQ-4.7): node:http bound to 127.0.0.1 only, serving the page at / and the
// graph at /graph.json; every other path is 404. It opens nothing and reaches nothing.
import http from 'node:http';
import { GraphError } from '../graph/schema.js';

const HOST = '127.0.0.1';

// -> Promise<{url, port, close() -> Promise<void>}>; a port in use rejects with GraphError code 1.
export function startServer({ html, graphJson, port = 0 }) {
  const routes = new Map([
    ['/', { type: 'text/html; charset=utf-8', body: Buffer.from(html, 'utf8') }],
    ['/graph.json', { type: 'application/json; charset=utf-8', body: Buffer.from(graphJson, 'utf8') }],
  ]);
  let allowed = new Set();
  const server = http.createServer((req, res) => {
    const pathOnly = String(req.url ?? '').split('?')[0];
    // A page on another site can point its own name at 127.0.0.1 (DNS rebinding); only a request
    // that names this server by its loopback address or localhost is answered (S-19 review H-1).
    const named = allowed.has(String(req.headers.host ?? '').toLowerCase());
    const hit = named && (req.method === 'GET' || req.method === 'HEAD') ? routes.get(pathOnly) : undefined;
    const { type, body, status } = hit ? { ...hit, status: 200 } : { type: 'text/plain; charset=utf-8', body: Buffer.from('not found\n'), status: 404 };
    res.writeHead(status, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE') reject(new GraphError(1, `port ${port} is in use; pass --port`));
      else reject(e);
    });
    server.listen(port, HOST, () => {
      const bound = server.address().port;
      allowed = new Set([`${HOST}:${bound}`, `localhost:${bound}`]);
      let closing = null;
      const close = () => {
        closing ??= new Promise((done) => {
          server.close(() => done());
          server.closeAllConnections();
        });
        return closing;
      };
      resolve({ url: `http://${HOST}:${bound}/`, port: bound, close });
    });
  });
}
