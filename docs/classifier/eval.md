# Eval set

Code: `scripts/eval.ts`, `scripts/harvest-eval.ts`, the `--save-eval` flag in `scripts/scrape.ts`. Files live in `test/eval/eligibility/`, one per posting, named `<id>.json`. Biome ignores the directory.

## File format

```json
{
  "id": "4463646787",
  "title": "Software Engineer Intern",
  "company": "PayPal",
  "url": "https://www.linkedin.com/jobs/view/4463646787",
  "source": "prod",
  "description": "...",
  "expected": {
    "relevant": "yes",
    "categories": ["swe"],
    "categoriesAlso": ["infra"],
    "degreeOk": "yes",
    "workAuth": "no_sponsorship"
  },
  "note": "why the label is what it is, quoting the posting"
}
```

`expected` fields are null until someone labels them. A file with `relevant`, `degreeOk`, or `workAuth` null is unlabelled: counted, skipped. `categories` must appear in the verdict; `categoriesAlso` may appear without penalty, which absorbs honest ambiguity without a BORDERLINE note. Both are null on a file whose label suppresses the job, and those files are not scored for categories. Exact-set scoring was rejected because it turns ambiguity into mismatches. Labels follow [labeling.md](labeling.md), quoting the deciding phrase in `note`. A note starting `BORDERLINE:` marks a posting where either neighbouring answer is defensible; the pass bar gives those slack. `source` is optional and names the search that captured the posting: `prod` for a config.json search, otherwise a label from `scripts/harvest-eval.json`. It lets the production slice be read on its own, since the off-target searches are not real traffic.

The set has 263 postings, 138 of which the label sends. LinkedIn clones (the same description under another id, or the same company and title) are kept once, as the dedupe key would. 59 come from the production search (`source: "prod"`). The rest come from two kinds of search in `scripts/harvest-eval.json`. Deliberately off-target searches (analytics, other engineering, new grad, other terms, PhD-only, undergrad-only, clearance, business and PM roles) make sure every kind of `no` is represented. Summer 2027 searches aimed at the small categories (security, qa, sre-devops, data-eng, embedded, robotics, research) give each of `security`, `qa`, `data`, `embedded`, and `research` at least 5 sendable postings that require it.

## Capturing postings

```
pnpm scrape --save-eval --recency 86400 --pages 2
pnpm harvest:eval --search analytics --max 20
```

`--save-eval` writes one unlabelled file per scraped job that has a description, from one cycle's budget. `harvest:eval` is for growing the set in bulk: it skips ids that already have a file, carries deferred cards across budget cycles until `--max` files are written (default 40, recency default 14 days), and records `source`. Its searches are config.json's plus the off-target ones in `scripts/harvest-eval.json`, each aimed at one kind of `no`. Delete clones after a harvest: a file whose description matches another file's, or with the same company and title, is kept once. An existing file is never overwritten, so hand labels survive a re-run and a second run for the same ids adds nothing. Descriptions are real LinkedIn text, which is the point: a hand-written set would not have the wording the prompt has to handle.

## Running

```
pnpm eval:classifier
```

Runs every labelled file against real OpenRouter with the configured model and reasoning effort, 6 calls at a time, then reports in file order. It is not in CI: it needs the key and spends money per run, about $0.07 and 3 minutes for the current set. Output goes through pino-pretty: the classifier's line per call, then a `mismatch`, `WRONGLY SUPPRESSED`, or `WRONGLY SUPPRESSED (borderline)` warning with expected, actual, and the model's reason for every miss, a `category miss` warning for every job missing a required category, a confusion matrix per field (rows expected, columns actual), a per-category table (recall over required labels, precision over required plus also), and a summary with `mismatches`, `falseNo`, `wrongSuppress`, `borderlineSuppress`, `misses`, `extras`, `uncategorised` (sendable files with no category labels, not scored), and `errors`.

## Pass bar

A job is wrongly suppressed when its label would send it (neither `relevant` nor `degreeOk` is `no`) and the verdict suppresses it. That is the one outcome the students never see, so it is what gates. Exit 1 on any non-null `error`, on any wrongly suppressed job whose label is not borderline, or on more than two wrongly suppressed borderline jobs (`BORDERLINE_SLACK`).

Categories are scored only on jobs the label sends. A *miss* is a required category the model left out, so a channel loses the job. An *extra* is a category outside required and also. Exit 1 when misses across the set exceed `CATEGORY_SLACK` (4), which allows for run-to-run noise: the same prompt and labels miss 2 to 4 required categories from run to run. Extras are reported, not gated, because gating them would push the prompt toward under-labelling; a duplicate in a channel costs less than a missed job.

Both slacks cover ambiguous postings that have been accepted as noise rather than fixed in the prompt. A posting goes on this list only when either answer is defensible under the rubric and the model flips between runs:

- Borderline suppression: Walmart "Software Engineer II" (4463957109). "Undergrad Enrolled in CS" is bare undergraduate wording, so `degreeOk` is `unclear`, and the model sometimes answers `no`.
- Category misses: Tokyo Electron "Software Engineer, AI Research" (4465308023), where a generic "AI/ML" posting can be `ml` or `ai`; IDT "Software Systems Engineer" (4474516253), whose test-automation work sits between `qa` and `swe`; and Marvell "AI-Native Development Platform Engineer" (4471755147), where `infra` is sometimes dropped next to `ai`.

A wrongly suppressed job that is not on this list, or misses beyond the slack, means the prompt or a label needs work. Raise a slack only after adding the posting that needs it to this list.

Everything else is reported, not gating. `falseNo` counts a `no` on either field where the label is `yes` or `unclear`, including jobs the other field suppresses anyway; it is worth reading but not a failure. A job sent when the label suppresses it is noise in the group, which costs less than a missed internship. An `unclear` where the label is decisive is a mismatch to look at, not a failure, because failing on it would push the prompt toward `no`.

An `error` is almost always OpenRouter or a provider, not the prompt. Read the cause: `http 502` or `http 429` on some calls and clean answers on the rest means a provider route is down. Re-run later rather than changing code.

## When to re-run

After any change to `systemPrompt`, `VERDICT_JSON_SCHEMA`, `MAX_TOKENS`, `classifier.model`, or `classifier.reasoningEffort`. The model is not deterministic even at temperature 0, so a borderline degree posting can flip between runs; run twice before blaming a change. Add and label a posting whenever a real notification was wrong, so the set grows from mistakes.
