import { autoRetry } from "@grammyjs/auto-retry";
import { Api, GrammyError, type Transformer } from "grammy";
import type { Logger } from "pino";
import { CATEGORIES } from "../classifier/types.ts";
import { log as rootLog } from "../log.ts";
import { formatNotification } from "./format.ts";
import type { Destination, Notification, Notifier } from "./types.ts";

/** Telegram 429 handling: sleep for `retry_after`, at most this many times, each wait at most this long. */
export const MAX_RETRY_ATTEMPTS = 3;
export const MAX_RETRY_DELAY_SEC = 60;
/** How long to wait between readiness probes after the bot lost a chat. */
export const READY_RETRY_MS = 5 * 60 * 1000;

export interface TelegramNotifierOptions {
  token: string;
  /** Chat id per destination. `all` is the group; a missing category is not routed. */
  chats: { all: string } & Partial<Record<Destination, string>>;
  adminChatId: string;
  readyRetryMs?: number;
  /** Installed before auto-retry, so a canned transformer in tests sits under it. */
  transformers?: Transformer[];
  log?: Logger;
}

/** The bot can no longer post to the chat. Nothing short of a human re-adding it will fix this. */
function lostChat(err: unknown): boolean {
  if (!(err instanceof GrammyError)) return false;
  if (err.error_code === 403 && /kicked/i.test(err.description)) return true;
  return err.error_code === 400 && /chat not found/i.test(err.description);
}

export class TelegramNotifier implements Notifier {
  /** Exposed so tests can install a transformer. */
  readonly api: Api;
  private readonly chats: Map<Destination, string>;
  private readonly adminChatId: string;
  private readonly readyRetryMs: number;
  private readonly log: Logger;
  /** Destinations currently accepting sends. Empty until `start()`. */
  private readonly ready = new Set<Destination>();
  private readonly retryTimers = new Map<Destination, NodeJS.Timeout>();

  constructor(opts: TelegramNotifierOptions) {
    this.api = new Api(opts.token);
    this.api.config.use(
      ...(opts.transformers ?? []),
      autoRetry({
        maxRetryAttempts: MAX_RETRY_ATTEMPTS,
        maxDelaySeconds: MAX_RETRY_DELAY_SEC,
        // Network errors would otherwise retry with unbounded backoff. Let them surface.
        rethrowHttpErrors: true,
      }),
    );
    this.chats = new Map();
    for (const dest of ["all", ...CATEGORIES] as const) {
      const chatId = opts.chats[dest];
      if (chatId !== undefined) this.chats.set(dest, chatId);
    }
    this.adminChatId = opts.adminChatId;
    this.readyRetryMs = opts.readyRetryMs ?? READY_RETRY_MS;
    this.log = opts.log ?? rootLog.child({ component: "notifier" });
  }

  /** One `getMe` so a bad token fails boot. No long polling: nothing in v1 receives updates. */
  async start(): Promise<void> {
    const me = await this.api.getMe();
    for (const dest of this.chats.keys()) this.ready.add(dest);
    this.log.info(
      { username: me.username, destinations: this.destinations() },
      "telegram bot ready",
    );
  }

  destinations(): Destination[] {
    return [...this.chats.keys()];
  }

  isReady(dest: Destination): boolean {
    return this.ready.has(dest);
  }

  async send(n: Notification, dest: Destination): Promise<{ messageId: string }> {
    const chatId = this.chats.get(dest);
    if (chatId === undefined) throw new Error(`no chat configured for destination ${dest}`);
    try {
      const result = await this.api.sendMessage(chatId, formatNotification(n), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      return { messageId: String(result.message_id) };
    } catch (err) {
      if (lostChat(err)) this.markLost(dest, err);
      throw err;
    }
  }

  /** Plain text, no parse mode. Logs and swallows, since an alert about a failure must not fail. */
  async sendAdmin(text: string): Promise<void> {
    try {
      await this.api.sendMessage(this.adminChatId, text);
    } catch (err) {
      this.log.error({ err }, "admin message failed");
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  private markLost(dest: Destination, err: unknown): void {
    if (!this.ready.delete(dest)) return;
    this.log.error(
      { err, destination: dest, readyRetryMs: this.readyRetryMs },
      "bot lost the chat; sends to it paused",
    );
    this.scheduleProbe(dest);
  }

  private scheduleProbe(dest: Destination): void {
    const timer = setTimeout(() => void this.probe(dest), this.readyRetryMs);
    timer.unref();
    this.retryTimers.set(dest, timer);
  }

  /** `getMe` plus `getChat` for that destination. Success makes it ready again; failure reschedules. */
  private async probe(dest: Destination): Promise<void> {
    this.retryTimers.delete(dest);
    try {
      await this.api.getMe();
      await this.api.getChat(this.chats.get(dest) as string);
      this.ready.add(dest);
      this.log.info({ destination: dest }, "bot can see the chat again; sends resumed");
    } catch (err) {
      this.log.warn(
        { err, destination: dest, readyRetryMs: this.readyRetryMs },
        "readiness probe failed",
      );
      this.scheduleProbe(dest);
    }
  }
}
