/**
 * @file secrets.js
 * @description Secret detection helpers for memory text and attachments.
 *
 * @license MIT
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const SECRET_PATTERNS = [
  { name: 'private key block', pattern: /-----BEGIN [A-Z0-9 ]*(?:PRIVATE|OPENSSH) KEY-----/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'AWS temporary access key', pattern: /\bASIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI API key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'Stripe secret key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'credential URL', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/]+:[^@\s]+@/i },
  {
    name: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'dotenv credential assignment',
    pattern:
      /\b(database_url|redis_url|mongo_uri|mongodb_uri|postgres_url|mysql_url|dsn)\b['"]?\s*[:=]\s*['"]?[^'"\s]{12,}/i,
  },
  {
    name: 'secret assignment',
    pattern:
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|token|password|passwd|pwd|private[_-]?key)\b['"]?\s*[:=]\s*['"]?[^'"\s]{12,}/i,
  },
];

/**
 * Detects likely secrets before durable memory is written.
 *
 * @param {string} text - Memory body text.
 * @param {{ pathValues?: boolean }} options - Whether text is a filesystem path.
 * @returns {string | undefined} Matched secret type.
 */
function detectSecret(text, options = {}) {
  const patternMatch = SECRET_PATTERNS.find((pattern) => pattern.pattern.test(text));
  if (patternMatch) {
    return patternMatch.name;
  }

  // Slashes delimit path components; treating a whole path as a Base64 token
  // incorrectly flags ordinary temporary directory names as high entropy.
  const parts = options.pathValues ? String(text).split(/[\\/]/) : [text];
  return parts.map(detectHighEntropySecret).find(Boolean);
}

/**
 * Checks all text values that will be persisted, including nested metadata.
 * Error messages identify the pattern without echoing sensitive values.
 *
 * @param {unknown} value - Text, array, or object to inspect.
 * @param {boolean} allowSecret - Whether intentional test data is permitted.
 * @param {{ pathValues?: boolean }} options - How to inspect text values.
 * @returns {void}
 */
function assertNoSecrets(value, allowSecret = false, options = {}) {
  if (allowSecret) return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecrets(item, false, options);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) assertNoSecrets(item, false, options);
  } else if (typeof value === 'string') {
    const secret = detectSecret(value, options);
    if (secret) {
      throw new Error(
        `Possible ${secret} detected. Refusing to store it. Remove the secret or pass --allow-secret if this is intentionally non-sensitive.`,
      );
    }
  }
}

/**
 * Detects likely secrets before an attachment is copied into memory storage.
 *
 * @param {string} filePath - Attachment source path.
 * @param {Set<string>} textExtensions - Extensions that are safe to read as text.
 * @returns {string | undefined} Matched secret type.
 */
function detectAttachmentSecret(filePath, textExtensions) {
  const baseName = path.basename(filePath).toLowerCase();
  if (/^\.env(?:\.|$)/.test(baseName)) {
    return 'dotenv file';
  }

  if (!textExtensions.has(path.extname(filePath).toLowerCase()) && !isTextFile(filePath)) {
    return undefined;
  }

  return detectSecret(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Recognizes UTF-8 text independently of its filename, including PEM, config,
 * and extensionless credential files. Binary attachments remain supported.
 *
 * @param {string} filePath - Attachment source path.
 * @returns {boolean} Whether a bounded prefix looks like UTF-8 text.
 */
function isTextFile(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, length);
    if (prefix.includes(0)) return false;
    for (const byte of prefix) {
      if (byte < 32 && ![9, 10, 12, 13, 27].includes(byte)) return false;
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(prefix, { stream: length === buffer.length });
      return true;
    } catch {
      return false;
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Finds opaque high-entropy tokens that do not match a known provider regex.
 *
 * @param {string} text - Text to scan.
 * @returns {string | undefined} Secret type when a suspicious token is found.
 */
function detectHighEntropySecret(text) {
  const candidates = String(text).match(/[A-Za-z0-9+/=_-]{24,}/g) || [];
  for (const candidate of candidates) {
    if (looksLikeIdentifier(candidate)) {
      continue;
    }

    if (characterClassCount(candidate) >= 3 && shannonEntropy(candidate) >= 4.2) {
      return 'high-entropy token';
    }
  }

  return undefined;
}

/**
 * Avoids flagging ordinary long words or IDs with low character diversity.
 *
 * @param {string} value - Candidate token.
 * @returns {boolean} Whether the token looks like a benign identifier.
 */
function looksLikeIdentifier(value) {
  return /^[a-z0-9_-]+$/i.test(value) && characterClassCount(value) < 3;
}

/**
 * Counts broad character classes present in a string.
 *
 * @param {string} value - Candidate token.
 * @returns {number} Character class count.
 */
function characterClassCount(value) {
  return [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[+/=_-]/.test(value),
  ].filter(Boolean).length;
}

/**
 * Calculates Shannon entropy for a candidate token.
 *
 * @param {string} value - Candidate token.
 * @returns {number} Entropy bits per character.
 */
function shannonEntropy(value) {
  const counts = new Map();
  for (const char of value) {
    counts.set(char, (counts.get(char) || 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

module.exports = {
  assertNoSecrets,
  detectAttachmentSecret,
  detectSecret,
};
