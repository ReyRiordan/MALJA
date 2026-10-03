/**
 * Experiment only. Scores cached results against labels, no API calls.
 *   node scripts/jev/score.ts [--variant <name>] [--no 0.8 --yes 0.7 --work 0.6] [--sweep] [--misses]
 * Without --variant, scores every cached variant. --sweep grid-searches thresholds per Jev variant.
 */
import { existsSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  type EvalFile,
  type JevRaw,
  type Label,
  loadEval,
  RESULTS_DIR,
  readResult,
} from "./lib.ts";
import { type Thresholds, VARIANTS } from "./variants.ts";

const { values: args } = parseArgs({
  options: {
    variant: { type: "string" },
    no: { type: "string", default: "0.8" },
    yes: { type: "string", default: "0.6" },
    work: { type: "string", default: "0.5" },
    sweep: { type: "boolean", default: false },
    misses: { type: "boolean", default: false },
    ids: { type: "string" },
    split: { type: "string", default: "all" },
  },
});

// LinkedIn clones (same description under several ids) count once, as the dedupe key does in prod.
const seenDesc = new Set<string>();
const items = loadEval({ labelledOnly: true })
  .filter((e) => !args.ids || args.ids.split(",").includes(e.id))
  .filter((e) => {
    if (seenDesc.has(e.description)) return false;
    seenDesc.add(e.description);
    return true;
  })
  .filter((e) => args.split === "all" || splitOf(e.id) === args.split);
const variants = args.variant
  ? args.variant.split(",")
  : existsSync(RESULTS_DIR)
    ? readdirSync(RESULTS_DIR)
    : [];

/** Deterministic dev/test split by id hash: tune on dev, report on test. */
export function splitOf(id: string): "dev" | "test" {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? "dev" : "test";
}

const llmCalls = new Map<string, number>();
type Pred = Label & { reason: string };
const FIELDS = ["relevant", "degreeOk", "workAuth"] as const;

function predictions(variant: string, run: number, t: Thresholds): Map<string, Pred> {
  // combo:<mode>:<jev>:<llm>  mode = cascade (LLM only when Jev leaves relevant/degree unclear)
  //                            or veto (suppress only when both suppress; otherwise Jev's labels)
  if (variant.startsWith("combo:")) {
    const [, mode, jv, lv] = variant.split(":") as [string, string, string, string];
    const j = predictions(jv, run, t);
    const l = predictions(lv, run, t);
    const out = new Map<string, Pred>();
    const sup = (p: Pred) => p.relevant === "no" || p.degreeOk === "no";
    for (const [id, jp] of j) {
      const lp = l.get(id);
      if (!lp) continue;
      if (mode === "cascade") {
        out.set(
          id,
          jp.relevant === "unclear" || jp.degreeOk === "unclear"
            ? { ...lp, reason: `LLM ${lp.reason}` }
            : jp,
        );
      } else if (sup(jp) && !sup(lp)) {
        out.set(id, {
          ...jp,
          relevant: jp.relevant === "no" ? "unclear" : jp.relevant,
          degreeOk: jp.degreeOk === "no" ? "unclear" : jp.degreeOk,
        });
      } else out.set(id, jp);
    }
    llmCalls.set(
      variant,
      (llmCalls.get(variant) ?? 0) +
        [...j.values()].filter((p) =>
          mode === "veto"
            ? p.relevant === "no" || p.degreeOk === "no"
            : p.relevant === "unclear" || p.degreeOk === "unclear",
        ).length,
    );
    return out;
  }
  const out = new Map<string, Pred>();
  const jev = VARIANTS[variant.replace(/~rev$/, "")];
  for (const e of items) {
    if (jev) {
      const raw = readResult<JevRaw>(variant, run, e.id);
      if (raw) out.set(e.id, jev.compose(raw.answers, e.title, t));
    } else {
      const r = readResult<{ verdict: Pred }>(variant, run, e.id);
      if (r) out.set(e.id, r.verdict);
    }
  }
  return out;
}

interface Metrics {
  n: number;
  falseNo: number;
  falseNoIds: string[];
  missedNo: number;
  /** Label sends the job (neither field no) but prediction suppresses it. The real failure. */
  wrongSuppress: number;
  wrongSuppressIds: string[];
  relAcc: number;
  degAcc: number;
  workAcc: number;
  exact: number;
  unclearOnDecisive: number;
}

function score(preds: Map<string, Pred>): Metrics {
  const m: Metrics = {
    n: 0,
    falseNo: 0,
    falseNoIds: [],
    missedNo: 0,
    wrongSuppress: 0,
    wrongSuppressIds: [],
    relAcc: 0,
    degAcc: 0,
    workAcc: 0,
    exact: 0,
    unclearOnDecisive: 0,
  };
  for (const e of items) {
    const p = preds.get(e.id);
    if (!p) continue;
    const x = e.expected as Label;
    m.n += 1;
    const fn =
      (x.relevant !== "no" && p.relevant === "no") || (x.degreeOk !== "no" && p.degreeOk === "no");
    if (fn) {
      m.falseNo += 1;
      m.falseNoIds.push(e.id);
    }
    // A missed no: label suppresses but prediction sends.
    const labelSuppress = x.relevant === "no" || x.degreeOk === "no";
    const predSuppress = p.relevant === "no" || p.degreeOk === "no";
    if (labelSuppress && !predSuppress) m.missedNo += 1;
    if (!labelSuppress && predSuppress) {
      m.wrongSuppress += 1;
      m.wrongSuppressIds.push(e.id);
    }
    if (p.relevant === x.relevant) m.relAcc += 1;
    if (p.degreeOk === x.degreeOk) m.degAcc += 1;
    if (p.workAuth === x.workAuth) m.workAcc += 1;
    if (FIELDS.every((f) => p[f] === x[f])) m.exact += 1;
    for (const f of ["relevant", "degreeOk"] as const)
      if (x[f] !== "unclear" && p[f] === "unclear") m.unclearOnDecisive += 1;
  }
  return m;
}

function runsOf(variant: string): number[] {
  if (variant.startsWith("combo:")) {
    const [, , jv, lv] = variant.split(":") as [string, string, string, string];
    const l = runsOf(lv);
    return runsOf(jv).filter((r) => l.includes(r));
  }
  const dir = new URL(`${variant}/`, RESULTS_DIR);
  return existsSync(dir)
    ? readdirSync(dir)
        .map((r) => Number(r.replace("run", "")))
        .sort()
    : [];
}

function summarise(variant: string, t: Thresholds) {
  const rs = runsOf(variant);
  const per = rs.map((r) => ({ run: r, preds: predictions(variant, r, t) }));
  const scores = per.map((x) => score(x.preds));
  // flips: items whose relevant/degree/work verdict differs between any two runs
  let flips = 0;
  for (const e of items) {
    const vs = per.map((x) => x.preds.get(e.id)).filter(Boolean) as Pred[];
    if (vs.length > 1 && vs.some((v) => FIELDS.some((f) => v[f] !== vs[0]?.[f]))) flips += 1;
  }
  return { variant, runs: rs.length, scores, flips };
}

const t0: Thresholds = { no: Number(args.no), yes: Number(args.yes), work: Number(args.work) };

if (args.sweep) {
  for (const v of variants.filter((v) => VARIANTS[v.replace(/~rev$/, "")])) {
    const rows: string[] = [];
    for (const no of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98]) {
      for (const yes of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
        for (const work of [0.4, 0.5, 0.6, 0.8]) {
          const s = summarise(v, { no, yes, work });
          const worstFalseNo = Math.max(...s.scores.map((x) => x.wrongSuppress));
          const avg = (k: keyof Metrics) =>
            s.scores.reduce((a, x) => a + (x[k] as number), 0) / s.scores.length;
          rows.push(
            JSON.stringify({
              no,
              yes,
              work,
              falseNo: worstFalseNo,
              missedNo: avg("missedNo"),
              rel: avg("relAcc"),
              deg: avg("degAcc"),
              work_: avg("workAcc"),
              exact: avg("exact"),
              flips: s.flips,
            }),
          );
        }
      }
    }
    // best: zero false no if possible, then max exact, then min missedNo
    const parsed = rows.map((r) => JSON.parse(r));
    parsed.sort((a, b) => a.falseNo - b.falseNo || b.exact - a.exact || a.missedNo - b.missedNo);
    console.log(`\n== ${v} sweep (top 8 of ${parsed.length}) n=${items.length}`);
    for (const r of parsed.slice(0, 8)) console.log(JSON.stringify(r));
  }
} else {
  console.log(`n=${items.length} thresholds=${JSON.stringify(t0)}`);
  for (const v of variants) {
    const s = summarise(v, t0);
    for (const [i, m] of s.scores.entries()) {
      const { falseNoIds, wrongSuppressIds, ...rest } = m;
      console.log(
        JSON.stringify({
          variant: v,
          run: i + 1,
          ...rest,
          wrongSuppressIds: wrongSuppressIds.join(","),
        }),
      );
    }
    console.log(JSON.stringify({ variant: v, flips: s.flips }));
    if (args.misses) {
      const preds = predictions(v, runsOf(v)[0] ?? 1, t0);
      for (const e of items) {
        const p = preds.get(e.id);
        const x = e.expected as Label;
        if (!p || FIELDS.every((f) => p[f] === x[f])) continue;
        const diff = FIELDS.filter((f) => p[f] !== x[f]).map(
          (f) => `${f}: want ${x[f]} got ${p[f]}`,
        );
        console.log(
          `  ${e.id} ${e.title} @ ${e.company} | ${diff.join("; ")}\n     ${p.reason.slice(0, 400)}`,
        );
      }
    }
  }
}

export type { EvalFile };
