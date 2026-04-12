# Meminisse Benchmarks

Benchmarks measure memory quality and safety. They are different from the
test suite: tests answer whether commands work, while benchmarks answer
how well recall and review behavior perform on known memory scenarios.

Run the local benchmark suite:

```bash
npm run benchmark
```

Emit machine-readable output:

```bash
npm run benchmark -- --json
```

Measure a Codex model's answer quality against recalled memories:

```bash
npm run benchmark -- --model gpt-5.4 --model-limit 2
```

Compare multiple Codex models:

```bash
npm run benchmark -- --models gpt-5.4,gpt-5.4-mini --model-limit 2
```

The benchmark runner creates isolated temporary workspaces and HOME
directories, then exercises the real Meminisse CLI. It does not use
external datasets, non-Codex model providers, or the user's real memory
stores. Model-backed measurement uses `codex exec --model <model>` and
is optional; the default benchmark remains fully local and deterministic.

## Current Metrics

* `Recall@1`: the expected memory is the first recall result.
* `Recall@K`: the expected memory appears within the query's configured
  `top_k`.
* `Deleted leakage`: deleted records appearing in normal recall.
* `Superseded leakage`: superseded records appearing in normal recall.
* `Stale detection`: `review` reports old version memories.
* `Duplicate detection`: `review` reports duplicate active records.
* `Broken path detection`: `review` reports missing local path
  references.
* `Answer accuracy`: a Codex model includes all expected answer terms
  when answering from recalled memories.
* `Citation accuracy`: a Codex model returns the expected supporting
  memory ID.

## Fixtures

Recall fixtures live under `benchmarks/fixtures`. Each fixture defines
memory records to write and queries with expected logical memory IDs.
The runner maps logical IDs to generated Meminisse IDs during setup.
