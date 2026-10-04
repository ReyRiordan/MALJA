import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  CATEGORIES,
  type Category,
  type DegreeOk,
  type Relevant,
  type Verdict,
  type WorkAuth,
} from "../classifier/types.ts";
import type { Destination } from "../notifier/types.ts";
import type { Job } from "../scraper/types.ts";
import { dedupeKey, type Group } from "./dedupe.ts";

/** A job as read back from the store. */
export interface StoredJob extends Job {
  firstSeenAt: number;
  verdict: Verdict | null;
}

/** One destination of one notification whose message has not been confirmed sent. */
export interface PendingDelivery {
  id: number;
  notificationId: number;
  destination: Destination;
  key: string;
  createdAt: number;
  jobs: StoredJob[];
}

/**
 * Ordered, append-only. `PRAGMA user_version` is the cursor: on open, every entry past
 * the current version runs in its own transaction and bumps the version.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE jobs (
    linkedin_id       TEXT PRIMARY KEY,
    dedupe_key        TEXT NOT NULL,
    title             TEXT NOT NULL,
    company           TEXT NOT NULL,
    location          TEXT NOT NULL,
    description       TEXT,
    url               TEXT NOT NULL,
    posted_at         INTEGER,
    first_seen_at     INTEGER NOT NULL,
    search_label      TEXT NOT NULL,
    skip              TEXT,
    degree_ok         TEXT,
    work_auth         TEXT,
    classifier_reason TEXT,
    classified_at     INTEGER
  );
  CREATE INDEX jobs_dedupe_key ON jobs(dedupe_key);

  CREATE TABLE notifications (
    id           INTEGER PRIMARY KEY,
    dedupe_key   TEXT NOT NULL,
    linkedin_ids TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    sent_at      INTEGER,
    message_id   TEXT
  );
  CREATE INDEX notifications_key_created ON notifications(dedupe_key, created_at);`,
  "ALTER TABLE jobs ADD COLUMN relevant TEXT",
  "ALTER TABLE jobs ADD COLUMN categories TEXT",
  `CREATE TABLE deliveries (
    id              INTEGER PRIMARY KEY,
    notification_id INTEGER NOT NULL REFERENCES notifications(id),
    destination     TEXT NOT NULL,
    sent_at         INTEGER,
    message_id      TEXT,
    UNIQUE(notification_id, destination)
  );
  CREATE INDEX deliveries_sent_at ON deliveries(sent_at);
  INSERT INTO deliveries (notification_id, destination, sent_at, message_id)
    SELECT id, 'all', sent_at, message_id FROM notifications ORDER BY id;`,
  `UPDATE jobs SET categories = (
    SELECT json_group_array(id) FROM (
      SELECT CASE value WHEN 'ai' THEN 'aiml' WHEN 'ml' THEN 'aiml' WHEN 'qa' THEN 'swe' ELSE value END AS id,
        MIN(key) AS pos
      FROM json_each(jobs.categories) WHERE value <> 'research' GROUP BY 1 ORDER BY pos
    )
  )
  WHERE json_valid(categories) AND json_type(categories) = 'array'
    AND EXISTS (SELECT 1 FROM json_each(jobs.categories) WHERE value IN ('ai', 'ml', 'qa', 'research'));
  DELETE FROM deliveries WHERE destination IN ('research', 'qa');
  DELETE FROM deliveries WHERE destination IN ('ai', 'ml') AND EXISTS (
    SELECT 1 FROM deliveries o
    WHERE o.notification_id = deliveries.notification_id AND o.destination IN ('ai', 'ml')
      AND o.id <> deliveries.id
      AND ((o.sent_at IS NOT NULL) > (deliveries.sent_at IS NOT NULL)
        OR ((o.sent_at IS NOT NULL) = (deliveries.sent_at IS NOT NULL) AND o.id < deliveries.id))
  );
  UPDATE deliveries SET destination = 'aiml' WHERE destination IN ('ai', 'ml');`,
];

const DESTINATIONS: readonly string[] = ["all", ...CATEGORIES];

interface JobRow {
  linkedin_id: string;
  title: string;
  company: string;
  location: string;
  description: string | null;
  url: string;
  posted_at: number | null;
  first_seen_at: number;
  search_label: string;
  skip: "stale" | "gone" | null;
  /** NULL on rows classified before the column existed; read back as "unclear". */
  relevant: Relevant | null;
  /** JSON array of category ids. NULL on rows classified before the column existed; read back as []. */
  categories: string | null;
  degree_ok: DegreeOk | null;
  work_auth: WorkAuth | null;
  classifier_reason: string | null;
}

interface DeliveryRow {
  id: number;
  notification_id: number;
  destination: string;
  dedupe_key: string;
  linkedin_ids: string;
  created_at: number;
}

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return new Store(db);
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export class Store {
  readonly #db: DatabaseSync;
  readonly #hasJob: StatementSync;
  readonly #insertJob: StatementSync;
  readonly #getJob: StatementSync;
  readonly #setVerdict: StatementSync;
  readonly #keyNotifiedSince: StatementSync;
  readonly #insertNotification: StatementSync;
  readonly #insertDelivery: StatementSync;
  readonly #markDelivered: StatementSync;
  readonly #unsent: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#hasJob = db.prepare("SELECT 1 FROM jobs WHERE linkedin_id = ?");
    this.#insertJob = db.prepare(
      `INSERT OR IGNORE INTO jobs (linkedin_id, dedupe_key, title, company, location, description,
         url, posted_at, first_seen_at, search_label, skip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#getJob = db.prepare("SELECT * FROM jobs WHERE linkedin_id = ?");
    this.#setVerdict = db.prepare(
      `UPDATE jobs SET relevant = ?, categories = ?, degree_ok = ?, work_auth = ?, classifier_reason = ?,
         classified_at = ?
       WHERE linkedin_id = ?`,
    );
    this.#keyNotifiedSince = db.prepare(
      "SELECT 1 FROM notifications WHERE dedupe_key = ? AND created_at >= ? LIMIT 1",
    );
    this.#insertNotification = db.prepare(
      "INSERT INTO notifications (dedupe_key, linkedin_ids, created_at) VALUES (?, ?, ?)",
    );
    this.#insertDelivery = db.prepare(
      "INSERT INTO deliveries (notification_id, destination) VALUES (?, ?)",
    );
    this.#markDelivered = db.prepare(
      "UPDATE deliveries SET sent_at = ?, message_id = ? WHERE id = ?",
    );
    this.#unsent = db.prepare(
      `SELECT d.id, d.notification_id, d.destination, n.dedupe_key, n.linkedin_ids, n.created_at
       FROM deliveries d JOIN notifications n ON n.id = d.notification_id
       WHERE d.sent_at IS NULL ORDER BY n.id, d.id`,
    );
  }

  #transaction<T>(fn: () => T): T {
    this.#db.exec("BEGIN");
    try {
      const result = fn();
      this.#db.exec("COMMIT");
      return result;
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
  }

  /** The scraper's `isSeen`. */
  hasJob(id: string): boolean {
    return this.#hasJob.get(id) !== undefined;
  }

  /** `INSERT OR IGNORE` in one transaction. Returns the number of rows actually inserted. */
  insertJobs(jobs: Job[], now: number): number {
    return this.#transaction(() => {
      let inserted = 0;
      for (const job of jobs) {
        const result = this.#insertJob.run(
          job.id,
          dedupeKey(job),
          job.title,
          job.company,
          job.location,
          job.description,
          job.url,
          job.postedAt ? job.postedAt.getTime() : null,
          now,
          job.searchLabel,
          job.skip ?? null,
        );
        inserted += Number(result.changes);
      }
      return inserted;
    });
  }

  /** Rows for the given ids, in input order. Unknown ids are skipped. */
  getJobs(ids: string[]): StoredJob[] {
    const jobs: StoredJob[] = [];
    for (const id of ids) {
      const row = this.#getJob.get(id) as JobRow | undefined;
      if (row) jobs.push(toStoredJob(row));
    }
    return jobs;
  }

  setVerdict(id: string, verdict: Verdict, now: number): void {
    this.#setVerdict.run(
      verdict.relevant,
      JSON.stringify(verdict.categories),
      verdict.degreeOk,
      verdict.workAuth,
      verdict.reason,
      now,
      id,
    );
  }

  /** True when any notification row for the key, sent or not, has `created_at >= sinceMs`. */
  keyNotifiedSince(key: string, sinceMs: number): boolean {
    return this.#keyNotifiedSince.get(key, sinceMs) !== undefined;
  }

  /**
   * One notification row per entry plus one delivery row per destination, all in one
   * transaction. Returns the notification ids in input order.
   */
  createNotifications(
    entries: { group: Group; destinations: Destination[] }[],
    now: number,
  ): number[] {
    return this.#transaction(() =>
      entries.map(({ group, destinations }) => {
        const ids = JSON.stringify(group.jobs.map((job) => job.id));
        const id = Number(this.#insertNotification.run(group.key, ids, now).lastInsertRowid);
        for (const destination of destinations) this.#insertDelivery.run(id, destination);
        return id;
      }),
    );
  }

  /** Stamps `sent_at` and that destination's own `message_id` on one delivery. */
  markDelivered(deliveryId: number, messageId: string, now: number): void {
    this.#markDelivered.run(now, messageId, deliveryId);
  }

  /**
   * Every delivery with `sent_at IS NULL`, oldest notification first, then in the order its
   * destinations were created, with the notification's jobs rehydrated.
   */
  unsentDeliveries(): PendingDelivery[] {
    const rows = this.#unsent.all() as unknown as DeliveryRow[];
    const jobs = new Map<number, StoredJob[]>();
    return rows.map((row) => {
      let rowJobs = jobs.get(row.notification_id);
      if (!rowJobs) {
        rowJobs = this.getJobs(parseIds(row));
        jobs.set(row.notification_id, rowJobs);
      }
      return {
        id: row.id,
        notificationId: row.notification_id,
        destination: parseDestination(row),
        key: row.dedupe_key,
        createdAt: row.created_at,
        jobs: rowJobs,
      };
    });
  }

  close(): void {
    this.#db.close();
  }
}

function toStoredJob(row: JobRow): StoredJob {
  const job: StoredJob = {
    id: row.linkedin_id,
    title: row.title,
    company: row.company,
    location: row.location,
    description: row.description,
    url: row.url,
    postedAt: row.posted_at === null ? null : new Date(row.posted_at),
    searchLabel: row.search_label,
    firstSeenAt: row.first_seen_at,
    verdict:
      row.degree_ok === null || row.work_auth === null
        ? null
        : {
            relevant: row.relevant ?? "unclear",
            categories: parseCategories(row),
            degreeOk: row.degree_ok,
            workAuth: row.work_auth,
            reason: row.classifier_reason ?? "",
          },
  };
  if (row.skip !== null) job.skip = row.skip;
  return job;
}

/** NULL reads as []. A non-array or an unknown id is corruption, not something to skip. */
function parseCategories(row: JobRow): Category[] {
  if (row.categories === null) return [];
  const parsed: unknown = JSON.parse(row.categories);
  const known: readonly string[] = CATEGORIES;
  if (!Array.isArray(parsed) || !parsed.every((id) => known.includes(id))) {
    throw new Error(`jobs row ${row.linkedin_id}: categories is not an array of category ids`);
  }
  return parsed;
}

/** A row whose JSON is not a string array is corruption, not something to skip. */
function parseIds(row: DeliveryRow): string[] {
  const parsed: unknown = JSON.parse(row.linkedin_ids);
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) {
    throw new Error(`notifications row ${row.notification_id}: linkedin_ids is not a string array`);
  }
  return parsed;
}

/** An unknown destination is corruption, like an unknown category id. */
function parseDestination(row: DeliveryRow): Destination {
  if (!DESTINATIONS.includes(row.destination)) {
    throw new Error(`deliveries row ${row.id}: unknown destination ${row.destination}`);
  }
  return row.destination as Destination;
}
