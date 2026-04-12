/**
 * @file utils.js
 * @description Small shared utility functions for Meminisse.
 *
 * @license MIT
 */
'use strict';

const crypto = require('crypto');

/**
 * Normalizes arbitrary input into trimmed text.
 *
 * @param {unknown} value - Value to stringify and trim.
 * @returns {string} Normalized text.
 */
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * Splits a comma-delimited CLI option into a list.
 *
 * @param {string | boolean | undefined} value - Raw option value.
 * @returns {string[]} Parsed list.
 */
function splitList(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Splits positional arguments that may contain comma-delimited values.
 *
 * @param {string[]} values - Positional CLI arguments.
 * @returns {string[]} Parsed values.
 */
function splitArgsList(values) {
  return values.flatMap((value) => splitList(value));
}

/**
 * Normalizes a stored value into a string list.
 *
 * @param {unknown} value - Stored value.
 * @returns {string[]} String list.
 */
function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return uniqueArray(value.map(normalizeText).filter(Boolean));
  }

  const text = normalizeText(value);
  return text ? [text] : [];
}

/**
 * Parses a positive integer option with fallback.
 *
 * @param {unknown} value - Raw numeric value.
 * @param {number} fallback - Fallback number.
 * @returns {number} Parsed positive integer or fallback.
 */
function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Parses a non-negative integer with zero fallback.
 *
 * @param {unknown} value - Raw numeric value.
 * @returns {number} Parsed non-negative integer.
 */
function toNonNegativeInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Creates a deterministic short ID with a date prefix.
 *
 * @param {string} prefix - ID namespace prefix.
 * @param {string} value - Value to hash.
 * @returns {string} Generated ID.
 */
function makeId(prefix, value) {
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
  return `${prefix}_${dayStamp(new Date().toISOString())}_${hash}`;
}

/**
 * Converts an ISO date string to YYYYMMDD.
 *
 * @param {string} isoDate - ISO date string.
 * @returns {string} Date stamp.
 */
function dayStamp(isoDate) {
  return isoDate.slice(0, 10).replace(/-/g, '');
}

/**
 * Produces a short single-line summary from longer memory text.
 *
 * @param {string} text - Full memory text.
 * @returns {string} Summary text.
 */
function summarize(text) {
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}...` : firstSentence;
}

/**
 * Creates a stable content hash for duplicate detection.
 *
 * @param {string} kind - Memory kind.
 * @param {string} body - Memory body text.
 * @returns {string} SHA-1 content hash.
 */
function contentHash(kind, body) {
  return crypto
    .createHash('sha1')
    .update(`${kind}:${normalizeForHash(body)}`)
    .digest('hex');
}

/**
 * Normalizes text for stable duplicate checks.
 *
 * @param {string} text - Raw text.
 * @returns {string} Normalized text.
 */
function normalizeForHash(text) {
  return normalizeText(text).replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Capitalizes a display label.
 *
 * @param {string} value - Raw label.
 * @returns {string} Title-cased label.
 */
function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Returns a de-duplicated copy of an array while preserving order.
 *
 * @template T
 * @param {T[]} values - Values to de-duplicate.
 * @returns {T[]} Unique values.
 */
function uniqueArray(values) {
  return [...new Set(values)];
}

/**
 * Groups a list of items by a derived key.
 *
 * @template T
 * @param {T[]} items - Items to group.
 * @param {(item: T) => string} getter - Function that returns the group key.
 * @returns {Map<string, T[]>} Grouped items.
 */
function groupBy(items, getter) {
  const groups = new Map();
  for (const item of items) {
    const key = getter(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/**
 * Counts a list of items by a derived key.
 *
 * @template T
 * @param {T[]} items - Items to count.
 * @param {(item: T) => string} getter - Function that returns the count key.
 * @returns {Map<string, number>} Count map.
 */
function countBy(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const key = getter(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

module.exports = {
  contentHash,
  countBy,
  dayStamp,
  groupBy,
  makeId,
  normalizeForHash,
  normalizeStringArray,
  normalizeText,
  splitArgsList,
  splitList,
  summarize,
  titleCase,
  toNonNegativeInt,
  toPositiveInt,
  uniqueArray,
};
