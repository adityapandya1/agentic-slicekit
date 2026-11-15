import { redact } from '../../redact.js';
import { TrackerError, assertFinding, assertIssueId, assertIssueTitle, assertLabels, assertSlice, findingTitlePrefix, pickFinding } from './errors.js';

// C-2 for Jira Cloud through its REST API v3 (D-74). The base URL, project key and issue type come from
// config (`tracker.baseUrl`, `tracker.project`, `tracker.issueType`); the email and API token come from
// JIRA_EMAIL and JIRA_API_TOKEN at each call and are never stored. `fetchImpl` is the test seam. Every
// TrackerError is scrubbed of the token and the Authorization value before it leaves this file: the
// adapter's config check and its three operations each run inside `scrubbed`. Nothing here closes an
// issue. The three operations return promises.
const SEARCH_LIMIT = 50;
// The most pages one find reads. A search that still hands out a token after this many ends in an error.
const PAGE_LIMIT = 200;
// The most characters of a page token an error prints.
const TOKEN_SHOWN = 40;

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

// The words of a title prefix as a value Jira's text search can parse. Jira refuses a `~` value with
// HTTP 400 when a reserved character of the text search stands in it unescaped, so none is sent:
// brackets, braces, parentheses, `^`, `:`, `/`, `&`, `|`, backslash and both quotes become a space,
// and `+`, `-`, `!`, `*`, `?` and `~` are cut from the start of each word. The value is looser than
// the prefix; pickFinding narrows the hits.
export function searchValue(prefix) {
  const words = String(prefix ?? '')
    .replace(/[()[\]{}^:/&|\\"']/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[+\-!*?~]+/, ''))
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) throw new TrackerError(`jira find: no word to search for in ${JSON.stringify(String(prefix ?? ''))}`);
  return words.join(' ');
}

export function jiraTracker(cfg, env = process.env, fetchImpl = (...a) => fetch(...a)) {
  // The token and the two forms of the Authorization value, as far as the environment holds them.
  function secrets() {
    const token = typeof env?.JIRA_API_TOKEN === 'string' ? env.JIRA_API_TOKEN : '';
    const email = typeof env?.JIRA_EMAIL === 'string' ? env.JIRA_EMAIL : '';
    if (token === '') return [];
    if (email === '') return [token];
    const encoded = Buffer.from(`${email}:${token}`).toString('base64');
    return [`Basic ${encoded}`, encoded, token];
  }

  function scrub(text) {
    let out = String(text ?? '');
    for (const s of secrets()) out = out.split(s).join('***');
    return redact(out);
  }

  // The one way a TrackerError leaves this adapter: its message goes through scrub. Any other error
  // passes as it is.
  const clean = (e) => (e instanceof TrackerError ? new TrackerError(scrub(e.message)) : e);
  const scrubbed = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      throw clean(e);
    }
  };

  let checked;
  try {
    checked = validate(cfg);
  } catch (e) {
    throw clean(e);
  }
  const { base, project, issueType } = checked;

  function credentials() {
    for (const name of ['JIRA_EMAIL', 'JIRA_API_TOKEN']) {
      if (typeof env[name] !== 'string' || env[name] === '') throw new TrackerError(`${name} is not set; the jira tracker needs JIRA_EMAIL and JIRA_API_TOKEN`);
    }
    const encoded = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
    return { header: `Basic ${encoded}` };
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
      throw new TrackerError(`jira ${op} failed: ${scrub(e?.message ?? e)}`);
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
      throw new TrackerError(`jira ${op} failed: HTTP ${res.status}${detail ? `: ${scrub(detail).slice(0, 500)}` : ''}`);
    }
    if (text === '') return {};
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new TrackerError(`jira ${op} answered with something that is not JSON: ${scrub(e.message)}`);
    }
  }

  const browse = (key) => `${base}/browse/${key}`;

  return {
    kind: 'jira',
    open: scrubbed(async ({ title, body, labels = [], slice }) => {
      assertIssueTitle(title);
      assertLabels(labels);
      assertSlice(slice);
      const fields = { project: { key: project }, issuetype: { name: issueType }, summary: title, description: adf(body), labels: [...labels] };
      const made = await call('open', 'POST', '/rest/api/3/issue', { fields });
      const id = Number(made.id);
      if (!Number.isInteger(id) || id < 1 || typeof made.key !== 'string') throw new TrackerError('jira open answered with no issue id and key');
      return { id, url: browse(made.key) };
    }),
    comment: scrubbed(async (id, body) => {
      assertIssueId(id);
      await call('comment', 'POST', `/rest/api/3/issue/${id}/comment`, { body: adf(body) });
    }),
    // Jira's text search is loose, so its hits, oldest first, are narrowed to a summary that begins
    // `[<slice>] <finding>:`. A status in the done category reads as closed. The pages are read in
    // order, following `nextPageToken`, until one holds such a summary or no token is left. A token
    // given twice ends the search with an error, so a faulty server cannot hold the command in a loop.
    // That error prints the token scrubbed and cut to TOKEN_SHOWN characters, the scrub before the cut.
    find: scrubbed(async (slice, finding) => {
      assertSlice(slice);
      assertFinding(finding);
      const prefix = findingTitlePrefix(slice, finding);
      const jql = `project = ${jqlString(project)} AND summary ~ ${jqlString(searchValue(prefix))} ORDER BY created ASC`;
      const given = new Set();
      let token = null;
      for (let page = 1; ; page += 1) {
        const q = new URLSearchParams({ jql, fields: 'summary,status,created', maxResults: String(SEARCH_LIMIT) });
        if (token !== null) q.set('nextPageToken', token);
        const out = await call('find', 'GET', `/rest/api/3/search/jql?${q}`);
        const list = (Array.isArray(out.issues) ? out.issues : []).map((i) => ({
          number: Number(i?.id),
          url: browse(i?.key),
          title: i?.fields?.summary,
          state: i?.fields?.status?.statusCategory?.key === 'done' ? 'closed' : 'open',
        }));
        const hit = pickFinding(list, slice, finding);
        if (hit) return hit;
        const next = out.nextPageToken;
        if (typeof next !== 'string' || next === '') return null;
        if (given.has(next)) throw new TrackerError(`jira find failed: the search gave the page token ${JSON.stringify(scrub(next).slice(0, TOKEN_SHOWN))} twice; stopped after ${page} pages`);
        if (page >= PAGE_LIMIT) throw new TrackerError(`jira find failed: the search still gave a page token after ${PAGE_LIMIT} pages; stopped`);
        given.add(next);
        token = next;
      }
    }),
  };
}
