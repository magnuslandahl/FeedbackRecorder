'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

// The disk image is built on macOS, by a release run, from a machine none of
// this can reach. What can be checked anywhere is that the pieces it is told to
// assemble are actually there and say what they need to say.
//
// The failure this guards is quiet: rename or move the instructions and the
// build either fails in a release, or ships a disk image that tells a new user
// nothing while macOS tells them the app cannot be opened.

const APP_DIR = path.join(__dirname, '..');
const config = yaml.load(fs.readFileSync(path.join(APP_DIR, 'electron-builder.yml'), 'utf8'));
const contents = (config.dmg && config.dmg.contents) || [];

function entryNamed(fragment) {
  return contents.find((item) => {
    const name = String(item.name || '');
    const target = String(item.path || '');
    return name.includes(fragment) || target.includes(fragment);
  });
}

test('the disk image offers the app and somewhere to drag it', () => {
  // Naming contents at all replaces electron-builder's default layout, so
  // forgetting either of these produces a disk image you cannot install from.
  const app = contents.find((item) => String(item.name || '').endsWith('.app'));
  const applications = contents.find((item) => item.path === '/Applications');

  assert.ok(app, 'the app itself must be in the disk image');
  assert.ok(applications, 'there must be an Applications folder to drag it onto');
  assert.strictEqual(applications.type, 'link', 'Applications has to be a link, not a copy');
});

test('the disk image carries instructions for opening the app', () => {
  const readme = entryNamed('.txt');
  assert.ok(readme, 'macOS refuses this app on first run; the disk image has to say so');
  assert.strictEqual(readme.type, 'file');
  assert.ok(
    !path.isAbsolute(readme.path),
    'an absolute path is rejected by electron-builder unless it is inside the workspace root'
  );

  const full = path.join(APP_DIR, readme.path);
  assert.ok(fs.existsSync(full), `${readme.path} is named in electron-builder.yml but is not there`);
});

test('every file the disk image names is really there', () => {
  contents
    .filter((item) => item.type === 'file' && item.path)
    .forEach((item) => {
      assert.ok(
        fs.existsSync(path.join(APP_DIR, item.path)),
        `${item.path} is listed in dmg.contents but does not exist`
      );
    });
});

test('the instructions cover what macOS actually does', () => {
  const readme = entryNamed('.txt');
  const text = fs.readFileSync(path.join(APP_DIR, readme.path), 'utf8');

  // Each of these is a way somebody gets stuck, and each is here because
  // leaving it out has a specific, known consequence.
  const required = [
    // Apple removed Control-click to open in macOS 15. Sending people there
    // first is sending them somewhere that no longer works.
    ['Privacy & Security', 'the only route that works on macOS 15 and later'],
    ['Open Anyway', 'the button they are looking for, by name'],
    // The button only appears after a blocked launch.
    ['Done', 'the first refusal has to be dismissed before the button appears'],
    ['xattr -dr com.apple.quarantine', 'the one-line alternative, for people who prefer it'],
    // A user who is told the app is damaged will otherwise throw it away.
    ['damaged', 'the misleading message that makes people trash the app'],
    ['arm64', 'the wrong download produces the same symptom'],
    ['Screen Recording', 'the app is useless without it and it needs a restart']
  ];

  required.forEach(([fragment, why]) => {
    assert.ok(text.includes(fragment), `the instructions should mention "${fragment}" — ${why}`);
  });
});

test('the instructions do not tell anybody to disable Gatekeeper', () => {
  const readme = entryNamed('.txt');
  const text = fs.readFileSync(path.join(APP_DIR, readme.path), 'utf8');

  // spctl --master-disable turns the check off for every app on the machine,
  // permanently. It appears in a lot of advice on the internet, it is being
  // removed by Apple, and it is not a thing to ask of somebody who just wanted
  // to record their screen. The file may name it, but only to warn against it.
  const mentions = text.includes('master-disable');
  const warns = /Do not use "sudo spctl --master-disable"/.test(text);
  assert.ok(!mentions || warns, 'master-disable may only appear as a warning against it');

  assert.ok(
    !/sudo xattr/.test(text),
    'clearing quarantine on your own app needs no sudo, and asking for a password teaches a bad habit'
  );
});
