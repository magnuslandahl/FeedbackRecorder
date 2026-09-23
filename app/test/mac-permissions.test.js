'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const macPermissions = require('../src/main/mac-permissions');

test('an executable path resolves to its enclosing app bundle', () => {
  const bundle = path.resolve(path.sep, 'Applications', 'FeedbackRecorder.app');
  assert.strictEqual(
    macPermissions.appBundleFromExecutable(
      path.join(bundle, 'Contents', 'MacOS', 'FeedbackRecorder')
    ),
    bundle
  );
  assert.strictEqual(
    macPermissions.appBundleFromExecutable(
      path.resolve(path.sep, 'usr', 'local', 'bin', 'feedback-recorder')
    ),
    null
  );
});

test('an ad-hoc designated requirement is build-specific', () => {
  const identity = macPermissions.describeIdentity('/tmp/FeedbackRecorder.app', () => ({
    status: 0,
    stdout: '',
    stderr: '# designated => cdhash H"0123456789"\n'
  }));
  assert.strictEqual(identity.kind, 'ad-hoc');
  assert.strictEqual(identity.stable, false);
});

test('a certificate-pinned designated requirement is stable', () => {
  const identity = macPermissions.describeIdentity('/tmp/FeedbackRecorder.app', () => ({
    status: 0,
    stdout:
      'designated => identifier "com.feedbackrecorder.app" and certificate root = H"abcdef"\n',
    stderr: ''
  }));
  assert.strictEqual(identity.kind, 'certificate');
  assert.strictEqual(identity.stable, true);
});

test('permission cleanup is scoped to this app and all four TCC services', () => {
  const calls = [];
  const result = macPermissions.reset(undefined, (command, args) => {
    calls.push([command, args]);
    return { status: args[1] === 'ListenEvent' ? 1 : 0, stdout: '', stderr: 'refused' };
  });

  assert.deepStrictEqual(
    calls.map((call) => call[1]),
    macPermissions.TCC_SERVICES.map((service) => [
      'reset',
      service,
      macPermissions.BUNDLE_ID
    ])
  );
  assert.deepStrictEqual(result.cleared, ['ScreenCapture', 'Microphone', 'Accessibility']);
  assert.deepStrictEqual(result.failures.map((failure) => failure.service), ['ListenEvent']);
});
