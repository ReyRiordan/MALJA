import type { Category } from "../classifier/types.ts";

/** One levelled tag. `warn` is reserved for the tag that rules most of the group out. */
export interface Tag {
  text: string;
  level: "info" | "warn";
}

/** One message: a dedupe key with every city it was posted in, plus pre-worded tags. */
export interface Notification {
  /** Dedupe key, for logging only. */
  key: string;
  title: string;
  company: string;
  /** First-appearance order, deduped by location. */
  postings: { location: string; url: string }[];
  /** The verdict's categories, may be empty. Printed as hashtags. */
  categories: Category[];
  /** Pre-worded and levelled, may be empty. Adapters print them, they do not interpret them. */
  tags: Tag[];
}

/**
 * Where a notification goes: `all` is the group that gets everything, a category is that
 * category's channel. Only the adapter maps a destination to a chat.
 */
export type Destination = "all" | Category;

/** Delivery interface. Telegram is the first adapter. */
export interface Notifier {
  /** Verifies credentials once. A bad token is a boot error. Does not start receiving updates. */
  start(): Promise<void>;
  /** The configured destinations, `all` first, then categories in `CATEGORIES` order. */
  destinations(): Destination[];
  /** False after a send failed because the bot lost that chat, true again once its probe passes. */
  isReady(dest: Destination): boolean;
  /** Sends one notification to one destination. Throws when it cannot; the loop retries next cycle. */
  send(n: Notification, dest: Destination): Promise<{ messageId: string }>;
  /** Plain-text alert to the admin. Never throws. */
  sendAdmin(text: string): Promise<void>;
  /** Releases any held connection. A no-op for Telegram. */
  stop(): Promise<void>;
}
