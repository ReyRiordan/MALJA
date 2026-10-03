/**
 * Experiment only (jev-experiment branch). Grows test/eval/eligibility/ by scraping several
 * searches from scripts/jev/harvest-config.json, skipping ids that already have an eval file,
 * and carrying deferred cards across budget cycles. Usage:
 *   node --env-file-if-exists=.env scripts/jev/harvest.ts --search <label> --max <n> [--recency <sec>] [--pages <n>]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig } from "../../src/config.ts";
import { log } from "../../src/log.ts";
import type { Card } from "../../src/scraper/index.ts";
import { CACHE_BUST_RANGE_SEC, LinkedInClient, scrapeSearch } from "../../src/scraper/index.ts";

const { values: args } = parseArgs({
  options: {
    search: { type: "string" },
    max: { type: "string", default: "40" },
    recency: { type: "string", default: "1209600" },
    pages: { type: "string", default: "5" },
  },
});
const config = loadConfig(new URL("./harvest-config.json", import.meta.url).pathname);
const search = config.searches.find((s) => s.label === args.search);
if (!search) throw new Error(`no search ${args.search}`);
const max = Number(args.max);
const recencySec = Number(args.recency);
const EVAL_DIR = new URL("../../test/eval/eligibility/", import.meta.url);
mkdirSync(EVAL_DIR, { recursive: true });
const has = (id: string) => existsSync(new URL(`${id}.json`, EVAL_DIR));

const client = new LinkedInClient({ fetch: (u, i) => globalThis.fetch(u, i) });
let carried: Card[] = [];
let written = 0;
let cycles = 0;
const cacheBustSec = Math.floor(Math.random() * CACHE_BUST_RANGE_SEC);
while (written < max && cycles < 30) {
  cycles += 1;
  client.beginCycle();
  const result = await scrapeSearch(client, search, {
    recencySec,
    cacheBustSec,
    maxPages: cycles === 1 ? Number(args.pages) : 0,
    isSeen: has,
    carried,
  });
  for (const job of result.jobs) {
    if (!job.description || has(job.id) || job.skip) continue;
    const entry = {
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.url,
      source: search.label,
      description: job.description,
      expected: { relevant: null, degreeOk: null, workAuth: null },
      note: "",
    };
    writeFileSync(new URL(`${job.id}.json`, EVAL_DIR), `${JSON.stringify(entry, null, 2)}\n`);
    written += 1;
    if (written >= max) break;
  }
  carried = result.deferredCards;
  log.info(
    {
      cycle: cycles,
      jobs: result.jobs.length,
      written,
      deferred: carried.length,
      halted: result.halted?.name,
    },
    "harvest cycle",
  );
  if (result.halted || carried.length === 0) break;
}
log.info({ search: search.label, written }, "harvest done");
