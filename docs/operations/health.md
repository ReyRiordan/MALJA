# Health endpoint

Code: `src/ops/health.ts`.

```ts
startHealthServer(port, status: () => LoopStatus, log?): Promise<{ port; close() }>
```

Plain `node:http` on `PORT`, started after the notifier and before the first cycle. `GET /health` answers 200 with JSON. Every other path or method is 404. Port 0 picks a free port, which the tests use.

## Body

```json
{
  "status": "ok",
  "lastCycleAt": "2026-09-05T12:00:00.000Z",
  "lastSuccessfulCycleAt": "2026-09-05T12:00:00.000Z",
  "pausedUntil": null,
  "notifierReady": { "all": true, "aiml": false },
  "uptimeSec": 3612
}
```

| Field | Meaning |
| --- | --- |
| `status` | See below. |
| `lastCycleAt` | Start of the last cycle, whether or not it succeeded. Null before the first. |
| `lastSuccessfulCycleAt` | Start of the last cycle that threw nothing. Null until one has. |
| `pausedUntil` | End of the LinkedIn backoff pause, or null. |
| `notifierReady` | `notifier.isReady(dest)` for each configured destination, `all` first. |
| `uptimeSec` | `process.uptime()`, rounded. |

## Status rules

Checked in this order; the first match wins.

| `status` | When |
| --- | --- |
| `notifier_down` | `isReady` is false for at least one destination: the bot lost that chat and its probe has not passed yet. That destination's deliveries pile up unsent; `notifierReady` says which, and the others keep sending. |
| `paused` | `pausedUntil` is in the future. Cycles are deferred until then. |
| `stale` | No successful cycle for more than 3 poll intervals (15 min at the default), measured from boot when none has succeeded yet. A repeating `cycle_failed` shows up here. |
| `ok` | Otherwise. |

## Always 200

Railway hits the healthcheck at deploy time and restarts the container on process exit, not on a failing check. A non-200 would buy nothing at runtime and would fail a redeploy during a one-hour block pause for no reason. The body carries the detail; read it with `curl` or point an external monitor at it and alert on `status != "ok"`.
