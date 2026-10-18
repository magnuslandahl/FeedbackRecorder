'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'release.yml');
const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8'));

test('automatic releases run only for app changes on main', () => {
  assert.deepStrictEqual(workflow.on.push, {
    branches: ['main'],
    paths: ['app/**']
  });
});

test('manual releases keep their version choice', () => {
  assert.deepStrictEqual(workflow.on.workflow_dispatch, {
    inputs: {
      bump: {
        description: 'Version part to advance for this manual build',
        required: true,
        default: 'patch',
        type: 'choice',
        options: ['patch', 'minor']
      }
    }
  });
});

test('only the macOS build is given the Apple signing environment', () => {
  const build = workflow.jobs.build;
  assert.strictEqual(
    build.environment,
    "${{ matrix.os == 'macos-latest' && 'apple-signing' || '' }}"
  );
  assert.strictEqual(
    build.env.REQUIRE_MAC_NOTARIZATION,
    "${{ matrix.os == 'macos-latest' && github.repository == 'magnuslandahl/FeedbackRecorder' }}"
  );
});

test('official macOS releases fail closed unless signed by the team and notarized', () => {
  const step = workflow.jobs.build.steps.find((item) => item.name === 'Build the installer');
  for (const name of [
    'MAC_CSC_LINK',
    'MAC_CSC_KEY_PASSWORD',
    'APPLE_API_KEY_P8',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
    'APPLE_TEAM_ID'
  ]) {
    assert.match(step.run, new RegExp(`\\[ -n "\\$\\{${name}:-\\}" \\] \\|\\| missing=`), name);
  }
  assert.strictEqual(step.env.APPLE_TEAM_ID, '${{ vars.APPLE_TEAM_ID }}');

  const required = step.run.indexOf('REQUIRE_MAC_NOTARIZATION');
  const build = step.run.indexOf('npm run dist');
  assert.ok(required >= 0 && required < build, 'missing credentials must stop the build before it runs');
  assert.match(step.run, /\^\[A-Z0-9\]\{10\}\$/);

  const after = step.run.slice(build);
  assert.match(after, /Authority=Developer ID Application: /);
  assert.match(after, /\[ "\$team" != "\$APPLE_TEAM_ID" \]/);
  assert.match(after, /anchor apple generic and certificate leaf\[subject\.OU\]/);
  assert.match(after, /xcrun stapler validate "\$bundle"/);
  assert.match(after, /source=Notarized Developer ID/);

  const image = workflow.jobs.build.steps.find(
    (item) => item.name === 'Check the disk image contains what a new user needs'
  );
  assert.match(image.run, /xcrun stapler validate "\$mount_point\/FeedbackRecorder\.app"/);
});
