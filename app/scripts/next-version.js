'use strict';

const updates = require('../src/shared/updates');

const MINOR_LABELS = new Set(['enhancement', 'feature', 'version:minor', 'semver:minor']);
const PATCH_LABELS = new Set(['bug', 'documentation', 'version:patch', 'semver:patch']);

function currentVersion(value) {
  const match = String(value == null ? '' : value).match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/);
  const parsed = updates.parseVersion(match ? match[0] : '');
  if (!parsed) throw new Error(`Could not find a semantic version in "${value || ''}".`);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function classifyBump(options = {}) {
  const override = String(options.override || '').trim().toLowerCase();
  if (override) {
    if (!['minor', 'patch'].includes(override)) {
      throw new Error(`Version bump must be "minor" or "patch", not "${override}".`);
    }
    return { bump: override, reason: `manual ${override} selection` };
  }

  const labels = Array.isArray(options.labels)
    ? options.labels.map((label) => String(label).trim().toLowerCase())
    : [];

  const minor = labels.find((label) => MINOR_LABELS.has(label));
  if (minor) return { bump: 'minor', reason: `PR label "${minor}"` };

  const patch = labels.find((label) => PATCH_LABELS.has(label));
  if (patch) return { bump: 'patch', reason: `PR label "${patch}"` };

  const title = String(options.title || '').trim();
  if (/^(feat|feature)(\([^)]*\))?!?:/i.test(title)) {
    return { bump: 'minor', reason: 'feature-style PR title' };
  }

  return { bump: 'patch', reason: 'safe default for an unlabelled change' };
}

function bumpVersion(value, bump) {
  const current = currentVersion(value);
  const parsed = updates.parseVersion(current);
  if (bump === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  if (bump === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  throw new Error(`Version bump must be "minor" or "patch", not "${bump}".`);
}

function nextVersion(options = {}) {
  const current = currentVersion(options.current);
  const decision = classifyBump(options);
  return {
    current,
    version: bumpVersion(current, decision.bump),
    bump: decision.bump,
    reason: decision.reason
  };
}

function argumentsFrom(argv) {
  const options = { labels: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name.startsWith('--') || value === undefined) {
      throw new Error(`Expected --name value, received "${name}".`);
    }
    index += 1;

    if (name === '--current') options.current = value;
    else if (name === '--title') options.title = value;
    else if (name === '--override') options.override = value;
    else if (name === '--labels-json') {
      const labels = JSON.parse(value);
      if (!Array.isArray(labels)) throw new Error('--labels-json must contain a JSON array.');
      options.labels = labels;
    } else {
      throw new Error(`Unknown argument "${name}".`);
    }
  }
  return options;
}

if (require.main === module) {
  try {
    const result = nextVersion(argumentsFrom(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  MINOR_LABELS,
  PATCH_LABELS,
  currentVersion,
  classifyBump,
  bumpVersion,
  nextVersion,
  argumentsFrom
};
