/**
 * Grows test/eval/eligibility/ in bulk. Scrapes one search against real LinkedIn and writes an
 * unlabelled eval file per job with a description, skipping ids that already have a file and
 * carrying deferred cards across budget cycles until `--max` files are written. Searches are
 * config.json's (recorded as source "prod") plus the off-target ones in scripts/harvest-eval.json.
 * Usage:
 *   pnpm harvest:eval --search <label> [--max <n>] [--recency <sec>] [--pages <n>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseConfig, parseEnv } from "../src/config.ts";
import { log } from "../src/log.ts";
import {
  CACHE_BUST_RANGE_SEC,
  type Card,
  LinkedInClient,
  scrapeSearch,
} from "../src/scraper/index.ts";

const MAX_CYCLES = 30;

const { values: args } = parseArgs({
  options: {
    search: { type: "string" },
    max: { type: "string", default: "40" },
    recency: { type: "string", default: "1209600" },
    pages: { type: "string", default: "5" },
  },
});

const env = parseEnv();
const base = JSON.parse(readFileSync(env.CONFIG_PATH, "utf8")) as { searches: unknown[] };
const extra = JSON.parse(readFileSync(new URL("./harvest-eval.json", import.meta.url), "utf8")) as {
  searches: unknown[];
};
const config = parseConfig({ ...base, searches: [...base.searches, ...extra.searches] });
const prodCount = base.searches.length;
const index = config.searches.findIndex((s) => s.label === args.search);
const search = config.searches[index];
if (!search) {
  log.error(
    { search: args.search, labels: config.searches.map((s) => s.label) },
    "no search with that label",
  );
  process.exit(1);
}
const source = index < prodCount ? "prod" : search.label;
const max = Number.parseInt(args.max, 10);
const recencySec = Number.parseInt(args.recency, 10);
const maxPages = Number.parseInt(args.pages, 10);
for (const [name, value] of Object.entries({ max, recency: recencySec, pages: maxPages })) {
  if (!Number.isInteger(value) || value < 1) {
    log.error({ [name]: value }, `--${name} must be a positive integer`);
    process.exit(1);
  }
}

const EVAL_DIR = new URL("../test/eval/eligibility/", import.meta.url);
mkdirSync(EVAL_DIR, { recursive: true });
const hasFile = (id: string) => existsSync(new URL(`${id}.json`, EVAL_DIR));

const client = new LinkedInClient({
  fetch: (url, init) => globalThis.fetch(url, init),
  ...(env.PROXY_URL ? { proxyUrl: env.PROXY_URL } : {}),
});
// A random offset keeps LinkedIn's result cache from replaying a stale set; see docs/scraper/search.md.
const cacheBustSec = Math.floor(Math.random() * CACHE_BUST_RANGE_SEC);
let carried: Card[] = [];
let written = 0;

for (let cycle = 1; cycle <= MAX_CYCLES && written < max; cycle++) {
  client.beginCycle();
  const result = await scrapeSearch(client, search, {
    recencySec,
    cacheBustSec,
    // Pages are read once; later cycles only fetch details for the carried cards.
    maxPages: cycle === 1 ? maxPages : 0,
    isSeen: hasFile,
    carried,
  });
  for (const job of result.jobs) {
    if (written >= max) break;
    if (!job.description || job.skip || hasFile(job.id)) continue;
    const entry = {
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.url,
      source,
      description: job.description,
      expected: { relevant: null, degreeOk: null, workAuth: null },
      note: "",
    };
    writeFileSync(new URL(`${job.id}.json`, EVAL_DIR), `${JSON.stringify(entry, null, 2)}\n`);
    written += 1;
  }
  carried = result.deferredCards;
  log.info({ cycle, jobs: result.jobs.length, written, deferred: carried.length }, "harvest cycle");
  if (result.halted) {
    log.error({ name: result.halted.name, url: result.halted.url }, "scrape halted");
    break;
  }
  if (carried.length === 0) break;
}
log.info({ search: search.label, source, written }, "harvest done");
