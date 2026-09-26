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
