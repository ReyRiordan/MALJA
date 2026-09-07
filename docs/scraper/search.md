# Search

Code: `src/scraper/search.ts`.

```ts
buildSearchUrl(search, recencySec, start): string
parseCards(html): Card[]
scrapeSearch(client, search, { recencySec, maxPages, isSeen, cacheBustSec?, carried?, now? }): Promise<ScrapeResult>

CACHE_BUST_RANGE_SEC = 600
```

## Endpoint

A configured search (see docs/core/config.md for how the pasted URL becomes `{ keywords, params }`) maps onto the logged-out "load more" endpoint:

```
GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
    ?keywords=<encoded>&<search.params>&f_TPR=r<recencySec + cacheBustSec>&start=<n>
```

| Param | Source | Notes |
| --- | --- | --- |
| `keywords` | config | Boolean syntax (quotes, parentheses, `OR`, `AND`, `NOT`) is honoured. |
| `sortBy` | forced `DD` | Newest first. Every stop rule below depends on it. |
| `geoId`, `location`, `f_E`, `f_JT`, `f_WT`, ... | config passthrough | The scraper does not interpret them. |
| `f_TPR` | `recencySec + cacheBustSec` | `r` + seconds. `cacheBustSec` defaults to 0; the loop passes a value under `CACHE_BUST_RANGE_SEC` that changes every cycle, because LinkedIn caches result sets by query string and replays a frozen set for a URL it has seen recently (see [README.md](README.md)). Only the URL widens; `beforeWindow` and the detail `stale` check use `recencySec` alone. |
| `start` | paging | 0, 10, 20, ... |

The response is an HTML fragment of `<li>` cards, ten per page. Offsets of 1000 and above return a 400 with an empty body, which the client reports as `TransientError`; `maxPages` keeps the loop far below that.

## Cards

`parseCards` takes every `<li>` whose first `a[href*="/jobs/view/"]` has an id. The id is the `-(\d{6,})` match on that href, which has outlived every class rename. The other fields map to selectors, and a missing element yields `""` (or `null` for the date):

| Field | Selector |
| --- | --- |
| `title` | `h3.base-search-card__title` |
| `company` | `h4.base-search-card__subtitle` |
| `location` | `span.job-search-card__location` |
| `postedOn` | `time[datetime]`, `YYYY-MM-DD` |

Unknown markup yields `[]`. The function never throws on a string.

## Paging and stop rules

`scrapeSearch` assumes the loop already called `client.beginCycle()`. It fetches `start = 0, 10, ...` and stops at the first of:

- `maxPages` pages fetched;
- a page with fewer than ten cards (it is the last one);
- a page that adds no unseen card. Newest-first means nothing older is new either.

Cards are skipped without a detail fetch when the id was already collected this search, when `isSeen(id)` is true, or when the card date rules the posting out. The card date is day-granular in an unknown timezone, so it is only a pre-filter: a card is dropped when the end of its posted day plus a full day of margin is still before `now - recencySec`. The real recency check is the detail timestamp (see [detail.md](detail.md)).

After paging, each card in `carried` (the previous cycle's deferred cards for this search, see below) is appended under the same three skip rules, so a carried card that was stored by another search in the meantime, or whose posted day has fallen out of the window, is dropped without a fetch.

Details are then fetched in order: this cycle's page cards first, then the carried cards. The freshest postings never queue behind a backlog that is already a poll interval old.

## Result contract

```ts
interface ScrapeResult {
  jobs: Job[];            // every fetched job, including ones with skip set
  deferred: number;       // deferredCards.length
  deferredCards: Card[];  // unseen cards left without a detail fetch, page cards first
  cardsOnFirstPage: number;
  halted?: ScrapeError;   // set when the search stopped on anything but budget
}
```

Partial work survives errors. Any `ScrapeError` from the client ends the search and whatever was fetched before it is returned. `BudgetExhaustedError` is the expected end of a busy cycle and is not reported as `halted`; every other `ScrapeError` is. Errors that are not `ScrapeError`s propagate. `cardsOnFirstPage` is set as soon as page 0 is parsed, so the loop can run its zero-cards alert even when a later page halted the search.

`deferredCards` is every collected card that got no detail fetch, in fetch order, and is `[]` on a clean finish. A search page halt (budget, rate limit, or transient) re-defers the whole `carried` list, so nothing is dropped by an error. The loop keeps these per search label in memory and passes them back as `carried` next cycle. The store never sees them, and a restart forgets them; the next cycle's page 0 finds any that are still inside the window. The `added === 0` stop rule cannot see them on its own: a page full of ids that are all seen ends paging, which is why the carry exists. A job is lost only if a burst keeps outrunning the budget for longer than `recencySec`.
