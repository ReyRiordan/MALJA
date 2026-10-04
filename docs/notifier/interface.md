# Interface

Code: `src/notifier/types.ts` (types), `src/notifier/format.ts` (`toNotification`), `src/notifier/index.ts` (factory).

```ts
interface Notification {
  key: string;                                      // dedupe key, logging only
  title: string;
  company: string;
  postings: { location: string; url: string }[];    // first-appearance order, deduped by location
  categories: Category[];                           // the verdict's, may be empty
  tags: { text: string; level: "info" | "warn" }[]; // pre-worded, may be empty
}

type Destination = "all" | Category;

interface Notifier {
  start(): Promise<void>;
  destinations(): Destination[];                    // configured ones, `all` first
  isReady(dest: Destination): boolean;
  send(n: Notification, dest: Destination): Promise<{ messageId: string }>;
  sendAdmin(text: string): Promise<void>;
  stop(): Promise<void>;
}

toNotification(group: Group, verdict: Verdict | null): Notification
createNotifier(config: Config, env: Env): Notifier
```

There is no digest. Each dedupe key is one `Notification` and one `notifications` row, sent as one message to each of its destinations, each tracked by its own `deliveries` row. Send order is the loop's business; see docs/core/loop.md.

## Destinations

`all` is the group that gets every notification. Each category can also have a channel. Destinations are names, not chat ids: the loop picks them and only the adapter maps them to chats, so `src/core` never reads env and another adapter keeps the same interface. `destinations()` lists the configured ones, `all` first and then categories in `CATEGORIES` order. `all` is always configured.

A notification goes to `all` plus each of its verdict's categories that is configured, with the same text and tags in every chat. A job with `categories: []` (no description, a failed classifier call, or an unplaced role) reaches the group only. Every job, including `relevance unclear` and `eligibility unclear` ones, still reaches the group, so a wrong or missing category never hides a posting from everyone. The destinations are fixed when the loop creates the notification row; a channel configured later does not backfill older rows.

## Notification

The loop hands over plain data and each adapter owns its rendering. A WhatsApp adapter has no HTML links, so pre-rendered text would be re-rendered anyway, and passing `Group` plus a verdict would tie the notifier to core and classifier vocabulary.

`toNotification` builds it from a `Group` and the group's single verdict. One posting per location, first appearance wins, so each city links to one listing. `categories` is copied from the verdict, or `[]` without one; adapters print it as is. Tags are worded and levelled here, once, and adapters print them:

| Verdict field | Value | Tag | Level |
| --- | --- | --- | --- |
| `workAuth` | `citizen_only` | `US citizens only` | `warn` |
| `workAuth` | `no_sponsorship` | `no sponsorship` | `info` |
| `workAuth` | `none` or `unclear` | none | |
| `degreeOk` | `unclear` | `eligibility unclear` | `info` |
| `degreeOk` | `no` | none. The loop suppresses the job; it never reaches the notifier. | |
| `relevant` | `unclear` | `relevance unclear` | `info` |
| `relevant` | `no` | none. The loop suppresses the job; it never reaches the notifier. | |
| verdict | `null` | none | |

Tags appear in the table's order, most exclusionary first: work auth, then eligibility, then relevance. A work-auth tag repeats a fact the posting states, the two `unclear` tags mean the model could not tell, so the reader hits the hardest blocker first.

`warn` is for the one tag that rules most of the group out. The level lives in the data so a second adapter gets the same split without reading the wording.

`relevance unclear` covers all three relevance tests at once: whether it is an internship, whether it is for the configured term, and whether the work is in the configured fields. The guest search returns regular jobs and off-field postings the model cannot always place, so a posting it could not confirm should not look identical to one it could. The tag is `info`, like `eligibility unclear`, because `unclear` means the model did not know, not that the posting is out. It also appears on every message sent while the classifier is down, because the fallback verdict is `unclear` on every field; that is honest, since nobody checked.

Work-auth `unclear` is the default whenever the description does not say, so tagging it would make everyone ignore the tag line. `no sponsorship` and `US citizens only` stay separate because they exclude different people. A `null` verdict means the group was never classified, which is a group with no description anywhere. There is one verdict per group, so there is no merge rule.

## Methods

- `start()` verifies credentials once and throws on failure, so a bad token is a boot error. It does not start receiving updates.
- `destinations()` is fixed at construction.
- `isReady(dest)` is a stored boolean per destination, not a live probe. True for every configured destination after `start()`, false for an unconfigured one. False when a send to that destination fails because the bot lost its chat. True again when that destination's timed probe succeeds. While one destination is not ready the loop keeps scraping, storing, and sending to the others, and skips only that one.
- `send(n, dest)` delivers one notification to one destination and returns the adapter's message id as a string. It throws when it cannot, including for an unconfigured destination. The loop leaves that delivery unsent and retries it next cycle through `unsentDeliveries`, without resending to the other destinations.
- `sendAdmin(text)` sends plain text to the admin. It never throws: an alert about a failure must not become a failure. It logs and swallows.
- `stop()` releases any held connection. A no-op for Telegram.

## Factory

`createNotifier(config, env)` switches on `config.notifier`, which is an enum with the one value `telegram`. The Telegram adapter takes its token, the group and admin chat ids, and each set `TELEGRAM_CHANNEL_<ID>` from env (docs/core/config.md).
