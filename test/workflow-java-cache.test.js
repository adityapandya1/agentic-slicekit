// REQ-3.11: the setup-java cache is set only when the checkout holds a file its pattern keys on: a gradle/*.versions.toml at the root only, and in a git repository a gitignored file does not count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasCacheFile, javaBuildTool } from '../src/workflow.js';

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-java-cache-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
function repo(files, add) {
  const dir = fixture(files);
  git(dir, 'init', '-q');
  if (add.length) git(dir, 'add', '--', ...add);
  return dir;
}

test('a versions catalogue in a nested gradle folder gives no Gradle cache', () => {
  assert.equal(hasCacheFile(fixture({ 'sub/gradle/x.versions.toml': '' }), 'gradle'), false);
});

test('a versions catalogue in the gradle folder at the root gives the Gradle cache', () => {
  assert.equal(hasCacheFile(fixture({ 'gradle/libs.versions.toml': '' }), 'gradle'), true);
});

test('a gitignored pom.xml in a git repository gives no Maven cache', () => {
  const dir = repo({ '.gitignore': 'out/\n', 'out/pom.xml': '<project/>' }, ['.gitignore']);
  assert.equal(hasCacheFile(dir, 'maven'), false);
});

test('a tracked nested pom.xml in a git repository gives the Maven cache', () => {
  assert.equal(hasCacheFile(repo({ 'svc/pom.xml': '<project/>' }, ['svc/pom.xml']), 'maven'), true);
});

// Codex on #135: a command that only mentions a tool is not a Java repository; a gitignored root build
// file is absent from the CI checkout, so it marks no Java repository either.
test('a tool mentioned in an argument is not a call', () => {
  assert.equal(javaBuildTool(null, ['echo "mvn test"']), null);
  assert.equal(javaBuildTool(null, ["rg 'gradle' docs"]), null);
  assert.equal(javaBuildTool(null, ['npm run lint && ./gradlew check']), 'gradle');
  assert.equal(javaBuildTool(null, ['  mvn -B verify']), 'maven');
  assert.equal(javaBuildTool(null, ['bash -c "gradle test"']), 'gradle');
});

test('a gitignored root build file does not make a Java repository', () => {
  const dir = repo({ '.gitignore': 'pom.xml\n', 'pom.xml': '<project/>\n' }, ['.gitignore']);
  assert.equal(javaBuildTool(dir, ['npm test']), null);
});

// Review H-7 on #135: a call on a later line, after NAME=value, after a wrapper, or in a shell started
// with combined flags is still a call.
test('a call after a line break, an assignment, a wrapper or combined shell flags still counts', () => {
  assert.equal(javaBuildTool(null, ['npm ci\nmvn -B verify']), 'maven');
  assert.equal(javaBuildTool(null, ['MAVEN_OPTS=-Xmx1g mvn verify']), 'maven');
  assert.equal(javaBuildTool(null, ['env CI=1 ./gradlew build']), 'gradle');
  assert.equal(javaBuildTool(null, ['time mvn verify']), 'maven');
  assert.equal(javaBuildTool(null, ['xvfb-run -a ./gradlew test']), 'gradle');
  assert.equal(javaBuildTool(null, ['bash -lc "gradle test"']), 'gradle');
  assert.equal(javaBuildTool(null, ["sh -ec 'mvn verify'"]), 'maven');
  assert.equal(javaBuildTool(null, ['cd svc && mvn verify']), 'maven');
  assert.equal(javaBuildTool(null, ['echo mvn']), null);
});
