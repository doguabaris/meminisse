/**
 * @file options.js
 * @description CLI option parsing helpers.
 *
 * @license MIT
 */
'use strict';

const { BOOLEAN_FLAGS } = require('../constants');

/**
 * Parses long-form CLI flags and positional arguments.
 *
 * @param {string[]} args - Raw command arguments after the command name.
 * @returns {{ opts: Record<string, string | boolean>, rest: string[] }} Parsed options and remaining arguments.
 */
function parseOptions(args) {
  const opts = {};
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    if (eq !== -1) {
      const key = arg.slice(2, eq);
      const value = arg.slice(eq + 1);
      if (BOOLEAN_FLAGS.has(key)) {
        if (value !== 'true' && value !== 'false') {
          throw new Error(`Option --${key} must be true or false.`);
        }
        opts[key] = value === 'true';
      } else {
        opts[key] = value;
      }
      continue;
    }

    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      opts[key] = true;
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }

  return { opts, rest };
}

module.exports = {
  parseOptions,
};
