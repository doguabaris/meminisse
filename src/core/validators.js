/**
 * @file validators.js
 * @description Normalization and validation helpers for CLI inputs.
 *
 * @license MIT
 */
'use strict';

const { ATTACHMENT_KINDS, KINDS, MEMORY_TYPES, RECALL_MODES } = require('../constants');
const { normalizeText } = require('./utils');

/**
 * Validates and normalizes a memory kind.
 *
 * @param {string} kind - Raw memory kind.
 * @returns {string} Normalized kind.
 */
function normalizeKind(kind) {
  const normalized = normalizeText(kind).toLowerCase();
  if (!KINDS.has(normalized)) {
    throw new Error(`Unsupported kind: ${kind}. Use one of: ${[...KINDS].join(', ')}`);
  }
  return normalized;
}

/**
 * Normalizes a stored memory kind without failing on legacy data.
 *
 * @param {unknown} kind - Stored kind.
 * @returns {string} Supported kind.
 */
function normalizeStoredKind(kind) {
  const normalized = normalizeText(kind).toLowerCase();
  return KINDS.has(normalized) ? normalized : 'note';
}

/**
 * Validates and normalizes a memory scope.
 *
 * @param {string} scope - Raw scope.
 * @returns {'project' | 'global' | 'all'} Normalized scope.
 */
function normalizeScope(scope) {
  const normalized = normalizeText(scope).toLowerCase();
  if (!['project', 'global', 'all'].includes(normalized)) {
    throw new Error('Scope must be project, global, or all.');
  }
  return normalized;
}

/**
 * Validates and normalizes a memory type.
 *
 * @param {string} type - Raw memory type.
 * @returns {string} Normalized memory type.
 */
function normalizeMemoryType(type) {
  const normalized = normalizeText(type).toLowerCase();
  if (!MEMORY_TYPES.has(normalized)) {
    throw new Error(`Memory type must be one of: ${[...MEMORY_TYPES].join(', ')}`);
  }
  return normalized;
}

/**
 * Normalizes a stored memory type without failing on legacy data.
 *
 * @param {unknown} type - Stored memory type.
 * @returns {string} Supported memory type.
 */
function normalizeStoredMemoryType(type) {
  const normalized = normalizeText(type).toLowerCase();
  return MEMORY_TYPES.has(normalized) ? normalized : 'semantic';
}

/**
 * Validates and normalizes a boundary marker.
 *
 * @param {string} boundary - Raw boundary marker.
 * @returns {'soft' | 'hard'} Normalized boundary.
 */
function normalizeBoundary(boundary) {
  const normalized = normalizeText(boundary).toLowerCase();
  if (!['soft', 'hard'].includes(normalized)) {
    throw new Error('Boundary must be soft or hard.');
  }
  return normalized;
}

/**
 * Normalizes a stored boundary marker without failing on legacy data.
 *
 * @param {unknown} boundary - Stored boundary.
 * @returns {'soft' | 'hard'} Supported boundary.
 */
function normalizeStoredBoundary(boundary) {
  const normalized = normalizeText(boundary).toLowerCase();
  return normalized === 'hard' ? 'hard' : 'soft';
}

/**
 * Validates and normalizes confidence metadata.
 *
 * @param {string} confidence - Raw confidence value.
 * @returns {'low' | 'medium' | 'high'} Normalized confidence.
 */
function normalizeConfidence(confidence) {
  const normalized = normalizeText(confidence).toLowerCase();
  if (!['low', 'medium', 'high'].includes(normalized)) {
    throw new Error('Confidence must be low, medium, or high.');
  }
  return normalized;
}

/**
 * Normalizes stored confidence without failing on legacy data.
 *
 * @param {unknown} confidence - Stored confidence value.
 * @returns {'low' | 'medium' | 'high'} Supported confidence.
 */
function normalizeStoredConfidence(confidence) {
  const normalized = normalizeText(confidence).toLowerCase();
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : 'medium';
}

/**
 * Validates and normalizes lifecycle status.
 *
 * @param {string} status - Raw status value.
 * @returns {'active' | 'superseded' | 'deleted'} Normalized status.
 */
function normalizeStatus(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (!['active', 'superseded', 'deleted'].includes(normalized)) {
    throw new Error('Status must be active, superseded, or deleted.');
  }
  return normalized;
}

/**
 * Normalizes stored lifecycle status without failing on legacy data.
 *
 * @param {unknown} status - Stored status.
 * @returns {'active' | 'superseded' | 'deleted'} Supported status.
 */
function normalizeStoredStatus(status) {
  const normalized = normalizeText(status).toLowerCase();
  return ['active', 'superseded', 'deleted'].includes(normalized) ? normalized : 'active';
}

/**
 * Validates and normalizes list status filters.
 *
 * @param {string} status - Raw status filter.
 * @returns {'active' | 'superseded' | 'deleted' | 'all'} Normalized status filter.
 */
function normalizeStatusFilter(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === 'all') {
    return normalized;
  }

  return normalizeStatus(normalized);
}

/**
 * Validates and normalizes an attachment kind.
 *
 * @param {string} kind - Raw attachment kind.
 * @returns {'reference' | 'evidence' | 'brief' | 'asset' | 'note'} Normalized attachment kind.
 */
function normalizeAttachmentKind(kind) {
  const normalized = normalizeText(kind).toLowerCase();
  if (!ATTACHMENT_KINDS.has(normalized)) {
    throw new Error(`Attachment kind must be one of: ${[...ATTACHMENT_KINDS].join(', ')}`);
  }
  return normalized;
}

/**
 * Validates and normalizes recall output mode.
 *
 * @param {string} mode - Raw recall mode.
 * @returns {'summary' | 'full' | 'ids'} Normalized recall mode.
 */
function normalizeRecallMode(mode) {
  const normalized = normalizeText(mode).toLowerCase();
  if (!RECALL_MODES.has(normalized)) {
    throw new Error('Recall mode must be summary, full, or ids.');
  }
  return normalized;
}

module.exports = {
  normalizeAttachmentKind,
  normalizeBoundary,
  normalizeConfidence,
  normalizeKind,
  normalizeMemoryType,
  normalizeRecallMode,
  normalizeScope,
  normalizeStatus,
  normalizeStatusFilter,
  normalizeStoredBoundary,
  normalizeStoredConfidence,
  normalizeStoredKind,
  normalizeStoredMemoryType,
  normalizeStoredStatus,
};
