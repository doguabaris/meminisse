/**
 * @file recall.js
 * @description Tokenization, extraction, and BM25-style recall scoring.
 *
 * @license MIT
 */
'use strict';

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'what',
  'when',
  'where',
  'which',
  'about',
  'have',
  'has',
  'had',
  'are',
  'was',
  'were',
  'use',
  'uses',
  'using',
  'used',
  'user',
  'task',
  'work',
  'after',
  'before',
  'start',
  'stop',
  'run',
  'runs',
  'ran',
  'will',
  'would',
  'could',
  'should',
]);

/**
 * Builds corpus statistics used by BM25-style recall scoring.
 *
 * @param {object[]} records - Active records in the recall corpus.
 * @returns {{ size: number, docFrequency: Map<string, number>, averageFieldLengths: Map<string, number> }} Corpus stats.
 */
function buildRecallCorpus(records) {
  const docFrequency = new Map();
  const fieldLengths = new Map();
  const fields = ['summary', 'body', 'tags', 'entities', 'paths'];

  for (const field of fields) {
    fieldLengths.set(field, 0);
  }

  for (const record of records) {
    const recordFields = recallFields(record);
    const seen = new Set();

    for (const field of fields) {
      const tokens = recordFields[field];
      fieldLengths.set(field, fieldLengths.get(field) + tokens.length);
      for (const token of new Set(tokens)) {
        seen.add(token);
      }
    }

    for (const token of seen) {
      docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
    }
  }

  return {
    size: Math.max(records.length, 1),
    docFrequency,
    averageFieldLengths: new Map(
      fields.map((field) => [
        field,
        Math.max(fieldLengths.get(field) / Math.max(records.length, 1), 1),
      ]),
    ),
  };
}

/**
 * Calculates a relevance score for a memory record and query.
 *
 * @param {object} record - The memory record to score.
 * @param {string} query - The recall query.
 * @param {{ size: number, docFrequency: Map<string, number>, averageFieldLengths: Map<string, number> }} corpus - Corpus stats.
 * @returns {number} A positive score for relevant records, or zero for no match.
 */
function scoreRecord(record, query, corpus) {
  const queryTokens = uniqueArray(tokenize(query));
  if (queryTokens.length === 0) {
    return 0;
  }

  const fields = recallFields(record);
  let lexicalScore = 0;
  lexicalScore += bm25FieldScore(queryTokens, fields.summary, corpus, 'summary') * 3;
  lexicalScore += bm25FieldScore(queryTokens, fields.body, corpus, 'body');
  lexicalScore += bm25FieldScore(queryTokens, fields.tags, corpus, 'tags') * 4;
  lexicalScore += bm25FieldScore(queryTokens, fields.entities, corpus, 'entities') * 2;
  lexicalScore += bm25FieldScore(queryTokens, fields.paths, corpus, 'paths') * 2.5;
  lexicalScore += phraseScore(queryTokens, fields) * 2;

  if (lexicalScore <= 0) {
    return 0;
  }

  const matchedTokens = queryTokens.filter((token) =>
    Object.values(fields).some((tokens) => tokens.includes(token)),
  );
  const coverageScore = matchedTokens.length / queryTokens.length;
  let score = lexicalScore + coverageScore * 2;

  if (record.status === 'active') score += 0.5;
  if (record.confidence === 'high') score += 0.5;
  if (record.kind === 'decision') score += 0.4;
  score += recencyScore(record.updated_at || record.created_at) * 0.25;
  return formatScore(score);
}

/**
 * Converts text into normalized retrieval tokens.
 *
 * @param {string} text - Input text to tokenize.
 * @returns {string[]} Retrieval tokens.
 */
function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

/**
 * Extracts low-noise tags from memory body text.
 *
 * @param {string} text - Memory body text.
 * @returns {string[]} Derived tags.
 */
function extractTags(text) {
  const tokens = tokenize(text);
  const tags = [];
  for (const token of tokens) {
    if (token.includes('/') || token.includes('.')) continue;
    tags.push(token);
  }
  return uniqueArray(tags).slice(0, 12);
}

/**
 * Extracts simple capitalized entity candidates from memory body text.
 *
 * @param {string} text - Memory body text.
 * @returns {string[]} Derived entity names.
 */
function extractEntities(text) {
  const matches = normalizeText(text).match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || [];
  return uniqueArray(matches).slice(0, 12);
}

/**
 * Extracts filesystem-like path cues from memory body text.
 *
 * @param {string} text - Memory body text.
 * @returns {string[]} Derived path cues.
 */
function extractPaths(text) {
  const matches =
    normalizeText(text).match(/(?:\.?\.?\/|~\/|\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g) || [];
  return uniqueArray(matches).slice(0, 12);
}

/**
 * Rounds recall scores for stable text and JSON output.
 *
 * @param {number} value - Raw score.
 * @returns {number} Rounded score.
 */
function formatScore(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Extracts weighted recall fields from one memory record.
 *
 * @param {object} record - Memory record.
 * @returns {{ summary: string[], body: string[], tags: string[], entities: string[], paths: string[] }} Tokenized fields.
 */
function recallFields(record) {
  return {
    summary: tokenize(record.summary || ''),
    body: tokenize(record.body || ''),
    tags: normalizeStringArray(record.tags).flatMap(tokenize),
    entities: normalizeStringArray(record.entities).flatMap(tokenize),
    paths: normalizeStringArray(record.paths).flatMap(tokenize),
  };
}

/**
 * Scores a single field with BM25 term-frequency normalization.
 *
 * @param {string[]} queryTokens - Unique normalized query tokens.
 * @param {string[]} fieldTokens - Tokenized field content.
 * @param {{ size: number, docFrequency: Map<string, number>, averageFieldLengths: Map<string, number> }} corpus - Corpus stats.
 * @param {string} field - Field name.
 * @returns {number} Field relevance score.
 */
function bm25FieldScore(queryTokens, fieldTokens, corpus, field) {
  if (fieldTokens.length === 0) {
    return 0;
  }

  const k1 = 1.2;
  const b = 0.75;
  const counts = countBy(fieldTokens, (token) => token);
  const averageLength = corpus.averageFieldLengths.get(field) || 1;
  let score = 0;

  for (const token of queryTokens) {
    const frequency = counts.get(token) || 0;
    if (frequency === 0) {
      continue;
    }

    const documentFrequency = corpus.docFrequency.get(token) || 0;
    const idf = Math.log(1 + (corpus.size - documentFrequency + 0.5) / (documentFrequency + 0.5));
    const denominator = frequency + k1 * (1 - b + b * (fieldTokens.length / averageLength));
    score += idf * ((frequency * (k1 + 1)) / denominator);
  }

  return score;
}

/**
 * Scores exact adjacent query-token matches inside record fields.
 *
 * @param {string[]} queryTokens - Unique normalized query tokens.
 * @param {{ summary: string[], body: string[], tags: string[], entities: string[], paths: string[] }} fields - Record fields.
 * @returns {number} Phrase boost.
 */
function phraseScore(queryTokens, fields) {
  if (queryTokens.length < 2) {
    return 0;
  }

  const phrase = queryTokens.join(' ');
  const haystacks = Object.values(fields).map((tokens) => tokens.join(' '));
  return haystacks.some((text) => text.includes(phrase)) ? queryTokens.length : 0;
}

/**
 * Calculates a small recency boost for recently updated records.
 *
 * @param {string} dateText - ISO-like date string from the record.
 * @returns {number} Recency score between zero and three.
 */
function recencyScore(dateText) {
  const timestamp = Date.parse(dateText);
  if (Number.isNaN(timestamp)) {
    return 0;
  }

  const days = (Date.now() - timestamp) / 86400000;
  if (days < 2) return 3;
  if (days < 14) return 2;
  if (days < 90) return 1;
  return 0;
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
 * Normalizes arbitrary input into trimmed text.
 *
 * @param {unknown} value - Value to stringify and trim.
 * @returns {string} Normalized text.
 */
function normalizeText(value) {
  return String(value || '').trim();
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

module.exports = {
  buildRecallCorpus,
  extractEntities,
  extractPaths,
  extractTags,
  formatScore,
  scoreRecord,
  tokenize,
};
