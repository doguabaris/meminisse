import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import presetConsistent from 'remark-preset-lint-consistent';
import presetRecommended from 'remark-preset-lint-recommended';

export default {
  settings: {
    bullet: '*',
    listItemIndent: 'one',
  },
  plugins: [remarkParse, remarkStringify, presetConsistent, presetRecommended],
};
