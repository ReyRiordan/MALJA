import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Verdict } from "../classifier/types.ts";
import type { Job } from "../scraper/types.ts";
import type { Group } from "./dedupe.ts";
import { dedupeKey, groupByKey } from "./dedupe.ts";
import { MIGRATIONS, openStore, type PendingDelivery, type Store } from "./store.ts";

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const DAY = 86_400_000;

function job(id: string, over: Partial<Job> = {}): Job {
  return {
    id,
    title: "SWE Intern",
    company: "Acme",
    location: "Austin, TX",
    description: `Description for ${id}`,
    url: `https://www.linkedin.com/jobs/view/${id}`,
    postedAt: new Date(NOW - 60_000),
    searchLabel: "test",
    ...over,
  };
}

describe("openStore on disk", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "malja-store-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the directory, runs migrations once, and reopens without rerunning them", () => {
    const path = join(dir, "nested", "malja.db");
    const first = openStore(path);
    expect(first.insertJobs([job("1")], NOW)).toBe(1);
    first.close();
    expect(existsSync(path)).toBe(true);

    const second = openStore(path);
    expect(second.hasJob("1")).toBe(true);
    second.close();

    const db = new DatabaseSync(path);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    db.close();
  });

  it("migrates a version-1 file and reads its classified rows as relevant unclear, no categories", () => {
    const path = join(dir, "malja.db");
    const db = new DatabaseSync(path);
    db.exec(MIGRATIONS[0] as string);
    db.exec("PRAGMA user_version = 1");
    db.prepare(
      `INSERT INTO jobs (linkedin_id, dedupe_key, title, company, location, description, url,
         first_seen_at, search_label, degree_ok, work_auth, classifier_reason, classified_at)
       VALUES ('1', 'acme|swe intern', 'SWE Intern', 'Acme', 'Austin, TX', 'd', 'u', ?, 'test',
         'yes', 'none', 'Says BS/MS.', ?)`,
    ).run(NOW, NOW + 5);
    db.prepare(
      `INSERT INTO jobs (linkedin_id, dedupe_key, title, company, location, url, first_seen_at,
         search_label)
       VALUES ('2', 'acme|swe intern', 'SWE Intern', 'Acme', 'Chicago, IL', 'u', ?, 'test')`,
    ).run(NOW);
    db.close();

    const store = openStore(path);
    expect(store.getJobs(["1"])[0]?.verdict).toEqual({
      relevant: "unclear",
      categories: [],
      degreeOk: "yes",
      workAuth: "none",
      reason: "Says BS/MS.",
    });
    expect(store.getJobs(["2"])[0]?.verdict).toBeNull();
    store.setVerdict(
      "2",
      { relevant: "no", categories: ["infra"], degreeOk: "yes", workAuth: "none", reason: "FT" },
      NOW,
    );
    expect(store.getJobs(["2"])[0]?.verdict?.relevant).toBe("no");
    expect(store.getJobs(["2"])[0]?.verdict?.categories).toEqual(["infra"]);
    store.close();

    const reopened = new DatabaseSync(path);
    expect(reopened.prepare("PRAGMA user_version").get()).toEqual({
      user_version: MIGRATIONS.length,
    });
    reopened.close();
  });

  it("backfills one all delivery per existing notification with its sent state", () => {
    const path = join(dir, "malja.db");
    const db = new DatabaseSync(path);
    for (const sql of MIGRATIONS.slice(0, 3)) db.exec(sql);
    db.exec("PRAGMA user_version = 3");
    db.prepare(
      `INSERT INTO jobs (linkedin_id, dedupe_key, title, company, location, url, first_seen_at,
         search_label)
       VALUES ('1', 'acme|swe intern', 'SWE Intern', 'Acme', 'Austin, TX', 'u', ?, 'test')`,
    ).run(NOW);
    const insert = db.prepare(
      `INSERT INTO notifications (dedupe_key, linkedin_ids, created_at, sent_at, message_id)
       VALUES ('acme|swe intern', '["1"]', ?, ?, ?)`,
    );
    insert.run(NOW, NOW + 10, "77");
    insert.run(NOW + 1, null, null);
    db.close();

    const store = openStore(path);
    const pending = store.unsentDeliveries();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ notificationId: 2, destination: "all", createdAt: NOW + 1 });
    expect(pending[0]?.jobs.map((j) => j.id)).toEqual(["1"]);
    store.close();

    const reopened = new DatabaseSync(path);
    expect(
      reopened
        .prepare(
          "SELECT notification_id, destination, sent_at, message_id FROM deliveries ORDER BY id",
        )
        .all(),
    ).toEqual([
      { notification_id: 1, destination: "all", sent_at: NOW + 10, message_id: "77" },
      { notification_id: 2, destination: "all", sent_at: null, message_id: null },
    ]);
    reopened.close();
  });

  it("rewrites removed category ids in jobs and deliveries of a version-4 file", () => {
    const path = join(dir, "malja.db");
    const db = new DatabaseSync(path);
    for (const sql of MIGRATIONS.slice(0, 4)) db.exec(sql);
    db.exec("PRAGMA user_version = 4");
    const insertJob = db.prepare(
      `INSERT INTO jobs (linkedin_id, dedupe_key, title, company, location, url, first_seen_at,
         search_label, relevant, categories, degree_ok, work_auth, classifier_reason, classified_at)
       VALUES (?, ?, 'Intern', 'Acme', 'Austin, TX', 'u', ?, 'test', 'yes', ?, 'yes', 'none', '', ?)`,
    );
    insertJob.run("1", "acme|a", NOW, '["ml","research","ai","swe"]', NOW);
    insertJob.run("2", "acme|b", NOW, '["qa","swe"]', NOW);
    insertJob.run("3", "acme|c", NOW, '["research"]', NOW);
    insertJob.run("4", "acme|d", NOW, '["infra","data"]', NOW);
    insertJob.run("5", "acme|e", NOW, null, NOW);
    const insertNotification = db.prepare(
      "INSERT INTO notifications (dedupe_key, linkedin_ids, created_at) VALUES (?, ?, ?)",
    );
    insertNotification.run("acme|a", '["1"]', NOW);
    insertNotification.run("acme|b", '["2"]', NOW);
    const insertDelivery = db.prepare(
      "INSERT INTO deliveries (notification_id, destination, sent_at, message_id) VALUES (?, ?, ?, ?)",
    );
    insertDelivery.run(1, "all", NOW, "1");
    insertDelivery.run(1, "ai", null, null);
    insertDelivery.run(1, "ml", NOW, "2");
    insertDelivery.run(1, "research", null, null);
    insertDelivery.run(2, "ml", null, null);
    insertDelivery.run(2, "qa", NOW, "3");
    db.close();

    const store = openStore(path);
    const categories = store.getJobs(["1", "2", "3", "4", "5"]).map((j) => j.verdict?.categories);
    expect(categories).toEqual([["aiml", "swe"], ["swe"], [], ["infra", "data"], []]);
    expect(store.unsentDeliveries().map((p) => [p.notificationId, p.destination])).toEqual([
      [2, "aiml"],
    ]);
    store.close();

    const reopened = new DatabaseSync(path);
    expect(
      reopened
        .prepare("SELECT notification_id, destination, message_id FROM deliveries ORDER BY id")
        .all(),
    ).toEqual([
      { notification_id: 1, destination: "all", message_id: "1" },
      { notification_id: 1, destination: "aiml", message_id: "2" },
      { notification_id: 2, destination: "aiml", message_id: null },
    ]);
    reopened.close();
  });

  it("throws on a delivery whose destination is unknown", () => {
    const path = join(dir, "malja.db");
    const store = openStore(path);
    store.insertJobs([job("1")], NOW);
    store.createNotifications(
      [{ group: groupByKey([job("1")])[0] as Group, destinations: ["all"] }],
      NOW,
    );
    store.close();

    const db = new DatabaseSync(path);
    db.exec("UPDATE deliveries SET destination = 'web3'");
    db.close();

    const reopened = openStore(path);
    expect(() => reopened.unsentDeliveries()).toThrow(/deliveries row 1: unknown destination web3/);
    reopened.close();
  });

  it("throws on a categories value that is not an array of known ids", () => {
    const path = join(dir, "malja.db");
    const store = openStore(path);
    store.insertJobs([job("1"), job("2")], NOW);
    const verdict: Verdict = {
      relevant: "yes",
      categories: ["swe"],
      degreeOk: "yes",
      workAuth: "none",
      reason: "",
    };
    store.setVerdict("1", verdict, NOW);
    store.setVerdict("2", verdict, NOW);
    store.close();

    const db = new DatabaseSync(path);
    db.exec(`UPDATE jobs SET categories = '["swe","web3"]' WHERE linkedin_id = '1'`);
    db.exec(`UPDATE jobs SET categories = '"swe"' WHERE linkedin_id = '2'`);
    db.close();

    const reopened = openStore(path);
    expect(() => reopened.getJobs(["1"])).toThrow(/jobs row 1: categories/);
    expect(() => reopened.getJobs(["2"])).toThrow(/jobs row 2: categories/);
    reopened.close();
  });
});

describe("Store", () => {
  let store: Store;
  beforeEach(() => {
    store = openStore(":memory:");
  });
  afterEach(() => {
    store.close();
  });

  it("round-trips jobs through insertJobs, hasJob, and getJobs", () => {
    const full = job("1");
    const sparse = job("2", { postedAt: null, description: null, skip: "stale" });
    expect(store.insertJobs([full, sparse], NOW)).toBe(2);
    expect(store.hasJob("1")).toBe(true);
    expect(store.hasJob("2")).toBe(true);
    expect(store.hasJob("3")).toBe(false);

    expect(store.getJobs(["2", "1", "3"])).toEqual([
      { ...sparse, firstSeenAt: NOW, verdict: null },
      { ...full, firstSeenAt: NOW, verdict: null },
    ]);
  });

  it("ignores an existing id and counts only new rows", () => {
    expect(store.insertJobs([job("1")], NOW)).toBe(1);
    expect(store.insertJobs([job("1", { title: "Changed" }), job("2")], NOW + 1)).toBe(1);
    expect(store.getJobs(["1"])[0]?.title).toBe("SWE Intern");
    expect(store.insertJobs([], NOW)).toBe(0);
  });

  it("stores and returns a verdict", () => {
    store.insertJobs([job("1")], NOW);
    const verdict = {
      relevant: "yes",
      categories: ["aiml", "perf"],
      degreeOk: "unclear",
      workAuth: "no_sponsorship",
      reason: "PhD preferred",
    } satisfies Verdict;
    store.setVerdict("1", verdict, NOW + 5);
    expect(store.getJobs(["1"])[0]?.verdict).toEqual(verdict);
  });

  it("round-trips an empty category list", () => {
    store.insertJobs([job("1")], NOW);
    const verdict: Verdict = {
      relevant: "unclear",
      categories: [],
      degreeOk: "unclear",
      workAuth: "unclear",
      reason: "classifier error: timeout",
    };
    store.setVerdict("1", verdict, NOW);
    expect(store.getJobs(["1"])[0]?.verdict).toEqual(verdict);
  });

  it("answers keyNotifiedSince from created_at regardless of sent state", () => {
    const jobs = [job("1"), job("2", { location: "Chicago, IL" })];
    store.insertJobs(jobs, NOW);
    const [group] = groupByKey(jobs) as [Group];
    store.createNotifications([{ group, destinations: ["all", "swe"] }], NOW);

    expect(store.keyNotifiedSince(group.key, NOW - 14 * DAY)).toBe(true);
    expect(store.keyNotifiedSince(group.key, NOW)).toBe(true);
    expect(store.keyNotifiedSince(group.key, NOW + 1)).toBe(false);
    expect(store.keyNotifiedSince(dedupeKey({ company: "Other", title: "Intern" }), 0)).toBe(false);
  });

  it("keeps each delivery pending until markDelivered covers it", () => {
    const a = [job("1"), job("2", { location: "Chicago, IL" })];
    const b = [job("3", { company: "Globex" })];
    store.insertJobs([...a, ...b], NOW);
    const [ga, gb] = groupByKey([...a, ...b]) as [Group, Group];
    const ids = store.createNotifications(
      [
        { group: ga, destinations: ["all", "aiml", "swe"] },
        { group: gb, destinations: ["all"] },
      ],
      NOW,
    );
    expect(ids).toHaveLength(2);

    const pending = store.unsentDeliveries();
    expect(pending.map((p) => [p.notificationId, p.destination])).toEqual([
      [ids[0], "all"],
      [ids[0], "aiml"],
      [ids[0], "swe"],
      [ids[1], "all"],
    ]);
    expect(pending[0]).toMatchObject({ key: ga.key, createdAt: NOW });
    expect(pending[1]?.jobs.map((j) => j.id)).toEqual(["1", "2"]);
    expect(pending[3]?.jobs.map((j) => j.id)).toEqual(["3"]);

    const [all, aiml, swe, other] = pending as [
      PendingDelivery,
      PendingDelivery,
      PendingDelivery,
      PendingDelivery,
    ];
    store.markDelivered(aiml.id, "msg-1", NOW + 1000);
    expect(store.unsentDeliveries().map((p) => p.id)).toEqual([all.id, swe.id, other.id]);

    store.markDelivered(all.id, "msg-2", NOW + 1000);
    store.markDelivered(swe.id, "msg-3", NOW + 1000);
    store.markDelivered(other.id, "msg-4", NOW + 1000);
    expect(store.unsentDeliveries()).toEqual([]);
    expect(store.keyNotifiedSince(ga.key, NOW)).toBe(true);
  });

  it("rolls back createNotifications when a group throws mid-transaction", () => {
    const jobs = [job("1"), job("2", { company: "Globex" })];
    store.insertJobs(jobs, NOW);
    const [good, bad] = groupByKey(jobs) as [Group, Group];
    const poisoned: Group = {
      ...bad,
      jobs: [
        {
          ...(bad.jobs[0] as Job),
          get id(): string {
            throw new Error("boom");
          },
        },
      ],
    };
    expect(() =>
      store.createNotifications(
        [
          { group: good, destinations: ["all", "swe"] },
          { group: poisoned, destinations: ["all"] },
        ],
        NOW,
      ),
    ).toThrow("boom");
    expect(store.unsentDeliveries()).toEqual([]);
    expect(store.keyNotifiedSince(good.key, 0)).toBe(false);
    // The connection is usable again after the rollback.
    expect(store.createNotifications([{ group: good, destinations: ["all"] }], NOW)).toHaveLength(
      1,
    );
  });
});
