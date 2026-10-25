// redact: secrets in a command line are masked with *** before the line is stored (REQ-3.6's handoff
// keeps the last command run in a committed state file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact.js';

const CASES = [
  ['Bearer header', 'curl -H "Authorization: Bearer abc.def-123" https://x', 'curl -H "Authorization: Bearer ***" https://x'],
  ['Basic header', "curl -H 'Authorization: basic dXNlcjpwYXNz' https://x", "curl -H 'Authorization: basic ***' https://x"],
  ['token=', 'curl https://x/?token=s3cr3t&a=1', 'curl https://x/?token=***&a=1'],
  ['password=', 'run PASSWORD=hunter2 ./go', 'run PASSWORD=*** ./go'],
  ['passwd=', 'set passwd=hunter2', 'set passwd=***'],
  ['secret=', 'deploy --env secret=abc123', 'deploy --env secret=***'],
  ['api_key=', 'x api_key=abc123', 'x api_key=***'],
  ['api-key=', 'x API-KEY=abc123', 'x API-KEY=***'],
  ['apikey=', 'x apikey=abc123', 'x apikey=***'],
  ['--password=', 'tool --password=hunter2 go', 'tool --password=*** go'],
  ['--password space', 'tool --password hunter2 go', 'tool --password *** go'],
  ['--token', 'gh auth --token abc123', 'gh auth --token ***'],
  ['--secret=', 'tool --secret=abc123', 'tool --secret=***'],
  ['mysql -pvalue', 'mysql -u root -phunter2 db', 'mysql -u root -p*** db'],
  ['mysqldump -p value', 'mysqldump -u root -p hunter2 db', 'mysqldump -u root -p *** db'],
  ['mariadb -pvalue', 'mariadb -phunter2', 'mariadb -p***'],
  ['psql -p is a port', 'psql -p 5432 -h localhost', 'psql -p 5432 -h localhost'],
  ['mysql -P is a port', 'mysql -P 3306 -h h', 'mysql -P 3306 -h h'],
  ['ghp token', 'echo ghp_abcdefghijklmnopqrstuvwxyz0123', 'echo ***'],
  ['gho token', 'echo gho_ABCDEFGHIJKLMNOPQRSTUV', 'echo ***'],
  ['github_pat', 'echo github_pat_11ABCDEFG_abcdefghijklmnop', 'echo ***'],
  ['sk- key', 'echo sk-proj-abcdefghij123456', 'echo ***'],
  ['AWS key id', 'aws AKIAABCDEFGHIJKLMNOP s3 ls', 'aws *** s3 ls'],
  ['Slack token', 'curl xoxb-123-456-abcDEF', 'curl ***'],
  ['JWT', 'echo eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_nat-ure', 'echo ***'],
  ['URL credentials', 'git clone https://bob:hunter2@example.com/r.git', 'git clone https://***@example.com/r.git'],
];
for (const [name, input, expected] of CASES) {
  test(`redact: ${name}`, () => {
    assert.equal(redact(input), expected);
  });
}

test('redact: a line with no secret is unchanged', () => {
  const s = 'ran: npm test -- --grep token → exit 0';
  assert.equal(redact(s), s);
});

test('redact: a non-string gives an empty string', () => {
  assert.equal(redact(undefined), '');
});
