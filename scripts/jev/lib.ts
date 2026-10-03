/**
 * Experiment only (jev-experiment branch). Shared pieces for the Jev vs LLM bake-off:
 * eval file loading, the Jev Decisions transport, raw-result caching.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { truncateDescription } from "../../src/classifier/prompt.ts";

export const EVAL_DIR = new URL("../../test/eval/eligibility/", import.meta.url);
export const RESULTS_DIR = new URL("./results/", import.meta.url);
export const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "typesafe/jev-1.13";

const Rel = z.enum(["yes", "no", "unclear"]);
const Work = z.enum(["none", "citizen_only", "no_sponsorship", "unclear"]);
export const EvalFile = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  url: z.string(),
  source: z.string().optional(),
  description: z.string(),
  expected: z.object({
    relevant: Rel.nullable(),
    degreeOk: Rel.nullable(),
    workAuth: Work.nullable(),
  }),
  note: z.string().default(""),
});
export type EvalFile = z.infer<typeof EvalFile>;
export type Label = {
  relevant: "yes" | "no" | "unclear";
  degreeOk: "yes" | "no" | "unclear";
  workAuth: "none" | "citizen_only" | "no_sponsorship" | "unclear";
};

export function loadEval(opts: { labelledOnly: boolean }): EvalFile[] {
  return readdirSync(EVAL_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => EvalFile.parse(JSON.parse(readFileSync(new URL(f, EVAL_DIR), "utf8"))))
    .filter((e) => !opts.labelledOnly || Object.values(e.expected).every((v) => v !== null));
}

export type JevQuestion =
  | { type: "noul"; instructions: unknown; criteria: { true: unknown; false: unknown } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: unknown[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

export interface JevRaw {
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost: number };
  elapsedMs: number;
  model: string;
}

export function jevState(e: { title: string; company: string; description: string }) {
  return { title: e.title, company: e.company, description: truncateDescription(e.description) };
}

export async function callJev(
  apiKey: string,
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevRaw> {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const res = await fetch(DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "MALJA",
      },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(30_000),
    }).catch((err: unknown) => err as Error);
    const elapsedMs = Date.now() - started;
    if (res instanceof Error || res.status === 429 || res.status >= 500) {
      if (attempt >= 4)
        throw new Error(`jev failed: ${res instanceof Error ? res.message : res.status}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    const body = (await res.json()) as {
      answers?: Record<string, JevAnswer>;
      usage: JevRaw["usage"];
      model: string;
      error?: unknown;
    };
    if (!body.answers)
      throw new Error(`jev error ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
    return { answers: body.answers, usage: body.usage, elapsedMs, model: body.model };
  }
}

export function resultPath(variant: string, run: number, id: string): URL {
  return new URL(`${variant}/run${run}/${id}.json`, RESULTS_DIR);
}
export function readResult<T>(variant: string, run: number, id: string): T | null {
  const p = resultPath(variant, run, id);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}
export function writeResult(variant: string, run: number, id: string, value: unknown): void {
  const p = resultPath(variant, run, id);
  mkdirSync(new URL(".", p), { recursive: true });
  writeFileSync(p, JSON.stringify(value, null, 1));
}

/** Runs `fn` over `items` with at most `n` in flight. */
export async function pool<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++] as T);
    }),
  );
}
