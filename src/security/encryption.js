/**
 * @file encryption.js
 * @description AES-GCM at-rest encryption helpers for memory JSONL records.
 *
 * @license MIT
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_ENCRYPTION_KEY_ENV,
  ENCRYPTION_CONFIG_FILE,
  MEMORY_SCHEMA_VERSION,
} = require('../constants');
const { ensureDir } = require('../system/paths');

/**
 * Reads enabled encryption config for a memory root.
 *
 * @param {string} root - Memory root directory.
 * @returns {object | undefined} Encryption config.
 */
function readEncryptionConfig(root) {
  const configPath = path.join(root, ENCRYPTION_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return config && config.enabled ? config : undefined;
}

/**
 * Writes encryption config for a memory root.
 *
 * @param {string} root - Memory root directory.
 * @param {object} config - Encryption config.
 * @returns {void}
 */
function writeEncryptionConfig(root, config) {
  ensureDir(root);
  fs.writeFileSync(
    path.join(root, ENCRYPTION_CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Creates encryption config without storing secret key material.
 *
 * @param {string} keyEnv - Environment variable containing the key.
 * @returns {object} Encryption config.
 */
function createEncryptionConfig(keyEnv = DEFAULT_ENCRYPTION_KEY_ENV) {
  const now = new Date().toISOString();
  return {
    schema_version: MEMORY_SCHEMA_VERSION,
    enabled: true,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: crypto.randomBytes(16).toString('base64'),
    key_env: keyEnv,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Encrypts one memory record into an AES-GCM envelope.
 *
 * @param {object} record - Plain memory record.
 * @param {object} config - Encryption config.
 * @returns {object} Encrypted envelope.
 */
function encryptRecord(record, config) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveEncryptionKey(config), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), 'utf8'),
    cipher.final(),
  ]);

  return {
    schema_version: MEMORY_SCHEMA_VERSION,
    encrypted: true,
    algorithm: config.algorithm,
    key_env: config.key_env,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/**
 * Decrypts one encrypted memory envelope.
 *
 * @param {string} root - Memory root directory.
 * @param {object} envelope - Encrypted envelope.
 * @returns {object} Plain memory record.
 */
function decryptRecord(root, envelope) {
  const config = readEncryptionConfig(root);
  if (!config || !config.enabled) {
    throw new Error(`Encrypted memory requires ${ENCRYPTION_CONFIG_FILE} in ${root}`);
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveEncryptionKey(config),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * Serializes a memory record as plaintext or encrypted JSONL.
 *
 * @param {string} root - Memory root directory.
 * @param {object} record - Memory record.
 * @returns {string} JSONL line.
 */
function serializeStoredRecord(root, record) {
  const config = readEncryptionConfig(root);
  if (config && config.enabled) {
    return JSON.stringify(encryptRecord(record, config));
  }

  return JSON.stringify(record);
}

/**
 * Parses one plaintext or encrypted JSONL line.
 *
 * @param {string} root - Memory root directory.
 * @param {string} line - JSONL line.
 * @param {(record: object) => object} normalize - Record normalizer.
 * @returns {object} Parsed memory record.
 */
function parseStoredRecord(root, line, normalize) {
  const parsed = JSON.parse(line);
  if (parsed && parsed.encrypted === true) {
    return normalize(decryptRecord(root, parsed));
  }

  return normalize(parsed);
}

/**
 * Reads and validates the encryption key from an environment variable.
 *
 * @param {string} keyEnv - Environment variable name.
 * @returns {string} Encryption passphrase.
 */
function requireEncryptionKey(keyEnv) {
  const secret = process.env[keyEnv];
  if (!secret) {
    throw new Error(`Encryption requires ${keyEnv} to be set in the environment.`);
  }

  if (secret.length < 16) {
    throw new Error(`${keyEnv} must contain at least 16 characters.`);
  }

  return secret;
}

/**
 * Derives a 32-byte AES key from the configured passphrase.
 *
 * @param {object} config - Encryption config.
 * @returns {Buffer} Derived AES key.
 */
function deriveEncryptionKey(config) {
  const secret = requireEncryptionKey(config.key_env);
  return crypto.scryptSync(secret, Buffer.from(config.salt, 'base64'), 32);
}

module.exports = {
  createEncryptionConfig,
  parseStoredRecord,
  readEncryptionConfig,
  requireEncryptionKey,
  serializeStoredRecord,
  writeEncryptionConfig,
};
