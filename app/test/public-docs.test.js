'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..', '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const IMAGE_DIR = path.join(ROOT, 'docs', 'images');

function pngDimensions(file) {
  const bytes = fs.readFileSync(file);
  assert.strictEqual(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${file} must be a PNG`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bytes: bytes.length
  };
}

function relativeLinks(markdown) {
  return Array.from(markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g))
    .map((match) => match[1])
    .filter((target) => !/^(?:https?:|mailto:|#)/.test(target));
}

function anchors(markdown) {
  return new Set(
    Array.from(markdown.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) =>
      match[1]
        .replace(/[`*_]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
    )
  );
}

test('README has one GitHub-hosted workflow badge and explicit image presentation', () => {
  const badges = Array.from(README.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)).map((match) => match[1]);
  assert.deepStrictEqual(badges, [
    'https://github.com/magnuslandahl/FeedbackRecorder/actions/workflows/ci.yml/badge.svg'
  ]);
  assert.match(README, /^## Installing$/m, 'release notes rely on the #installing anchor');

  const images = Array.from(README.matchAll(/<img\s+([^>]+)>/g)).map((match) => match[1]);
  assert.ok(images.length >= 4);
  images.forEach((attributes) => {
    assert.match(attributes, /\balt="[^"]+"/, 'every image needs descriptive alt text');
    assert.match(attributes, /\bwidth="\d+"/, 'every image needs an explicit displayed width');
  });
});

test('all local Markdown links and image paths in public docs resolve', () => {
  const files = ['README.md', 'docs/GETTING_STARTED.md', 'docs/USER_GUIDE.md'];
  files.forEach((name) => {
    const full = path.join(ROOT, name);
    const source = fs.readFileSync(full, 'utf8');
    relativeLinks(source).forEach((target) => {
      const [filePart, fragment] = target.split('#');
      if (!filePart) return;
      const linked = path.resolve(path.dirname(full), filePart);
      assert.ok(fs.existsSync(linked), `${name} links to missing ${target}`);
      if (fragment && linked.endsWith('.md')) {
        assert.ok(
          anchors(fs.readFileSync(linked, 'utf8')).has(fragment),
          `${name} links to missing anchor ${target}`
        );
      }
    });

    Array.from(source.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)).forEach((match) => {
      assert.ok(anchors(source).has(match[1]), `${name} links to missing #${match[1]}`);
    });
  });

  Array.from(README.matchAll(/<img[^>]+src="([^"]+)"/g)).forEach((match) => {
    assert.ok(fs.existsSync(path.join(ROOT, match[1])), `README image is missing: ${match[1]}`);
  });
});

test('curated public assets have the expected dimensions and stay compact', () => {
  const expected = {
    'recording-controller.png': [470, 72],
    'framing-region.png': [720, 960],
    'handoff-with-comments.png': [720, 960],
    'social-preview.png': [1280, 640]
  };
  let total = 0;
  Object.entries(expected).forEach(([name, [width, height]]) => {
    const dimensions = pngDimensions(path.join(IMAGE_DIR, name));
    assert.deepStrictEqual(
      [dimensions.width, dimensions.height],
      [width, height],
      `${name} dimensions`
    );
    assert.ok(dimensions.bytes < 1_000_000, `${name} must stay below 1 MB`);
    total += dimensions.bytes;
  });
  assert.ok(total < 1_100_000, `curated screenshot set is ${total} bytes`);
});

test('issue forms warn about sensitive data and route vulnerabilities privately', () => {
  const issueDir = path.join(ROOT, '.github', 'ISSUE_TEMPLATE');
  const bugSource = fs.readFileSync(path.join(issueDir, 'bug_report.yml'), 'utf8');
  const featureSource = fs.readFileSync(path.join(issueDir, 'feature_request.yml'), 'utf8');
  const config = yaml.load(fs.readFileSync(path.join(issueDir, 'config.yml'), 'utf8'));

  ['run.json', 'recordings', 'transcripts', 'credentials', 'local absolute paths', 'private screenshots']
    .forEach((term) => {
      assert.match(bugSource, new RegExp(term.replace('.', '\\.'), 'i'));
      assert.match(featureSource, new RegExp(term.replace('.', '\\.'), 'i'));
    });
  assert.match(bugSource, /--selftest/);
  assert.match(bugSource, /architecture/i);
  assert.strictEqual(config.blank_issues_enabled, false);
  assert.ok(
    config.contact_links.some((link) =>
      link.url.endsWith('/security/advisories/new')
    )
  );
});

test('public docs describe local processing without making absolute network claims', () => {
  const source = [
    README,
    fs.readFileSync(path.join(ROOT, 'docs', 'GETTING_STARTED.md'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'docs', 'USER_GUIDE.md'), 'utf8')
  ].join('\n');

  assert.match(source, /processed and stored locally/i);
  assert.match(source, /contacts GitHub for update metadata/i);
  assert.match(source, /default\s+zip excludes the raw video and your recorded voice/i);
  assert.doesNotMatch(source, /nothing is uploaded anywhere/i);
  assert.doesNotMatch(source, /(?:is|are|guarantees?) (?:malware[- ]free|audited|zero[- ]risk)/i);
  assert.doesNotMatch(source, /run\.json\s+(?:is|remains)\s+safe to (?:post|share)/i);
});
