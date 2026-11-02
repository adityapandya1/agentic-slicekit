import { redact } from '../../redact.js';
import { TrackerError, assertFinding, assertIssueId, assertIssueTitle, assertLabels, assertSlice, findingTitlePrefix, pickFinding } from './errors.js';

// C-2 for Jira Cloud through its REST API v3 (D-74). The base URL, project key and issue type come from
// config (`tracker.baseUrl`, `tracker.project`, `tracker.issueType`); the email and API token come from
// JIRA_EMAIL and JIRA_API_TOKEN at each call and are never stored. `fetchImpl` is the test seam. Every
// error is scrubbed of the token and the Authorization value before it leaves this file. Nothing here
// closes an issue. The three operations return promises.
const SEARCH_LIMIT = 50;

// Throws a TrackerError naming the first config key that is missing or wrong.
export function validate(cfg) {
  const t = cfg?.tracker ?? {};
  for (const key of ['baseUrl', 'project', 'issueType']) {
    if (typeof t[key] !== 'string' || t[key].trim() === '') {
      throw new TrackerError(`tracker.${key}: required for a jira tracker, as a non-empty string`);
    }
  }
  let url;
  try {
    url = new URL(t.baseUrl);
  } catch {
    throw new TrackerError(`tracker.baseUrl: not a URL: ${JSON.stringify(t.baseUrl)}`);
  }
  if (url.protocol !== 'https:') throw new TrackerError(`tracker.baseUrl: must be an https URL, got ${url.protocol.replace(/:$/, '')}`);
  if (url.username || url.password) throw new TrackerError('tracker.baseUrl: must not carry credentials');
  return { base: url.href.replace(/\/+$/, ''), project: t.project.trim(), issueType: t.issueType.trim() };
}

// Atlassian Document Format: one paragraph per non-empty line.
function adf(text) {
  const content = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l !== '')
    .map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }));
  return { type: 'doc', version: 1, content };
}

// A JQL string literal: backslash and double quote escaped.
const jqlString = (s) => `"${String(s).replace(/[\\"]/g, (c) => `\\${c}`)}"`;

export function jiraTracker(cfg, env = process.env, fetchImpl = (...a) => fetch(...a)) {
  const { base, project, issueType } = validate(cfg);

  function credentials() {
    for (const name of ['JIRA_EMAIL', 'JIRA_API_TOKEN']) {
      if (typeof env[name] !== 'string' || env[name] === '') throw new TrackerError(`${name} is not set; the jira tracker needs JIRA_EMAIL and JIRA_API_TOKEN`);
    }
    const encoded = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
    return { token: env.JIRA_API_TOKEN, encoded, header: `Basic ${encoded}` };
  }

  function scrub(text, secret) {
    let out = String(text ?? '');
    for (const s of [secret.header, secret.encoded, secret.token]) out = out.split(s).join('***');
    return redact(out);
  }

  async function call(op, method, path, body) {
    const secret = credentials();
    const init = { method, headers: { Authorization: secret.header, Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, init);
    } catch (e) {
      throw new TrackerError(`jira ${op} failed: ${scrub(e?.message ?? e, secret)}`);
    }
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    if (!res.ok) {
      let detail = text;
      try {
        const j = JSON.parse(text);
        const parts = [...(Array.isArray(j.errorMessages) ? j.errorMessages : []), ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`)];
        if (parts.length > 0) detail = parts.join('; ');
      } catch {
        // not JSON: keep the text
      }
      throw new TrackerError(`jira ${op} failed: HTTP ${res.status}${detail ? `: ${scrub(detail, secret).slice(0, 500)}` : ''}`);
    }
    if (text === '') return {};
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new TrackerError(`jira ${op} answered with something that is not JSON: ${scrub(e.message, secret)}`);
    }
  }

  const browse = (key) => `${base}/browse/${key}`;

  return {
    kind: 'jira',
    async open({ title, body, labels = [], slice }) {
      assertIssueTitle(title);
      assertLabels(labels);
      assertSlice(slice);
      const fields = { project: { key: project }, issuetype: { name: issueType }, summary: title, description: adf(body), labels: [...labels] };
      const made = await call('open', 'POST', '/rest/api/3/issue', { fields });
      const id = Number(made.id);
      if (!Number.isInteger(id) || id < 1 || typeof made.key !== 'string') throw new TrackerError('jira open answered with no issue id and key');
      return { id, url: browse(made.key) };
    },
    async comment(id, body) {
      assertIssueId(id);
      await call('comment', 'POST', `/rest/api/3/issue/${id}/comment`, { body: adf(body) });
    },
    // Jira's text search is loose, so its hits, oldest first, are narrowed to a summary that begins
    // `[<slice>] <finding>:`. A status in the done category reads as closed.
    async find(slice, finding) {
      assertSlice(slice);
      assertFinding(finding);
      const prefix = findingTitlePrefix(slice, finding);
      const jql = `project = ${jqlString(project)} AND summary ~ ${jqlString(prefix)} ORDER BY created ASC`;
      const q = new URLSearchParams({ jql, fields: 'summary,status,created', maxResults: String(SEARCH_LIMIT) });
      const out = await call('find', 'GET', `/rest/api/3/search/jql?${q}`);
      const list = (Array.isArray(out.issues) ? out.issues : []).map((i) => ({
        number: Number(i?.id),
        url: browse(i?.key),
        title: i?.fields?.summary,
        state: i?.fields?.status?.statusCategory?.key === 'done' ? 'closed' : 'open',
      }));
      return pickFinding(list, slice, finding);
    },
  };
}
