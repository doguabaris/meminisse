/**
 * @file options.test.js
 * @description Boolean flag and positional delimiter regression tests.
 *
 * @license MIT
 */
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BOOLEAN_FLAGS } = require('../src/constants');
const { parseOptions } = require('../src/core/options');

test('all Boolean flags preserve explicit false and normalize explicit true', () => {
  for (const flag of BOOLEAN_FLAGS) {
    assert.equal(parseOptions([`--${flag}=false`]).opts[flag], false);
    assert.equal(parseOptions([`--${flag}=true`]).opts[flag], true);
    assert.equal(parseOptions([`--${flag}`]).opts[flag], true);
  }
});

test('Boolean flags reject ambiguous values before a command can mutate data', () => {
  for (const flag of ['move', 'force', 'prune', 'allow-secret']) {
    for (const value of ['', '0', '1', 'yes', 'no']) {
      assert.throws(() => parseOptions([`--${flag}=${value}`]), /must be true or false/);
    }
  }
});

test('the positional delimiter preserves text and filenames beginning with flags', () => {
  assert.deepEqual(parseOptions(['--move=false', '--', '--file.txt', '--kind=asset']), {
    opts: { move: false },
    rest: ['--file.txt', '--kind=asset'],
  });
});
