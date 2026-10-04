# classifier

The LLM relevance and eligibility check. One call per new dedupe-key group with a description, via OpenRouter, returning a relevance verdict, the role's categories, a degree-level verdict, and a work-authorisation flag. The core loop uses relevance and degree level as a soft filter; categories go on the message as hashtags. Everything is under `src/classifier/`, re-exported from `src/classifier/index.ts`, which also holds the `createClassifier` factory. `Verdict` and the store columns that hold it belong to core; this component produces the verdict.

## Docs

- [prompt.md](prompt.md) - program facts from config, every rubric word for word, the category taxonomy, the JSON schema, truncation, `null` versus `unclear`.
- [client.md](client.md) - the OpenRouter transport, reasoning effort, timeout and retry, failure causes, the `ClassifyResult` contract, logging, the factory.
- [eval.md](eval.md) - the labelled eval set, `--save-eval` and `pnpm harvest:eval`, `pnpm eval:classifier`, the pass bar, when to re-run.
- [labeling.md](labeling.md) - how to label an eval file: the rubric for a labeller, plus precedents for wording the rubric does not name.
