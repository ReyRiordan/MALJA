# Jev vs LLM classifier bake-off

An experiment, kept on the `jev-experiment` branch and not used by the app. It asks whether TypeSafe's Jev decision model (OpenRouter Decisions API, `typesafe/jev-1.13`) should replace the LLM classifier, and which Jev question design and LLM reasoning effort work best on the labelled eval set.

**Outcome:** keep the LLM, `openai/gpt-6-luna` at `reasoning.effort: medium` with the current prompt. Jev matched it on accuracy only after careful question design, was not safer on the metric that matters, and its speed and repeatability advantages do not matter in a 5-minute poll loop.

## Layout

| File | Purpose |
| --- | --- |
| `harvest.ts`, `harvest-config.json` | Bulk eval capture across the production search and off-target searches, skipping ids that already have a file. |
| `LABELING.md` | The rubric as a labelling guide, plus precedents for wording the rubric does not name. |
| `lib.ts` | Eval loading, the Decisions API transport, packed result storage. |
| `variants.ts` | Jev question sets and the code composing their answers into a `Verdict`. |
| `prompts.ts` | LLM system prompts: `current` (production) and `v2` (current plus the precedents B2 got). |
| `run.ts` | Runs one variant over the labelled set, appending raw answers to the cache. Cached items are skipped. |
| `score.ts` | Scores cached results with no API calls: dev/test split, threshold sweep, misses, hybrids. |
| `results/<variant>/run<n>.jsonl` | Raw answers, one line per posting: Jev `answers` and `usage`, or the LLM `verdict` and `usage`. |

```
node --env-file=.env scripts/jev/run.ts --variant B2-decomposed --runs 3
node --env-file=.env scripts/jev/run.ts --variant llm:openai/gpt-6-luna:medium --runs 4
node --env-file=.env scripts/jev/run.ts --variant B-decomposed --reverse     # option order reversed
node scripts/jev/score.ts --split test --no 0.98 --yes 0.4 --work 0.5
node scripts/jev/score.ts --split dev --sweep --variant B2-decomposed
node scripts/jev/score.ts --variant combo:veto:B2-decomposed:llm_openai_gpt-6-luna_medium --misses
```

LLM variant names are `llm:<model>:<effort>[:<prompt>]` for `run.ts` and the same with `/` and `:` replaced by `_` for `score.ts`. Hybrids are `combo:cascade:<jev>:<llm>` (the LLM answers only when Jev leaves relevant or degree `unclear`) and `combo:veto:<jev>:<llm>` (suppress only when both suppress).

## Variants

| Name | Design |
| --- | --- |
| `A-mirror` | The three rubric questions as Jev choices with `yes` / `no` / `unclear` options and rubric text as criteria. |
| `B-decomposed` | Eight atomic choices with named "silent" options: role type, season, year, field, degree, graduation window start and end, work auth. The title rule, term match, graduation window, and field scope are code. |
| `B2-decomposed` | B after dev-split fixes: degree separates bare undergrad wording from explicit restriction, field gets a business-PM option, work auth gets the labelling precedents as examples. |
| `C-nouls` | The same facts as eleven yes/no nouls. |

Thresholds for composing Jev answers: `no` is the probability mass needed to suppress, `yes` the mass for a decisive yes, `work` the top probability for a decisive work-auth value. All Jev numbers below use `no 0.98, yes 0.4, work 0.5`, chosen on the dev split.

## Method

- 198 labelled postings, every LinkedIn clone removed. 59 from the production search, 139 from searches aimed at each kind of `no` (the `source` field on each file).
- Deterministic split by id hash: dev (106) for tuning Jev thresholds, B2, and prompt v2; test (92) held out.
- Jev runs 3 times, the LLM 2 to 4 times, to measure run-to-run change.
- `wrongSuppress`: the label sends the job (neither relevant nor degreeOk is `no`) and the prediction suppresses it. The failure that matters. `missedNo`: the label suppresses and the prediction sends. `exact`: all three fields match. `flips`: postings whose verdict differs between any two runs; it grows with the number of runs.

## Results

Test split, n=92. Ranges are across runs.

| System | Runs | wrongSuppress | missedNo | exact | relevant | degreeOk | workAuth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jev A-mirror | 3 | 0 | 8–9 | 60.3 | 76.7 | 80.7 | 84.7 |
| Jev C-nouls | 3 | 0 | 36 | 46.0 | 63.0 | 66.0 | 90.0 |
| Jev B-decomposed | 3 | 1 | 5 | 70.0 | 84.0 | 84.0 | 83.3 |
| Jev B2-decomposed | 3 | 1 | 4 | 75.7 | 86.0 | 82.7 | 88.0 |
| Luna `none` | 4 | 0–1 | 2 | 78.0 | 88.0 | 85.3 | 88.8 |
| Luna `low` | 2 | 2 | 4 | 72.0 | 85.0 | 83.0 | 87.0 |
| **Luna `medium`** | 4 | **0** | 2–5 | 77.5 | 85.3 | 87.3 | 88.0 |
| Luna `medium`, prompt v2 | 2 | 1–3 | 1 | 79.0 | 85.5 | 86.0 | 89.5 |
| Cascade B2 → Luna `medium` v2 | 2 | 1–2 | 1 | 80.5 | 87.5 | 86.0 | 89.0 |
| Veto B2 + Luna `medium` | 3 | 0 | 4–6 | 75.7 | 86.0 | 82.7 | 88.0 |

All 198. B2 and prompt v2 were tuned on the dev half, which flatters them here; the LLM with the current prompt and A, B, C were not tuned on any of it.

| System | Runs | wrongSuppress | missedNo | exact | flips |
| --- | --- | --- | --- | --- | --- |
| Jev B2-decomposed | 3 | 2–3 | 4 | 169.0 | 3 |
| Luna `none` | 4 | 3–7 | 4–7 | 161.8 | 24 |
| Luna `low` | 2 | 5 | 10 | 157.5 | 29 |
| **Luna `medium`** | 4 | **0–1** | 10–13 | 164.8 | 29 |
| Luna `medium`, prompt v2 | 2 | 2–6 | 3 | 171.5 | 19 |
| Veto B2 + Luna `medium` | 3 | 0–1 | 13 | 162.0 | 7 |

Luna `medium`'s only wrong suppression is Mastercard's product-management internship on degree wording, in 1 of 4 runs, a posting labelled `BORDERLINE`. Luna `none` adds clear misreads that repeat across runs: "expecting to graduate within 12 months" read as excluding May 2028 (TikTok, 4 of 4 runs), "junior standing or higher" read as excluding master's students (Optiver, 3 of 4), and Brevan Howard (3 of 4).

Jev B2 suppress threshold on all 198, run 1:

| `no` threshold | wrongSuppress | missedNo | exact |
| --- | --- | --- | --- |
| 0.5 | 18 | 1 | 153 |
| 0.8 | 12 | 2 | 161 |
| 0.9 | 7 | 3 | 169 |
| 0.95 | 4 | 4 | 170 |
| 0.98 | 3 | 4 | 168 |
| 0.995 | 0 | 9 | 164 |

## Cost and latency

| System | Input tokens | Output tokens | Cost per call | p50 latency |
| --- | --- | --- | --- | --- |
| Jev B2 | 3,620 (state + question criteria) | free | $0.00015 | 0.19 s |
| Luna `none` | 2,260, of which ~1,270 is the cacheable system prompt | 97 | $0.00016 cached, $0.00028 uncached | 1.7 s |
| Luna `medium` | same | 247 (max 888) | $0.00024 cached, $0.00035 uncached | 3.0 s |

OpenAI-backed models cache a prompt prefix over 1,024 tokens automatically; the system prompt comes first and is static, so it qualifies with no code. In a burst, 219 of 221 first-pass calls hit the cache. Sparse production calls may miss it after a few idle minutes. The `usage.cost` field from repeated eval runs understates LLM cost because whole prompts were cached across runs; the figures above are computed from token counts at $0.10/M input, $0.01/M cached input, $0.50/M output.

## Findings

- **Question design decides Jev's quality.** Asking Jev the rubric directly (A) or as nouls (C) is far worse than atomic choices with named "silent" options (B, B2). Nouls park hard facts in the 0.3–0.7 band, so C sends nearly everything. Choice with named silent options beats yes/no.
- **Jev's probabilities are useful for the suppress decision.** The threshold sweep trades wrong suppressions for missed ones cleanly. Its remaining errors are confident (0.98+) literal readings, e.g. "Undergrad Enrolled in CS" read as undergrad-only, the failure TypeSafe documents for Jev 1.13.
- **Option order matters a little.** Reversing B's option order changed exact matches by about one and missed suppressions by a few, in line with Jev's documented first-option lean.
- **Jev is 10–15× faster and far more repeatable, at about the same cost** once LLM prompt caching is counted. Neither matters at one classification per new posting every 5 minutes.
- **Luna `medium` with the current prompt is the safest single system.** `low`, the previous default, was worst on every axis.
- **More rules made the LLM worse.** Prompt v2 added the labelling precedents and raised wrong suppressions, because the model applied `no` more readily. Rules that help a labeller do not necessarily help the model.
- **Hybrids buy little.** Veto (suppress only when Jev and Luna agree) roughly matches Luna `medium`'s wrong suppressions while sending a few more postings it should suppress, at the cost of a second integration.
- **Noise.** With 92 test postings, differences of one or two are within noise.
