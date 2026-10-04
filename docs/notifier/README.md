# notifier

Delivering one message per new dedupe key to each of its destinations (the all-jobs group plus a channel per configured category), and throttled alerts to the admin. A `Notifier` interface with Telegram as the first adapter. Everything is under `src/notifier/`, re-exported from `src/notifier/index.ts`, which also holds the `createNotifier` factory. `src/index.ts` never imports grammY.

## Docs

- [interface.md](interface.md) - the `Notification`, `Destination`, and `Notifier` types, method contracts, routing, the `isReady` rules, the factory.
- [telegram.md](telegram.md) - message layout and escaping, auto-retry caps, lost-chat handling, chat ids per destination, `pnpm notify:test`.
- [alerts.md](alerts.md) - alert conditions, the one-hour throttle, who detects what.
