---
name: meminisse
description: Use for every Codex session, project, and task unless the user explicitly opts out. Recall relevant global and workspace memories before answering or editing, then write durable preferences, prior work, decisions, procedures, and session events after meaningful work.
---

# Meminisse

Use Meminisse at the start of every Codex session, project, or task unless
the user explicitly opts out. Recall relevant memory before answering,
planning, editing, reviewing, or running commands. Write durable memory after
meaningful work.

## Memory Model

Meminisse maps human memory concepts into Codex workflow:

- `event` or `session`: episodic memory for what happened in a bounded task.
- `fact` or `decision`: semantic memory for reusable project knowledge.
- `procedure`: procedural memory for repeated commands and workflows.
- `preference`: global user preference, stored outside the repo.
- `compact`: consolidation step that turns many small memories into a short retrieval surface.

## Required Workflow

At session or task start, inject high-priority startup memory first:

```bash
meminisse inject --scope all --max-chars 4000
```

Before substantial work, recall relevant context with concise output:

```bash
meminisse recall --mode summary --max-chars 4000 "<user task>"
```

If the summary output is not enough, run a narrower full recall:

```bash
meminisse recall --mode full --limit 3 "<specific cue>"
```

If the repo does not have local memory yet, initialize it:

```bash
meminisse init --scope all
```

After meaningful work, write only durable information:

```bash
meminisse remember --kind decision "<decision and reason>"
meminisse remember --kind procedure "<repeatable command or workflow>"
meminisse remember --kind event "<short summary of what changed>"
```

Use global memory for stable user preferences:

```bash
meminisse remember --kind preference --scope global "<preference>"
```

Consolidate periodically:

```bash
meminisse compact --scope all
```

## What To Remember

Remember:

- Architecture decisions and their rationale.
- Project conventions such as package manager, test commands, branch flow, deployment rules.
- Repeated workflows and commands.
- User preferences that should apply across sessions.
- Important task outcomes, especially what was changed and what could not be verified.

Do not remember:

- Secrets, tokens, private keys, passwords, `.env` values, or credentials.
- Large logs or transient terminal output.
- Temporary guesses that were later disproven.
- Low-value details that can be rediscovered cheaply.

Meminisse blocks likely secrets before writing. Do not bypass that guard
unless the value is intentionally non-sensitive test data.

## Retrieval Discipline

When memories conflict, prefer active records with high confidence, recent timestamps, and direct source from the user. Treat old low-confidence records as hints, not facts.

When the user asks whether something was already done, recall with the task keywords and inspect matching events or decisions before claiming it was or was not done.

When a new user statement supersedes older memory, write a new active memory with `--supersedes` if the old id is known.

Use `--mode ids` when you only need candidate memory IDs for lifecycle
updates, cleanup, or superseding.
