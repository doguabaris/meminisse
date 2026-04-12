# Contributing

Thank you for considering contributing to **Meminisse**. Contributions are
welcome when they improve the persistent memory CLI, Codex plugin packaging,
documentation, or local installation workflow.

## How to Contribute

- Open an issue in the repository where Meminisse is published and describe the
  problem, expected behavior, and reproduction steps.

- Fork the repository, create a focused branch, commit your changes, and open a
  pull request. Keep commits scoped and descriptive.

- Documentation fixes are welcome. This project uses Markdown linting through
  Remark and follows the root README structure for user-facing documentation.

- JavaScript files in `plugins/meminisse/scripts` should use Corev-style file
  headers and JSDoc comments for exported or important internal functions.

- Before submitting a pull request, run:

  ```bash
  npm test
  npm run lint
  npm run lint:md
  ```

- If you change plugin packaging or installation behavior, also run:

  ```bash
  npm run install:local -- --force
  ```

  Then restart Codex and confirm that the personal marketplace still shows
  Meminisse.

## Contribution Scope

Useful contributions include:

- Bug fixes for memory storage, recall scoring, and consolidation.
- Installer fixes for personal Codex plugin and marketplace setup.
- Tests or smoke checks for CLI behavior.
- Documentation improvements for users and plugin authors.

Avoid adding hosted services, credentials, telemetry, or network dependencies
without discussing the design first.

## Resources

- [Codex plugins documentation](https://developers.openai.com/codex/plugins)
- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)
- [Using Pull Requests](https://help.github.com/articles/about-pull-requests/)

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
