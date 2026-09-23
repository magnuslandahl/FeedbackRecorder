'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUNDLE_ID = 'com.feedbackrecorder.app';
const TCC_SERVICES = ['ScreenCapture', 'Microphone', 'Accessibility', 'ListenEvent'];

function appBundleFromExecutable(executable) {
  let current = path.resolve(String(executable || ''));
  while (current && current !== path.dirname(current)) {
    if (current.endsWith('.app')) return current;
    current = path.dirname(current);
  }
  return null;
}

function commandText(result) {
  return `${(result && result.stdout) || ''}\n${(result && result.stderr) || ''}`;
}

// `codesign --display` writes to stderr on some macOS versions and stdout on
// others. Reading both keeps the identity check independent of that detail.
function designatedRequirement(bundle, run) {
  if (!bundle) return '';
  const execute = run || spawnSync;
  const result = execute('/usr/bin/codesign', ['--display', '-r', '-', bundle], {
    encoding: 'utf8',
    timeout: 60000
  });
  if (!result || result.error || result.status !== 0) return '';

  const line = commandText(result)
    .split('\n')
    .map((item) => item.replace(/^#\s*/, '').trim())
    .find((item) => item.startsWith('designated =>'));
  return line || '';
}

function describeIdentity(bundle, run) {
  const requirement = designatedRequirement(bundle, run);
  if (!requirement) return { kind: 'unknown', stable: false, requirement: '' };
  const stable = !/\bcdhash\b/i.test(requirement);
  return {
    kind: stable ? 'certificate' : 'ad-hoc',
    stable,
    requirement
  };
}

// Scoped to this bundle identifier. Never reset a whole privacy service: that
// would revoke grants belonging to unrelated applications on the same Mac.
function reset(bundleId, run) {
  const execute = run || spawnSync;
  const id = String(bundleId || BUNDLE_ID);
  const cleared = [];
  const failures = [];

  TCC_SERVICES.forEach((service) => {
    const result = execute('/usr/bin/tccutil', ['reset', service, id], {
      encoding: 'utf8',
      timeout: 10000
    });
    if (result && !result.error && result.status === 0) {
      cleared.push(service);
      return;
    }
    failures.push({
      service,
      reason:
        (result && result.error && result.error.message) ||
        commandText(result).trim() ||
        `tccutil exited with ${result && result.status}`
    });
  });

  return { bundleId: id, cleared, failures };
}

module.exports = {
  BUNDLE_ID,
  TCC_SERVICES,
  appBundleFromExecutable,
  designatedRequirement,
  describeIdentity,
  reset
};
