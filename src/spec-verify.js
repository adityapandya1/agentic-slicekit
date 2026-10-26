// `spec verify` (REQ-2.3): what the spec stands on before it goes to review. The earlier stages are
// done, every REQ cites a decision row or an intake file that exists, and every interface named at
// intake has a contract. A `[NEEDS CLARIFICATION: …]` marker is listed, never a finding: specify
// may leave one, plan refuses it.
import path from 'node:path';
import { citedRefs, intakeExists } from './check/rules/citations.js';
import { exists, listFiles, readText } from './fs.js';
import { interfacesWithoutContract, readDecisions } from './decisions.js';
import { prose } from './markdown.js';
import { kitPaths } from './paths.js';
import { clarificationMarkers, programStage, reqBlocks } from './stage.js';

const posix = (p) => p.split(path.sep).join('/');
const mdFiles = (dir) => (exists(dir) ? listFiles(dir, { ext: '.md' }).map((f) => path.join(dir, f)) : []);

// Each REQ whose `Cites:` entries name no D row present in decisions.md and no file that exists
// under `<docsRoot>/intake/`, resolved exactly as check's citation rule resolves them.
export function unsupportedReqs(root, cfg) {
  const p = kitPaths(root, cfg);
  const ids = new Set(exists(p.decisions) ? readDecisions(readText(p.decisions)).rows.map((r) => r.id) : []);
  const resolves = (r) => (r.kind === 'decision' ? ids.has(r.name) : intakeExists(p.intake, r.name));
  return reqBlocks(root, cfg)
    .filter(({ line, block }) => !citedRefs([...prose(block)].map(([l, n]) => [l, n + line])).some(resolves))
    .map(({ id, file, line }) => ({ req: id, file, line }));
}

// Every clarification marker in the spec's Markdown files, contracts included.
function markers(root, cfg) {
  return mdFiles(kitPaths(root, cfg).spec).flatMap((f) => {
    const file = posix(path.relative(root, f));
    return clarificationMarkers(readText(f)).map((m) => ({ file, ...m }));
  });
}

export function verifySpec(root, cfg) {
  const findings = [];
  const now = programStage(root, cfg, { upTo: 'specify' });
  if (!now.complete && now.stage !== 'specify') {
    for (const b of now.blockers) findings.push({ file: '-', line: 0, message: `${now.stage} not done: ${b}` });
  }
  for (const r of unsupportedReqs(root, cfg)) {
    findings.push({ file: r.file, line: r.line, message: `${r.req} cites nothing that exists; write [NEEDS CLARIFICATION: <question>] instead of a guess` });
  }
  const p = kitPaths(root, cfg);
  if (exists(p.decisions)) {
    const where = posix(path.relative(root, p.decisions));
    const contracts = `${posix(path.relative(root, p.contracts))}/`;
    for (const i of interfacesWithoutContract(root, cfg)) {
      findings.push({ file: where, line: i.line, message: `interface ${i.name} (${i.id}) has no contract under ${contracts}` });
    }
  }
  const found = markers(root, cfg);
  return {
    findings,
    counts: { reqs: reqBlocks(root, cfg).length, contracts: mdFiles(kitPaths(root, cfg).contracts).length, markers: found.length },
    markers: found,
  };
}
