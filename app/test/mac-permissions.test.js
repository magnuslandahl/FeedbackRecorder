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

test('a Developer ID bundle reports its Apple Team ID', () => {
  const calls = [];
  const team = macPermissions.teamIdentifier('/tmp/FeedbackRecorder.app', (command, args) => {
    calls.push([command, args]);
    return {
      status: 0,
      stdout: '',
      stderr:
        'Authority=Developer ID Application: Example AB (59Z36F33H8)\n' +
        'Authority=Developer ID Certification Authority\n' +
        'TeamIdentifier=59Z36F33H8\n'
    };
  });
  assert.strictEqual(team, '59Z36F33H8');
  assert.deepStrictEqual(calls[0], [
    '/usr/bin/codesign',
    ['--display', '--verbose=2', '/tmp/FeedbackRecorder.app']
  ]);
});

test('ad-hoc, unreadable and malformed signatures have no Team ID', () => {
  const reply = (stderr, status = 0) => () => ({ status, stdout: '', stderr });
  assert.strictEqual(
    macPermissions.teamIdentifier('/tmp/A.app', reply('Signature=adhoc\nTeamIdentifier=not set\n')),
    ''
  );
  assert.strictEqual(macPermissions.teamIdentifier('/tmp/A.app', reply('', 1)), '');
  assert.strictEqual(
    macPermissions.teamIdentifier('/tmp/A.app', reply('TeamIdentifier=59Z36F33H8" or true\n')),
    ''
  );
  assert.strictEqual(macPermissions.teamIdentifier('', reply('TeamIdentifier=59Z36F33H8\n')), '');
});

test('an update is verified against the running copy’s team only when it has one', () => {
  assert.deepStrictEqual(macPermissions.verifyArguments('/tmp/New.app', ''), [
    '--verify',
    '--deep',
    '--strict',
    '/tmp/New.app'
  ]);
  assert.deepStrictEqual(macPermissions.verifyArguments('/tmp/New.app', '59Z36F33H8'), [
    '--verify',
    '--deep',
    '--strict',
    '-R',
    '=anchor apple generic and certificate leaf[subject.OU] = "59Z36F33H8"',
    '/tmp/New.app'
  ]);
  assert.throws(() => macPermissions.teamRequirement('59Z36F33H8" or anchor trusted'));
});
