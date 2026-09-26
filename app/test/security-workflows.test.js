'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

function load(name) {
  return yaml.load(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8'));
}

test('all GitHub Actions references are pinned to full commits with version comments', () => {
  for (const name of fs.readdirSync(WORKFLOWS).filter((item) => item.endsWith('.yml'))) {
    const source = fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');
    for (const line of source.split('\n').filter((item) => item.includes('uses:'))) {
      assert.match(
        line,
        /uses:\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?@[a-f0-9]{40}\s+#\s+v[0-9]/,
        `${name}: ${line.trim()}`
      );
    }
  }
});

test('release publication attests the exact upload directory', () => {
  const release = load('release.yml');
  const publish = release.jobs.publish;
  assert.strictEqual(publish.permissions['id-token'], 'write');
  assert.strictEqual(publish.permissions.attestations, 'write');
  assert.strictEqual(publish.permissions.contents, 'write');

  const attest = publish.steps.find((step) => String(step.uses || '').startsWith('actions/attest@'));
  assert.ok(attest);
  assert.strictEqual(attest.with['subject-path'], 'installers/*');

  const publishStep = publish.steps.find((step) => step.name === 'Publish');
  assert.match(publishStep.run, /installers\/\*/);
  const notes = publish.steps.find((step) => step.name === 'Write the release notes');
  assert.match(
    notes.run,
    /gh attestation verify <file> -R magnuslandahl\/FeedbackRecorder/
  );
});

test('rolling release publication cannot retain stale assets', () => {
  const release = load('release.yml');
  const publish = release.jobs.publish.steps.find((step) => step.name === 'Publish');
  const source = fs.readFileSync(path.join(WORKFLOWS, 'release.yml'), 'utf8');

  assert.match(
    publish.run,
    /if gh release view "\$\{TAG\}".*then\s+gh release delete "\$\{TAG\}" --yes --cleanup-tag\s+fi/s
  );
  assert.doesNotMatch(publish.run, /gh release delete[^\n]*\|\| true/);
  assert.doesNotMatch(publish.run, /gh release edit|gh release upload|--clobber/);
  assert.match(publish.run, /gh release create "\$\{TAG\}"/);
  assert.match(publish.run, /\.assets\[\].*\.digest/);
  assert.match(publish.run, /diff -u "\$expected_assets" "\$remote_assets"/);
  assert.ok(
    publish.run.indexOf('gh release delete') < publish.run.indexOf('gh release create'),
    'the old rolling release must be deleted before its replacement is created'
  );
  assert.doesNotMatch(source, /path:\s+app\/vendor\/whisper/);
});

test('CI includes pull-request dependency review and privacy invariants', () => {
  const ci = load('ci.yml');
  assert.strictEqual(ci.jobs['dependency-review'].if, "github.event_name == 'pull_request'");
  assert.strictEqual(ci.jobs['dependency-review'].steps[1].with['fail-on-severity'], 'high');
  assert.strictEqual(ci.jobs['dependency-review'].steps[1].with['license-check'], true);
  assert.ok(ci.jobs.ci.needs.includes('dependency-review'));
  assert.ok(ci.jobs.ci.needs.includes('privacy-supply-chain'));
});

test('CodeQL uses advanced JavaScript analysis and uploads security results', () => {
  const codeql = load('codeql.yml');
  assert.strictEqual(codeql.permissions.contents, 'read');
  assert.strictEqual(codeql.jobs.analyze.permissions['security-events'], 'write');
  const init = codeql.jobs.analyze.steps.find((step) => String(step.uses || '').includes('/init@'));
  assert.strictEqual(init.with.languages, 'javascript-typescript');
  assert.strictEqual(init.with['build-mode'], 'none');
});
