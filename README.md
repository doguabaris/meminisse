## Meminisse

This tool helps you give Codex always-on persistent memory across
sessions. It stores durable global and workspace context so that Codex can
recall prior work, preferences, decisions, and repeatable procedures when
a session, project, or task starts.

Project status: actively maintained

### Basic functionality

Meminisse is intended for use by Codex users who want memory that
survives context limits, restarts, and work across multiple repositories.
It is meant to help those users keep track of durable context without
copying the same background information into every new session.

Meminisse stores memory records as JSONL files and retrieves them with a
small cue-based scoring system. It uses memory kinds such as `decision`,
`fact`, `procedure`, `preference`, and `event` to separate the intent of
each record while still searching all relevant memory together.

Meminisse uses project-local and user-global storage to do persistent
recall. It takes memory text from CLI commands and Codex skill workflows
and uses it to write structured records with summaries, tags, entities,
paths, timestamps, confidence, and status fields. For more details about
the technical implementation, see [the developer
documentation](#developer-documentation).

### What Meminisse does not do

This tool cannot increase the model context window. It does not make
Codex automatically know every stored memory unless the memory is
recalled and brought back into the active conversation.

Meminisse does not provide semantic vector search, hosted sync,
multi-user conflict resolution, or encryption. It blocks common secret
patterns before writing memory records, but you should still avoid
storing API keys, passwords, private keys, `.env` values, or other
credentials.

## Prerequisites

Before using this tool, you should be familiar with:

- The basics of running shell commands in a Codex workspace.
- How Codex plugins, skills, and local marketplaces are structured.
- Basic JSON and Markdown files.

You should have:

- Node.js available on your `PATH`.
- A Unix-like local development environment. This project is currently
  developed on macOS.
- Permission to write to the current repository.
- Permission to write to `~/.codex/plugins`,
  `~/.codex/skills`, `~/.codex/memories`, and
  `~/.agents/plugins` for personal Codex installation.

## How to use Meminisse

### Install Meminisse for personal Codex use

1. Install Meminisse from npm.

   ```bash
   npm install -g meminisse
   ```

2. Install the Codex plugin, skill, and personal marketplace entry.

   ```bash
   meminisse-install-home --force
   ```

3. Confirm that the installer prints paths under
   `~/.codex/plugins/meminisse`, `~/.codex/skills/meminisse`, and
   `~/.agents/plugins/marketplace.json`.

4. Restart Codex.
5. Open the plugin directory in Codex.
6. Select the personal marketplace named `Local Plugins`.
7. Install or enable `Meminisse`.

After installation, Codex CLI includes the Meminisse skill in the
model-visible skill list. The skill description tells Codex to use
Meminisse for every session, project, and task unless the user explicitly
opts out. You can verify this with:

```bash
codex debug prompt-input "New task" | rg "meminisse"
```

### Initialize memory storage

1. Initialize project and global memory directories.

   ```bash
   meminisse init --scope all
   ```

2. Confirm that project memory exists under:

   ```text
   .meminisse/memory/
   ```

3. Confirm that global memory exists under:

   ```text
   ~/.codex/memories/meminisse/memory/
   ```

Project initialization also ensures `.meminisse/` is ignored in
`.gitignore`. If `.npmignore`, `.dockerignore`, or `.remarkignore`
already exist, Meminisse adds the project memory directory there too.

### Remember durable context

1. Choose the kind of memory to store.
   1. Use `decision` for durable choices and rationale.
   2. Use `procedure` for repeatable workflows or commands.
   3. Use `preference` for user preferences that should apply across
      sessions.
   4. Use `event` for a bounded task or session summary.

2. Write the memory.

   ```bash
   meminisse remember --kind decision "Use npm for this repository."
   ```

3. Replace an older memory with `--supersedes` when a decision changes.

   ```bash
   meminisse remember --kind decision --supersedes mem_20260412_abcd123456 "Use Node's built-in test runner."
   ```

4. Store global preferences with global scope.

   ```bash
   meminisse remember --kind preference --scope global "Prefer concise Turkish status updates."
   ```

Meminisse skips exact duplicate active memories unless you pass
`--force`. It also blocks likely secrets such as API keys, tokens,
password assignments, private key blocks, and common access-key formats.

### Recall relevant memory

1. Query memory before answering a question or making a change.

   ```bash
   meminisse recall "package manager and prior decisions"
   ```

2. Use global installation from any workspace after personal install.

   ```bash
   node "$HOME/.codex/plugins/meminisse/scripts/meminisse.js" recall "recent work and preferences"
   ```

3. Use JSON output when integrating with another script.

   ```bash
   meminisse recall --json "deployment procedure"
   ```

4. Limit terminal output for token efficiency.

   ```bash
   meminisse recall --mode ids --max-chars 1200 --threshold 4 "deployment procedure"
   ```

Recall modes are `summary`, `full`, and `ids`. Terminal recall defaults
to `summary`, limits output with `--max-chars 4000`, and only returns
active memories.

### Inspect and retire memory

1. List active records without a search query.

   ```bash
   meminisse list --scope all --limit 20
   ```

2. Include records that were superseded or deleted.

   ```bash
   meminisse list --status all
   ```

3. Filter by kind or emit JSON for scripts.

   ```bash
   meminisse list --kind decision --json
   ```

4. Retire an outdated active memory by ID.

   ```bash
   meminisse forget mem_20260412_abcd123456 --reason "Outdated project decision."
   ```

`forget` marks matching active records with `status: "deleted"` instead
of removing JSONL rows. Deleted records are excluded from normal recall
but remain inspectable with `meminisse list --status deleted`.

### Consolidate memory

1. Run consolidation after meaningful work or after several memory
   records have been added.

   ```bash
   meminisse compact --scope all
   ```

2. Review the generated summaries.
   1. Project summary:

      ```text
      .meminisse/memory/consolidated.md
      ```

   2. Global summary:

      ```text
      ~/.codex/memories/meminisse/memory/consolidated.md
      ```

3. Use the status command to confirm active record counts.

   ```bash
   meminisse status
   ```

## Troubleshooting

The plugin does not appear in Codex after installation

- Restart Codex after changing a marketplace or plugin folder.
- Check that `~/.agents/plugins/marketplace.json` exists and points to
  `./.codex/plugins/meminisse`.
- Check that `~/.codex/plugins/meminisse/.codex-plugin/plugin.json`
  exists.

Recall returns no relevant memories

- Confirm that memory records exist with:

  ```bash
  meminisse status
  ```

- Try a broader query with fewer terms.

- Confirm that you wrote records to the expected scope. Project memory
  is stored under `.meminisse/memory`; global memory is stored under
  `~/.codex/memories/meminisse/memory`.

The home installer does not update an existing installation

- Run the installer with `--force`:

  ```bash
  meminisse-install-home --force
  ```

The marketplace path points to an old plugin location

- Re-run the home installer with `--force`.
- Verify that the Meminisse entry in `~/.agents/plugins/marketplace.json`
  uses:

  ```json
  {
    "source": {
      "source": "local",
      "path": "./.codex/plugins/meminisse"
    }
  }
  ```

## How to get help and report issues

- Report issues by opening an issue in the repository where Meminisse is
  published.
- Ask questions or get help by contacting Doğu Abaris at
  `abaris@null.net`. Response time is not guaranteed for personal or
  experimental use.

## Developer documentation

### Technical implementation

This tool uses Node.js built-in modules to implement a dependency-free
CLI. It depends on `fs`, `path`, `os`, and `crypto` because it writes
JSONL records, resolves local and global storage paths, and creates
stable short IDs for memory records.

Meminisse stores records in append-only JSONL files. Recall tokenizes the
query and scores active records using summary text, body text, tags,
entities, paths, confidence, status, kind, and recency. Recall supports
summary, full, and id-only output modes plus relevance thresholds and
character budgets for token efficiency. Consolidation reads active records
and writes a Markdown summary plus an `index.json` file.

Memory lifecycle controls include duplicate detection, secret detection,
listing, soft deletion, and `--supersedes` handling. When a new memory
supersedes an older record, the older record is rewritten with
`status: "superseded"` and excluded from normal recall. When a memory is
forgotten, it is rewritten with `status: "deleted"` and remains available
for audit-style inspection through `meminisse list --status deleted`.

### Code structure

The `plugins/meminisse/scripts/meminisse.js` module implements the CLI
commands, memory record format, JSONL storage, recall scoring, and
consolidation.

The `plugins/meminisse/scripts/install-home.js` module installs the
plugin into the personal Codex plugin directory and updates the personal
marketplace file.

The `plugins/meminisse/skills/meminisse` directory contains the Codex
skill instructions that tell Codex when to recall memory and when to
write durable memory.

The `.agents/plugins/marketplace.json` file exposes Meminisse through a
repo-scoped marketplace for local testing.

The `.meminisse/memory` directory contains this repository's project
memory records. It is runtime data, not plugin source code.
Meminisse automatically keeps `.meminisse/` out of Git and, when the
files exist, npm package inputs, Docker build contexts, and Remark inputs.

### Local development

#### Set up

How to set up development environment:

1. Clone or open this repository.
   1. Confirm Node.js is available:

      ```bash
      node --version
      ```

   2. Confirm npm is available:

      ```bash
      npm --version
      ```

#### Install

How to install:

1. Install Meminisse into the personal Codex plugin location.
   1. From a repository checkout, run:

      ```bash
      npm run install:home -- --force
      ```

   2. Or, after global npm installation, run:

      ```bash
      meminisse-install-home --force
      ```

   3. Restart Codex so it reloads the personal marketplace.

#### Configure

How to configure:

1. Edit `~/.agents/plugins/marketplace.json` if you want to rename the
   personal marketplace.
2. Keep the Meminisse plugin entry pointed at
   `./.codex/plugins/meminisse`.
3. Use `~/.codex/memories/meminisse/memory` for global memory and
   `.meminisse/memory` for workspace memory.

4. For npm-installed usage, run `meminisse` and
   `meminisse-install-home` directly from your shell.

#### Build and test

How to build and run locally:

1. No build step is required.
   1. Run the CLI directly:

      ```bash
      meminisse status
      ```

   2. Or run the installed personal copy:

      ```bash
      node "$HOME/.codex/plugins/meminisse/scripts/meminisse.js" status
      ```

How to run tests:

1. Run the integration test suite.
   1. Execute:

      ```bash
      npm test
      ```

   2. Confirm the CLI and installer tests pass.

#### Debugging

- `meminisse: Scope must be project, global, or all.`
  - The `--scope` value is invalid. Use `project`, `global`, or
    `all`.

- `meminisse: Unsupported kind`
  - The `--kind` value is invalid. Use `event`, `session`, `fact`,
    `decision`, `procedure`, `preference`, or `note`.

- `No relevant memories found.`
  - The query did not match any active memory records. Use broader
    terms or add durable memory with `remember`.

- `Missing required path`
  - The home installer cannot find the plugin source directory. Run
    the installer from this repository after confirming
    `plugins/meminisse` exists.

## How to contribute

The Meminisse maintainers welcome focused contributions.

- Bug fixes for CLI behavior, storage handling, or marketplace
  installation.
- Improvements to recall scoring and consolidation.
- Documentation improvements.
- Tests for memory parsing, scoring, and installer behavior.

### Contribution process

Before contributing, read the existing coding style in
`plugins/meminisse/scripts`. We follow Corev-style file headers and JSDoc
comments for script files.

1. Create a focused branch.
   1. Keep changes scoped to one behavior or documentation area.
   2. Avoid unrelated formatting churn.

2. Make the change.
   1. Add or update JSDoc for modified functions.
   2. Run:

      ```bash
      npm test
      ```

3. Verify installation if plugin packaging changed.
   1. Run:

      ```bash
      npm run install:home -- --force
      ```

   2. Restart Codex and confirm the marketplace entry still appears.

## Credits

Meminisse was created by Doğu Abaris.

## License

Meminisse is licensed under the MIT License. See [LICENSE](LICENSE).
