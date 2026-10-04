# Telegram

Code: `src/notifier/telegram.ts` (`TelegramNotifier`), `src/notifier/format.ts` (`escapeHtml`, `formatNotification`).

grammY's `Api` class, used for sends only. There is no `Bot` and no long polling. Nothing in v1 receives updates, and a bot that never polls cannot conflict with a dev instance on the same token. Commands are the only feature that would need polling, and polling brings the second-instance conflict, group privacy mode, and a permission model. `/health` covers status; pausing is a Railway stop. A later ticket can turn polling on without touching the send path.

## Layout

`sendMessage` with `parse_mode: "HTML"` and `link_preview_options: { is_disabled: true }`, because guest LinkedIn URLs preview as a login wall.

```
<b>Software Engineer Intern</b>
<i>Spectrum</i>
<a href="https://www.linkedin.com/jobs/view/111">Greenwood Village, CO</a> · <a href="https://www.linkedin.com/jobs/view/222">Englewood, CO</a>
#aiml #perf
ℹ️ no sponsorship · eligibility unclear
```

Each location links to its own posting, so a student taps the listing for their city. The italic company reads as a subtitle under the bold title, which leaves the title as the one visual anchor. The hashtag line prints each category as `#id`, space-separated, and is omitted when there are none. Telegram makes hashtags tappable, so the group can be filtered by category. Category channels get the identical message. The tag line is omitted when there are no tags. It carries one glyph for the whole line, `⚠️` if any tag is `warn` and `ℹ️` otherwise, so `US citizens only` is the only tag that turns the line into a warning. No posted time: the window is one hour and Telegram timestamps the message. No search label: a posting can match several searches and the label is already in the logs.

Title, company, location, and the `href` value all pass through `escapeHtml`, which replaces `&`, `<`, `>`, and `"`. URLs are LinkedIn's own.

The admin chat gets plain text with no parse mode.

## Rate limits

`@grammyjs/auto-retry` is installed on `api.config`. On a 429 it sleeps for Telegram's `retry_after` and retries, at most 3 times, and only when the wait is 60 seconds or less. A 5xx retries on the same cap with a short backoff. Past the cap `send` throws, the loop leaves that delivery unsent, moves on, and retries it next cycle. Network errors are not retried; they throw straight away for the same reason.

A burst of 20 or more keys in one cycle is rare in steady state but real after a LinkedIn backoff pause, when a whole window arrives at once. A fixed delay between sends was rejected because it taxes the usual three messages to protect the rare twenty-five.

## Losing a chat

Readiness is per destination. A send that fails with 403 "bot was kicked" or 400 "chat not found" flips `isReady(dest)` to false for that destination only, logs at `error` with the `destination`, and rethrows. Every `readyRetryMs` (default 5 minutes) the adapter runs `getMe` then `getChat` for that destination's chat. Success flips it back and logs at `info`; failure logs at `warn` and reschedules. Each lost destination has its own timer. Timers are unref'd so they never keep the process alive, and `stop()` clears them all. Any other send error throws without touching readiness. `start()` checks only `getMe`, so a wrong channel id shows up on its first send, not at boot.

## Chat ids

`TelegramNotifierOptions.chats` maps each destination to a chat id: `all` is required and comes from `TELEGRAM_GROUP_CHAT_ID`, and each category comes from its optional `TELEGRAM_CHANNEL_<ID>` (`TELEGRAM_CHANNEL_SWE`, `TELEGRAM_CHANNEL_AIML`, ...). A category with no chat id is not a destination. `TELEGRAM_ADMIN_CHAT_ID` is the admin chat. There is no discovery script and no runtime auto-discovery, which would guess wrong with a test group and a real group both present. Upgrading the group to a supergroup changes its id to a `-100`-prefixed one, and the env must follow. Channel ids are always `-100`-prefixed, and the bot must be an admin of each channel with the right to post messages.

## Testing

Unit tests answer every API call from a script. `TelegramNotifier` accepts `transformers`, installed under auto-retry, so a canned reply of 429 exercises the real retry path. CI makes no Telegram calls.

`pnpm notify:test` is the real check. It loads `.env`, calls `start()`, sends one sample notification with two linked cities, two categories, and both tags to every configured destination, logging each result, then one plain-text line to the admin chat. It exits 1 if any destination failed. Point `TELEGRAM_GROUP_CHAT_ID` and any `TELEGRAM_CHANNEL_<ID>` at private test chats first.
