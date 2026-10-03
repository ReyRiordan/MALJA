/**
 * Experiment only. Runs one variant over the labelled eval set and caches raw results under
 * scripts/jev/results/<variant>/run<n>/<id>.json. Cached items are skipped, so re-running is free.
 *   node --env-file=.env scripts/jev/run.ts --variant B-decomposed --runs 3
 *   node --env-file=.env scripts/jev/run.ts --variant llm:openai/gpt-6-luna:low --runs 2
 * Jev variants may take --shuffle to reverse every choice's option order (option-order bias check).
 */
import { parseArgs } from "node:util";
import { buildMessages, parseVerdict, VERDICT_JSON_SCHEMA } from "../../src/classifier/prompt.ts";
import { loadConfig } from "../../src/config.ts";
import {
  callJev,
  type JevQuestion,
  jevState,
  loadEval,
  pool,
  readResult,
  writeResult,
} from "./lib.ts";
import { PROMPTS } from "./prompts.ts";
import { VARIANTS } from "./variants.ts";

const { values: args } = parseArgs({
  options: {
    variant: { type: "string" },
    runs: { type: "string", default: "1" },
    concurrency: { type: "string", default: "8" },
    reverse: { type: "boolean", default: false },
    only: { type: "string" },
  },
});
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
const variantArg = args.variant ?? "";
const items = loadEval({ labelledOnly: true }).filter(
  (e) => !args.only || args.only.split(",").includes(e.id),
);
const runs = Number(args.runs);
const facts = loadConfig("config.json").classifier;

function reversed(qs: Record<string, JevQuestion>): Record<string, JevQuestion> {
  const out: Record<string, JevQuestion> = {};
  for (const [k, q] of Object.entries(qs)) {
    out[k] =
      q.type === "choice"
        ? { ...q, criteria: Object.fromEntries(Object.entries(q.criteria).reverse()) }
        : q;
  }
  return out;
}

let cost = 0;
let calls = 0;
const latencies: number[] = [];

if (variantArg.startsWith("llm:")) {
  // llm:<model>:<effort>[:<promptName>]
  const [, model, effort, promptName = "current"] = variantArg.split(":");
  const vname = variantArg.replaceAll(/[/:]/g, "_");
  const system = PROMPTS[promptName];
  if (!system) throw new Error(`no prompt ${promptName}`);
  for (let run = 1; run <= runs; run++) {
    await pool(items, Number(args.concurrency), async (e) => {
      if (readResult(vname, run, e.id)) return;
      const msgs = buildMessages(facts, e);
      msgs[0] = { role: "system", content: system(facts) };
      for (let attempt = 1; attempt <= 3; attempt++) {
        const started = Date.now();
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "MALJA",
          },
          body: JSON.stringify({
            model,
            messages: msgs,
            temperature: 0,
            max_tokens: 2000,
            response_format: { type: "json_schema", json_schema: VERDICT_JSON_SCHEMA },
            reasoning: { effort },
            usage: { include: true },
          }),
        });
        const body = (await res.json()) as {
          choices?: { message: { content: string } }[];
          usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            cost: number;
            completion_tokens_details?: { reasoning_tokens?: number };
          };
        };
        const verdict = parseVerdict(body.choices?.[0]?.message.content ?? "");
        const elapsedMs = Date.now() - started;
        if (!verdict) {
          if (attempt === 3) console.error(e.id, "failed", JSON.stringify(body).slice(0, 300));
          continue;
        }
        cost += body.usage?.cost ?? 0;
        calls += 1;
        latencies.push(elapsedMs);
        writeResult(vname, run, e.id, { verdict, usage: body.usage, elapsedMs });
        return;
      }
    });
  }
} else {
  const v = VARIANTS[variantArg];
  if (!v) throw new Error(`no variant ${variantArg}; have ${Object.keys(VARIANTS).join(", ")}`);
  const qs = args.reverse ? reversed(v.questions) : v.questions;
  const vname = args.reverse ? `${v.name}~rev` : v.name;
  for (let run = 1; run <= runs; run++) {
    await pool(items, Number(args.concurrency), async (e) => {
      if (readResult(vname, run, e.id)) return;
      try {
        const raw = await callJev(apiKey, jevState(e), qs);
        cost += raw.usage.cost;
        calls += 1;
        latencies.push(raw.elapsedMs);
        writeResult(vname, run, e.id, raw);
      } catch (err) {
        console.error(e.id, String(err));
      }
    });
  }
}
latencies.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    variant: variantArg,
    items: items.length,
    calls,
    cost: Number(cost.toFixed(6)),
    costPerCall: calls ? Number((cost / calls).toFixed(7)) : 0,
    p50ms: latencies[Math.floor(latencies.length / 2)],
    p90ms: latencies[Math.floor(latencies.length * 0.9)],
  }),
);
