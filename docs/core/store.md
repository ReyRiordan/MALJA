# Store

Code: `src/core/store.ts`.

```ts
openStore(path): Store

class Store {
  hasJob(id): boolean                               // the scraper's isSeen
  insertJobs(jobs, now): number                     // INSERT OR IGNORE, one txn, returns inserted count
  getJobs(ids): StoredJob[]                         // input order, unknown ids skipped
  setVerdict(id, verdict, now): void
  keyNotifiedSince(key, sinceMs): boolean           // any row with created_at >= sinceMs
  createNotifications(entries: { group; destinations }[], now): number[]  // one txn, notification ids in input order
  markDelivered(deliveryId, messageId, now): void
  unsentDeliveries(): PendingDelivery[]             // sent_at IS NULL, oldest notification first, jobs rehydrated
  close(): void
}

interface StoredJob extends Job { firstSeenAt: number; verdict: Verdict | null }
interface PendingDelivery {
  id: number; notificationId: number; destination: Destination; key: string; createdAt: number; jobs: StoredJob[];
}
```

One SQLite file, `malja.db` under `DATA_DIR`. The caller passes the full path. The driver is Node 24's built-in `node:sqlite` (`DatabaseSync`): synchronous prepared statements, no native addon, nothing extra in the Docker image. Every statement is prepared once in the constructor. Transactions are explicit `BEGIN` / `COMMIT` / `ROLLBACK` behind one private helper, since the driver has no `transaction()`.

## Open sequence

1. `mkdirSync(dirname(path), { recursive: true })`, skipped for `:memory:`.
2. `new DatabaseSync(path)`.
3. `PRAGMA journal_mode = WAL`, then `PRAGMA busy_timeout = 5000`.
4. Migrations.

## Migrations

`MIGRATIONS` is an ordered array of SQL strings in `store.ts`. `PRAGMA user_version` is the cursor. On open, each entry past the current version runs in its own transaction: `BEGIN`, the SQL, `PRAGMA user_version = n`, `COMMIT`. A failure rolls that one back and throws, so the process does not boot on a half-migrated file. No library, no migration files, no down migrations. Adding a column means appending one string; migration 2 is `ALTER TABLE jobs ADD COLUMN relevant TEXT` and migration 3 is `ALTER TABLE jobs ADD COLUMN categories TEXT`. Migration 4 creates `deliveries` and backfills one `all` row per existing notification, copying its `sent_at` and `message_id`. Migration 5 rewrites category ids that `CATEGORIES` no longer has, without reclassifying: in `jobs.categories`, `ai` and `ml` become `aiml`, `qa` becomes `swe`, `research` is dropped, and the list is deduped in first-seen order; `research` and `qa` deliveries are deleted, and `ai` and `ml` deliveries are renamed `aiml`. When a notification had both, one is kept (a sent one over an unsent one, then the older), since `UNIQUE(notification_id, destination)` would block the rename. Without it, the read-time id checks below would throw on old rows.

## Schema

`jobs`, one row per LinkedIn id. Primary key `linkedin_id`, index on `dedupe_key`.

| Column | Meaning |
| --- | --- |
| `linkedin_id` | The posting id. Exact-id dedupe is `hasJob`. |
| `dedupe_key` | `dedupeKey(job)` at insert time. See dedupe.md. |
| `title`, `company`, `location`, `url`, `search_label` | Straight from `Job`. |
| `description` | Plain text, or NULL when the detail page had none. Kept as the classifier audit trail. |
| `posted_at` | `Job.postedAt` as unix ms, or NULL. |
| `first_seen_at` | The `now` passed to `insertJobs`. |
| `skip` | `stale`, `gone`, or NULL. Skipped jobs are stored so the id never resurfaces. |
| `relevant`, `categories`, `degree_ok`, `work_auth`, `classifier_reason`, `classified_at` | The `Verdict`, all NULL until `setVerdict`. `categories` is a JSON array of category ids. A row with `relevant` NULL next to a non-null `degree_ok` was classified before migration 2; it reads back as `relevant: "unclear"`. A classified row with `categories` NULL predates migration 3 and reads back as `[]`. A `categories` value that is not an array of known ids throws on read, like a bad `linkedin_ids`. |

`notifications`, one row per dedupe key per cycle. Index on `(dedupe_key, created_at)` for the window query.

| Column | Meaning |
| --- | --- |
| `id` | Rowid. Returned by `createNotifications`. |
| `dedupe_key` | The group's key. |
| `linkedin_ids` | JSON array of the ids in that message. A row whose JSON is not a string array throws on read, since that means corruption. There is no join table; nothing asks "which notification contained job X". |
| `created_at` | The `now` passed to `createNotifications`. The window is measured from this. |
| `sent_at`, `message_id` | Unused since migration 4, which copied them into `all` deliveries. Left in place. |

`deliveries`, one row per notification per destination, which is one message. Unique on `(notification_id, destination)`, index on `sent_at`.

| Column | Meaning |
| --- | --- |
| `id` | Rowid. `PendingDelivery.id`. |
| `notification_id` | The `notifications` row. |
| `destination` | `all` or a category id. Fixed at creation. A value that is not one of those throws on read. |
| `sent_at`, `message_id` | NULL until `markDelivered`. `message_id` is that chat's own message id. |

Every `*_at` column is an integer of unix milliseconds. `Job.postedAt` maps through `getTime()` on write and `new Date()` on read.

## Notification lifecycle

1. The loop calls `createNotifications` with the groups that passed the window, each with its destinations. Every notification row and its delivery rows land in one transaction before anything is sent.
2. For each delivery, oldest notification first, it sends one message to that destination.
3. As each send resolves it calls `markDelivered` with that one delivery id and its message id.

If the process dies mid-cycle, the next boot finds every delivery with no `sent_at` through `unsentDeliveries` and retries those sends. A delivery whose send threw, or whose destination was not ready, stays unsent and is retried the same way next cycle, without resending to the notification's other destinations. A retry is a duplicate message at worst, never a lost one. `keyNotifiedSince` reads `notifications.created_at` and counts rows with unsent deliveries too, so a crash cannot make the same key send twice as two separate rows.

## No pruning

Rows and descriptions are kept forever. `jobs` is the exact-id dedupe, so deleting rows would let old ids resurface, and descriptions are the audit trail for classifier verdicts. A few hundred jobs a week at roughly 5 KB each stays well under 100 MB a year. Revisit if the volume fills the volume.
