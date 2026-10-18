'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUNDLE_ID = 'com.feedbackrecorder.app';
const TCC_SERVICES = ['ScreenCapture', 'Microphone', 'Accessibility', 'ListenEvent'];
const TEAM_ID = /^[A-Z0-9]{10}$/;

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

// The Apple Team ID a bundle is signed by, or '' when it has none. Ad-hoc and
// self-signed bundles report `TeamIdentifier=not set`.
function teamIdentifier(bundle, run) {
  if (!bundle) return '';
  const execute = run || spawnSync;
  const result = execute('/usr/bin/codesign', ['--display', '--verbose=2', bundle], {
    encoding: 'utf8',
    timeout: 60000
  });
  if (!result || result.error || result.status !== 0) return '';

  const match = commandText(result).match(/^TeamIdentifier=(\S+)\s*$/m);
  const team = match ? match[1] : '';
  return TEAM_ID.test(team) ? team : '';
}

// The TeamIdentifier line is only what the signature claims. This requirement
// makes codesign prove it: an Apple-issued certificate chain whose leaf belongs
// to that team.
function teamRequirement(team) {
  if (!TEAM_ID.test(String(team || ''))) throw new Error(`not an Apple Team ID: ${team}`);
  return `anchor apple generic and certificate leaf[subject.OU] = "${team}"`;
}

// Arguments for checking a bundle's signature, pinned to a team when one is
// given. Without a team this is the plain validity check an ad-hoc copy can
// pass, which is what lets such a copy take its first Developer ID update.
function verifyArguments(bundle, team) {
  const args = ['--verify', '--deep', '--strict'];
  if (team) args.push('-R', `=${teamRequirement(team)}`);
  args.push(bundle);
  return args;
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
  teamIdentifier,
  teamRequirement,
  verifyArguments,
  reset
};
