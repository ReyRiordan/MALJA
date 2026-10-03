# Jev vs LLM classifier bake-off (experiment)

Experiment code on the `jev-experiment` branch, not used by the app. It compares TypeSafe's Jev decision model (OpenRouter Decisions API, `typesafe/jev-1.13`) against the current LLM classifier on the labelled eval set.

## Files

- `harvest.ts`, `harvest-config.json`: bulk eval capture across several searches (see docs/classifier/eval.md).
- `LABELING.md`: the rubric as a labelling guide, plus precedents.
- `lib.ts`: eval loading, the Decisions API transport, result cache in `results/` (gitignored).
- `variants.ts`: Jev question sets and the code that composes answers into a `Verdict`.
  - `A-mirror`: the three rubric questions as Jev choices with yes / no / unclear options.
  - `B-decomposed`: eight atomic choice questions (role type, season, year, field, degree, graduation window start and end, work auth) with named "not stated" options; rules in code.
  - `B2-decomposed`: B with dev-split fixes (degree splits bare undergrad wording from explicit restriction, business PM option, work-auth precedents).
  - `C-nouls`: the same facts as eleven yes/no nouls.
- `prompts.ts`: LLM system prompts (`current`, and `v2` = current plus the same precedents B2 got).
- `run.ts`: runs a variant over the labelled set and caches raw answers. `--variant llm:<model>:<effort>[:<prompt>]` for the LLM.
- `score.ts`: scores cached results without API calls. `--split dev|test|all` (deterministic id-hash split), `--sweep` for Jev thresholds, `--misses`, and `combo:cascade:<jev>:<llm>` / `combo:veto:<jev>:<llm>` hybrids.

```
node --env-file=.env scripts/jev/run.ts --variant B2-decomposed --runs 3
node --env-file=.env scripts/jev/run.ts --variant llm:openai/gpt-6-luna:medium --runs 2
node scripts/jev/score.ts --split test --no 0.98 --yes 0.4 --work 0.5
```

## Metric

`wrongSuppress`: the label sends the job (neither relevant nor degreeOk is `no`) but the prediction suppresses it. That is the failure students never see. `missedNo`: the label suppresses, the prediction sends. `exact`: all three fields match. `flips`: items whose verdict differs between runs.

## Results (201 unique postings; test = held-out half, n=93; Jev thresholds tuned on dev only: no 0.98, yes 0.4, work 0.5)

| System | Test wrongSuppress | Test missedNo | Test exact | All wrongSuppress | All exact | Flips (all) | Cost / call | p50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Jev A-mirror | 0 | 8.3 | 61 | 1 | 131 | 15 | $0.00009 | 0.18 s |
| Jev C-nouls | 0 | 36 | 47 | 0 | 96 | 1 | $0.00010 | 0.19 s |
| Jev B-decomposed | 1 | 5 | 71 | 2 | 153 | 4 | $0.00014 | 0.19 s |
| Jev B2-decomposed | 1 | 4 | 77 | 3 to 4 | 172 | 3 | $0.00015 | 0.19 s |
| GPT-6 Luna none | 0 | 2 | 79 | 5 to 7 | 167 | 10 | $0.00013 | 1.7 s |
| GPT-6 Luna low | 2 | 4 | 73 | 7 | 159 | 29 | $0.00014 | 1.9 s |
| GPT-6 Luna medium | 0 | 2.5 | 79 | 2 | 167 | 19 | $0.00020 | 3.0 s |
| GPT-6 Luna medium, prompt v2 | 1 to 3 | 1 | 80 | 4 to 8 | 174 | 19 | $0.00020 | 3.4 s |
| Cascade B2 then Luna medium v2 | 1 to 2 | 1 | 82 | 6 to 8 | 179 | 7 | ~$0.00016 | mostly 0.2 s |
| Veto B2 and Luna medium v2 | 0 to 1 | 4 | 77 | 1 to 2 | 172 | 3 | ~$0.00035 | 3.4 s |

LLM costs are with OpenRouter prompt caching of the system prompt. The "All" column includes the dev half that B2 and prompt v2 were tuned on, so it flatters them.

## Findings

- Question design dominates. Asking Jev the rubric directly (A) or as nouls (C) is far worse than atomic choices with named "silent" options (B, B2). Nouls abstain into the 0.3 to 0.7 band on most hard facts, so C sends nearly everything.
- Jev's probabilities are informative for the suppress decision: raising the `no` threshold from 0.5 to 0.98 cuts wrong suppressions on all 201 from 20 to 4 while missed suppressions rise from 1 to 4. Its remaining errors are confident (0.98+) literal readings, e.g. "Undergrad Enrolled in CS" read as undergrad-only.
- Jev is much more repeatable (1 to 4 flips vs 10 to 29) and 10 to 15 times faster, at roughly the same cost per call as GPT-6 Luna with caching.
- GPT-6 Luna at `medium` with the current prompt is the safest single system: 2 wrong suppressions on all 201, both on postings labelled BORDERLINE. `low`, the old default, was the worst setting on every axis.
- Adding the labelling precedents to the LLM prompt (v2) made it more aggressive and raised wrong suppressions; the current prompt is better for the metric that matters.
- n=93 on test: differences of one or two items are within noise.
