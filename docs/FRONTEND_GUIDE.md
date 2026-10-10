# Frontend Guide

The frontend **replays Python results**. `engine.py` owns scheduling and process metrics; `app.py` owns Flask routing and the JSON API. Do not add a JavaScript scheduler or recalculate completion, waiting, turnaround, or response times.

## Files and communication

| File | Responsibility |
|---|---|
| `static/index.html` | Inputs, controls, CPU/queue, chart, log, and results |
| `static/js/script.js` | Input validation, `/simulate` requests, state, and playback |
| `static/css/style.css` | Existing mint design, responsive layout, and dark theme |
| `static/sample_result.json` | Canonical four-process backend result used by tests |
| `tests/test_frontend.cjs` | Node built-in test runner with a small DOM/timer adapter |

The page loads `/static/css/style.css` and `/static/js/script.js`. Run `python app.py` and visit http://127.0.0.1:5000; a file URL or separate static server cannot serve the API. See the [README](../README.md#setup-and-execution) for environment setup.

`getProcessesFromInputs()` returns trimmed `{pid, arrival, burst}` objects in row order. `runSRTF()` posts `{processes}` as JSON to `/simulate`. On success it checks `steps`, `gantt`, `metrics`, and `averages` before displaying anything. These fields follow the unchanged [interface contract](INTERFACE_CONTRACT.md).

HTTP 400/413 error messages are displayed as text. Other HTTP failures, invalid/non-JSON responses, and connection failures produce readable errors and empty results. There is no automatic fixture fallback: showing the sample for unrelated inputs would be misleading.

## Inputs and state

- Five default rows suggest P1–P5. Both numeric fields blank means an unused row; one blank numeric field means a validation error. The badge separately shows populated rows and all visible rows.
- Accept 1–15 populated rows. The Add Row control stops at 15 visible rows.
- PIDs are editable, trimmed, case-sensitive, unique, and 1–32 Unicode characters. Exact uppercase `IDLE` is reserved. Delete/add never renames unrelated rows.
- Arrival uses nonnegative decimal integer text; burst uses positive decimal integer text. Reject fractions, exponent/hex notation, non-finite values, and unsafe JavaScript integers. Text inputs preserve malformed input for validation instead of letting number-input sanitization turn it into an unused row.
- There are no extra frontend arrival/burst caps. The backend enforces the 10,000-unit simulation and 16 KiB body limits.
- The Load Sample rows are P1 `(0,8)`, P2 `(1,4)`, P3 `(2,9)`, P4 `(3,5)`.

`state.controller` tracks the current fetch. Duplicate Run calls return while it is pending. Input edits, row changes, Clear, and Load Sample abort it and increment `state.version`; responses from older versions cannot change results, errors, or a newer request's controls. Reset during a request also cancels it. Every invalidation stops playback and clears results immediately.

PIDs, event text, and API errors use `textContent` and DOM elements, never interpolated `innerHTML`. Color lookup uses a `Map`, so PIDs such as `__proto__` remain safe. Result rows follow the submitted array rather than JavaScript object-key order.

## Playback controls and event timing

| Control | Behavior |
|---|---|
| Run | Fetches and validates a result, then shows time 0 paused and its start events. |
| Play | Starts one recurring timeout. Disabled before a result or after completion. |
| Pause | Cancels the outstanding timeout and preserves the boundary snapshot. |
| Step Forward | Completes exactly one unit while paused. Disabled during playback. |
| Jump to End | Reconstructs the last boundary and reveals all final results immediately. |
| Timeline slider | Seeks to a selected boundary, reconstructing visible state and chronological events without a new request. |
| Reset | Stops the timer, clears later chart/log/metrics, and rewinds the saved result to time 0 with its initial snapshot/start events. Inputs remain. While fetching, cancels the request and requires Run again. |
| Speed | 1–20 ticks/second. Replaces the next timeout immediately during playback. |
| Clear / Load Sample / input edits | Cancel requests and playback, discard the result, and require another Run. |

At boundary `t`, the CPU shows `steps[t].running`, the queue uses `steps[t].ready` in its supplied order, and remaining work uses `steps[t].remaining`. Future processes in `remaining` are not automatically shown as waiting.

`prepareStep()` appends only the step's start events (`at === time`). The chart shows executed units before this boundary. `advance()` then:

1. Advances the clock by one and extends the chart to that boundary.
2. Appends completion events from the old step (`at === old time + 1`).
3. Shows the next step's snapshot and start events, or displays final metrics if finished.

This preserves completion-before-arrival ordering at a shared timestamp. A completion is never displayed merely because it exists in the current step. Pausing/resuming does not replay start events. Reset deliberately clears the old log before replaying time 0.

Only one timeout is pending, including for a 10,000-tick result. Each callback handles one tick and yields to the browser; speed changes, resets, and edits cancel that timer. The log appends new events without rebuilding its history during normal playback. Adjacent idle announcements collapse into one visible interval without modifying backend events. Seeking rebuilds the display once for the chosen boundary.

## Gantt and results

`renderGantt()` clips backend `gantt` intervals at the playback clock. The response validator checks agreement between each interval and `steps[].running`; this checks consistency, not scheduling choices. At completion the displayed intervals match the response exactly.

All intervals use `left = start × 48px` and `width = elapsed duration × 48px`. There is no minimum block width or percentage clamp. Border-box sizing and no inter-block margins preserve proportions. Idle blocks are striped; red preemption markers appear at the event's boundary. Start labels and the current end label show the times. Scrolling follows execution; while paused, users can scroll back. Long IDs use ellipsis inside short blocks and a full hover title. Full IDs are text in the CPU, queue, and results.

Metrics and averages come directly from the backend and appear at completion. Averages use two decimals. CPU utilization alone is a display statistic: total non-IDLE Gantt duration / final timeline duration × 100. Process colors remain stable across the CPU border, ready chips, chart borders, and results. Theme colors still use CSS variables; blocked local storage does not break startup or theme switching.

## Automated verification

```sh
python -m pytest -q
python engine.py
node --check static/js/script.js
node --test tests/test_frontend.cjs
```

Install `requirements-dev.txt` first. Node 18+ runs the frontend tests without npm packages. Set `SRTF_TEST_URL=http://127.0.0.1:5000` with Flask running to include seven live HTTP cases; see shell-specific commands in the README.

The Python suite covers API envelopes/errors, size boundaries, process limits, tie-breaking, preemption, idle time, timestamps, metric order, sample compatibility, and frontend asset serving. The Node suite covers validation, mapping, safe rendering, malformed replies, request races, control states, chronological events, proportions, and long playback. Its DOM adapter does not measure real CSS layout or actual browser timer throttling.

Field-level validation visually highlights the invalid input and uses row-specific accessible labels. CPU arrivals and preemptions receive brief highlights, which are suppressed for reduced-motion users.

## Manual browser checklist

Start Flask, open http://127.0.0.1:5000, and open DevTools Network/Console. Reload between fault-injection cases.

| Check | Procedure and expected result |
|---|---|
| Reference | Load Sample → Run. Confirm one POST with four `{pid,arrival,burst}` entries; time 0 is paused, CPU P1, no completions or final metrics. Play at 20×. Expect P1 `[0–1]`, P2 `[1–5]`, P4 `[5–10]`, P1 `[10–17]`, P3 `[17–26]`; averages 6.50 / 13.00 / 4.25. |
| Tick ordering | Step to t=1: CPU P2, queue P1, preemption marker at 1. P2 completes only at t=5. With A `(0,1)`, B `(1,1)`, completion A precedes arrival B at t=1. |
| One / five / fifteen | Fill one default row and leave the others unused; Run must succeed. Repeat with five and fifteen populated rows; Add Row disables at 15. Send 16 directly to `/simulate` to verify HTTP 400. |
| Validation | Try blank/duplicate/IDLE/33-character PIDs, a partial row, negative arrival, zero burst, fractions, and `9007199254740992`. Errors must clear old results. A 32-character custom PID is accepted. |
| Identity | Delete the middle row; later PIDs stay unchanged. Add another row; its suggestion is unused. Confirm result PIDs and request PIDs match. |
| All arrive at zero | Enter P2/P10/P1, all `(0,1)`. CPU order must be P1, P10, P2; result table stays in input order. |
| Equal remaining | P1 `(0,3)`, P2 `(1,2)`: P1 keeps the CPU to t=3 without preemption, then P2 runs to t=5. |
| Idle | Use P1 `(3,2)`: IDLE `[0–3]`, P1 `[3–5]`; waiting/response 0, utilization 40%. |
| Playback cancellation | Play then Pause: clock stops. Step advances one. Reset while playing: time 0, initial events only, metrics cleared. Edit an input while playing: display invalidates and stays stopped. |
| Duplicate/stale requests | With the delayed-fetch snippet below, click Run repeatedly: only one request. Clear, Reset, or Load Sample while pending: old results never reappear. Load Sample then Run again: the new response owns the display. |
| Backend unavailable | Stop Flask after loading the page, then Run. Expect the connection message and cleared results. Restart Flask afterward. |
| Non-JSON and size errors | Use the snippets below. Expect readable non-JSON/HTTP 413 errors with no unhandled promise rejection. Reload to restore normal requests. |
| Safe text | Use `<b>job</b>` as a PID. It must display literally, including in logs and final results. |
| Responsive/theme | Test widths around 375px, 768px, and 1440px, in both themes. Check controls, PID inputs, labels, table scrolling, and Gantt horizontal scrolling. A 1-unit bar must be exactly one fifth of a 5-unit bar, including borders. |
| Long run | Use arrival 9999, burst 1. Confirm the UI stays responsive, initial CPU is IDLE, scrolling works, and Pause/Reset/Clear cancel promptly. A full replay at 20× takes about 8 minutes 20 seconds. |

Delayed fetch, deliberately ignoring abort to test stale-response protection (DevTools Console):

```js
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options) => new Promise((resolve, reject) => {
  setTimeout(() => originalFetch(url, { ...options, signal: undefined }).then(resolve, reject), 3000);
});
```

Non-JSON error (reload first, run this, then press Run):

```js
window.fetch = async () => new Response('<html>Server error</html>', {
  status: 500, headers: { 'Content-Type': 'text/html' }
});
```

HTTP 413 (reload first):

```js
window.fetch = async () => new Response(JSON.stringify({ error: 'Request body is too large (maximum 16 KB).' }), {
  status: 413, headers: { 'Content-Type': 'application/json' }
});
```

Direct API limit check (reload first):

```js
fetch('/simulate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ processes: Array.from({ length: 16 }, (_, i) => ({ pid: `P${i}`, arrival: 0, burst: 1 })) })
}).then(async response => console.log(response.status, await response.json()));
```

## Completion status

- [x] Input, request, cancellation, response validation, and safe text rendering
- [x] Reference workload, playback controls, CPU/queue/log, proportional Gantt, final metrics
- [x] Backend and lightweight frontend automated regressions, including live HTTP integration
- [x] Real-browser visual and interaction checklist above
- [ ] Final presentation-laptop verification

The audit environment had no connected browser and could not create an in-app browser. Automated DOM-adapter and live HTTP checks cannot substitute for those pending visual checks. Random generation, export, CPU flashes, and continuous sub-tick animation are not implemented; playback advances in whole ticks.
