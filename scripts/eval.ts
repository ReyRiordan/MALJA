/**
 * Runs the classifier over every labelled file in test/eval/eligibility/ against real OpenRouter,
 * CONCURRENCY calls at a time. Prints a confusion matrix per field and every mismatch with the
 * model's reason, in file order. Exits 1 on any classifier error, on any wrongly suppressed job
 * (the label sends it: neither relevant nor degreeOk is `no`; the verdict suppresses it) whose
 * label is not BORDERLINE, or on more than BORDERLINE_SLACK wrongly suppressed BORDERLINE jobs.
 * On jobs the label sends, also scores categories: a miss is a required category
 * (`expected.categories`) the model left out, an extra is one outside required and acceptable
 * (`expected.categoriesAlso`). Exits 1 on more than CATEGORY_SLACK misses; extras are reported.
 * Usage:
 *   pnpm eval:classifier
 */
import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  CATEGORIES,
  type Category,
  type ClassifyResult,
  createClassifier,
  type DegreeOk,
  type Relevant,
  type WorkAuth,
} from "../src/classifier/index.ts";
import { loadConfig, parseEnv } from "../src/config.ts";
import { log } from "../src/log.ts";

const EVAL_DIR = new URL("../test/eval/eligibility/", import.meta.url);
const CONCURRENCY = 6;
/** Wrongly suppressed jobs tolerated among postings whose note starts `BORDERLINE:`. */
const BORDERLINE_SLACK = 2;
/** Required categories the model may leave out across the whole set, for run-to-run noise. */
const CATEGORY_SLACK = 4;

const RELEVANT: Relevant[] = ["yes", "no", "unclear"];
const DEGREE: DegreeOk[] = ["yes", "no", "unclear"];
const WORK: WorkAuth[] = ["none", "citizen_only", "no_sponsorship", "unclear"];

const EvalFile = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  url: z.string(),
  /** The search that captured the posting: "prod" for config.json's, else a harvest-eval.json label. */
  source: z.string().optional(),
  description: z.string(),
  expected: z.object({
    relevant: z.enum(RELEVANT).nullable(),
    degreeOk: z.enum(DEGREE).nullable(),
    workAuth: z.enum(WORK).nullable(),
    /** Must appear. Null on files whose label suppresses the job. */
    categories: z.array(z.enum(CATEGORIES)).nullable().default(null),
    /** May appear without counting as an extra. Null when `categories` is. */
    categoriesAlso: z.array(z.enum(CATEGORIES)).nullable().default(null),
  }),
  note: z.string().default(""),
});
type EvalFile = z.infer<typeof EvalFile>;

const env = parseEnv();
const config = loadConfig(env.CONFIG_PATH);
const classifier = createClassifier(config, env);

const files = readdirSync(EVAL_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();
const labelled: EvalFile[] = [];
let unlabelled = 0;
for (const name of files) {
  const entry = EvalFile.parse(JSON.parse(readFileSync(new URL(name, EVAL_DIR), "utf8")));
  const { relevant, degreeOk, workAuth } = entry.expected;
  if (relevant === null || degreeOk === null || workAuth === null) {
    unlabelled += 1;
    continue;
  }
  labelled.push(entry);
}
log.info({ labelled: labelled.length, unlabelled, model: config.classifier.model }, "eval start");
if (labelled.length === 0) {
  log.error("no labelled files; fill in every expected field first");
  process.exit(1);
}

/** matrix[expected][actual] = count */
function emptyMatrix<T extends string>(values: T[]): Record<T, Record<T, number>> {
  const m = {} as Record<T, Record<T, number>>;
  for (const e of values) {
    m[e] = {} as Record<T, number>;
    for (const a of values) m[e][a] = 0;
  }
  return m;
}
const relevantMatrix = emptyMatrix(RELEVANT);
const degreeMatrix = emptyMatrix(DEGREE);
const workMatrix = emptyMatrix(WORK);

let falseNo = 0;
let wrongSuppress = 0;
let borderlineSuppress = 0;
let errors = 0;
let mismatches = 0;
let misses = 0;
let extras = 0;
/** Sendable labelled files with no category labels yet: not scored. */
let uncategorised = 0;
/** Per category: required labels, of those missed, model outputs, of those extra. */
const categoryStats = Object.fromEntries(
  CATEGORIES.map((c) => [c, { required: 0, missed: 0, predicted: 0, extra: 0 }]),
) as Record<Category, { required: number; missed: number; predicted: number; extra: number }>;
const started = Date.now();

const results: ClassifyResult[] = new Array(labelled.length);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < labelled.length) {
      const i = next++;
      results[i] = await classifier.classify(labelled[i] as EvalFile);
    }
  }),
);

const suppresses = (v: { relevant: Relevant; degreeOk: DegreeOk }) =>
  v.relevant === "no" || v.degreeOk === "no";

for (const [i, entry] of labelled.entries()) {
  const { verdict, error } = results[i] as ClassifyResult;
  const expected = entry.expected as {
    relevant: Relevant;
    degreeOk: DegreeOk;
    workAuth: WorkAuth;
  };
  if (error !== null) {
    errors += 1;
    log.error({ id: entry.id, title: entry.title, error }, "classifier error");
    continue;
  }
  relevantMatrix[expected.relevant][verdict.relevant] += 1;
  degreeMatrix[expected.degreeOk][verdict.degreeOk] += 1;
  workMatrix[expected.workAuth][verdict.workAuth] += 1;
  const relevantMiss = verdict.relevant !== expected.relevant;
  const degreeMiss = verdict.degreeOk !== expected.degreeOk;
  const workMiss = verdict.workAuth !== expected.workAuth;
  if ((relevantMiss && verdict.relevant === "no") || (degreeMiss && verdict.degreeOk === "no")) {
    falseNo += 1;
  }
  const borderline = entry.note.startsWith("BORDERLINE");
  const isWrongSuppress = !suppresses(expected) && suppresses(verdict);
  if (isWrongSuppress) {
    if (borderline) borderlineSuppress += 1;
    else wrongSuppress += 1;
  }
  if (!suppresses(expected)) scoreCategories(entry, verdict.categories, verdict.reason);
  if (relevantMiss || degreeMiss || workMiss) {
    mismatches += 1;
    log.warn(
      {
        id: entry.id,
        title: entry.title,
        company: entry.company,
        url: entry.url,
        expected,
        actual: {
          relevant: verdict.relevant,
          degreeOk: verdict.degreeOk,
          workAuth: verdict.workAuth,
          categories: verdict.categories,
        },
        reason: verdict.reason,
        note: entry.note || undefined,
      },
      isWrongSuppress
        ? borderline
          ? "WRONGLY SUPPRESSED (borderline)"
          : "WRONGLY SUPPRESSED"
        : "mismatch",
    );
  } else {
    log.info({ id: entry.id, title: entry.title, ...expected, reason: verdict.reason }, "match");
  }
}

function scoreCategories(entry: EvalFile, actual: Category[], reason: string) {
  const required = entry.expected.categories;
  if (required === null) {
    uncategorised += 1;
    return;
  }
  const acceptable = new Set([...required, ...(entry.expected.categoriesAlso ?? [])]);
  const missed = required.filter((c) => !actual.includes(c));
  const extra = actual.filter((c) => !acceptable.has(c));
  for (const c of required) categoryStats[c].required += 1;
  for (const c of missed) categoryStats[c].missed += 1;
  for (const c of actual) categoryStats[c].predicted += 1;
  for (const c of extra) categoryStats[c].extra += 1;
  misses += missed.length;
  extras += extra.length;
  if (missed.length > 0) {
    log.warn(
      {
        id: entry.id,
        title: entry.title,
        company: entry.company,
        url: entry.url,
        missed,
        expected: required,
        also: entry.expected.categoriesAlso,
        actual,
        reason,
      },
      "category miss",
    );
  }
}

function printCategoryTable() {
  const pct = (num: number, den: number) => (den === 0 ? "-" : `${Math.round((100 * num) / den)}%`);
  const cols = ["required", "missed", "recall", "predicted", "extra", "precision"];
  const cell = (s: string) => s.padStart(11);
  const lines = ["categories: recall over required, precision over required + also"];
  lines.push(`${"".padEnd(10)}${cols.map(cell).join("")}`);
  for (const c of CATEGORIES) {
    const s = categoryStats[c];
    const row = [
      String(s.required),
      String(s.missed),
      pct(s.required - s.missed, s.required),
      String(s.predicted),
      String(s.extra),
      pct(s.predicted - s.extra, s.predicted),
    ];
    lines.push(`${c.padEnd(10)}${row.map(cell).join("")}`);
  }
  process.stdout.write(`${lines.join("\n")}\n\n`);
}

function printMatrix<T extends string>(
  field: string,
  values: T[],
  m: Record<T, Record<T, number>>,
) {
  const width = Math.max(...values.map((v) => v.length), 8) + 2;
  const cell = (s: string) => s.padStart(width);
  const lines = [`${field}: rows expected, columns actual`];
  lines.push(`${"".padStart(width)}${values.map(cell).join("")}`);
  for (const e of values) {
    lines.push(`${cell(e)}${values.map((a) => cell(String(m[e][a]))).join("")}`);
  }
  process.stdout.write(`\n${lines.join("\n")}\n\n`);
}

printMatrix("relevant", RELEVANT, relevantMatrix);
printMatrix("degreeOk", DEGREE, degreeMatrix);
printMatrix("workAuth", WORK, workMatrix);
printCategoryTable();

const summary = {
  labelled: labelled.length,
  unlabelled,
  mismatches,
  falseNo,
  wrongSuppress,
  borderlineSuppress,
  misses,
  extras,
  uncategorised,
  errors,
  elapsedSec: Math.round((Date.now() - started) / 1000),
};
if (wrongSuppress > 0 || borderlineSuppress > BORDERLINE_SLACK || errors > 0) {
  log.error(summary, "eval FAILED: wrongly suppressed job or classifier error");
  process.exit(1);
}
if (misses > CATEGORY_SLACK) {
  log.error(summary, "eval FAILED: too many missed categories");
  process.exit(1);
}
log.info(
  summary,
  "eval passed: no wrongly suppressed job beyond borderline slack, category misses within slack, zero errors",
);
