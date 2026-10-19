# Changelog

All notable changes to GPU Fleet Viewer are documented here.

## 1.4.2 - 2026-10-19

- Let the model explore observed task directories and open-file/path metadata, then request authorized head/tail text from actual files, without filename templates or question routing rules.
- Remove fixed-format progress extraction; send raw task evidence for model interpretation. Retain exact-file approval, read-only operations and sensitive-path protection.
- Retry non-streaming requests with tools before plain-chat fallback; explicitly show when the API/model cannot support investigation tools.
- Automatically collapse completed operation records after the final answer, with manual re-opening; distinguish user inputs, assistant answers and failures using restrained message styling.
- Share one SSH concurrency budget across dashboards, assistant queries and reminders; coalesce matching snapshots, reuse very recent data, and back off failed automatic queries while preserving immediate manual retries.
- Reorganize the dashboard header, actionable availability/warning summaries, search and compact filters; move language into settings and standardize the product name as GPU Fleet.
- Distinguish task details from the main dashboard and replace the extension, sidebar and dashboard marks with one simplified chip symbol.

## 1.4.1 - 2026-10-19

- Show actual AI connection, waiting, response and tool stages inline with elapsed time and expandable evidence.
- Replace log authorization dialogs with exact-file inline allow-once, remember and decline actions that automatically resume the pending query.
- Preserve safe network error codes, request phases and redacted HTTP diagnostics; retain pending work for retry, including cancellation during authorization.
- Default to unlimited tool calls, with an optional user budget and continuation; expand question, context, response, timeout and configurable log-read capacities.
- Compact old tool groups without breaking protocol pairs and bound displayed activity details so long investigations can keep running.
- Move GPU/task details into a right sidebar or narrow-window drawer, retaining selection and scroll through refreshes, with Escape and focus restoration.

## 1.4.0 - 2026-10-19

- Kept the dashboard and rebuilt AI as a compact chat dialog with a task/context sidebar, safe Markdown tables/code, streaming, cancellation, keyboard input and query evidence.
- Added native OpenAI/Anthropic tool turns for fresh GPU status, parent-process tracing, bounded host diagnosis, Slurm details/accounting and explicitly authorized task-log tails.
- Required local desktop extension execution so SSH uses the local network, SSH configuration, agent and jump hosts, including in remote workspaces.
- Added evidence-based progress/phase ETA and explicit unknown states; no arbitrary shell, task termination, remote writes or automatic training changes.
- Added persistent GPU release, verified task-end and scheduled reminders, independent of dashboard visibility, with deadlines and cancellation.
- Added per-server GPU visibility settings and consistent dashboard/statistics/AI scope, individual notification events, section resets, dependent controls and unsaved-change protection.
- Replaced the narrow process table with a selectable task list, readable commands, parent-process evidence and direct assistant/reminder actions.

## 1.3.0 - 2026-10-19

- Fixed dashboard flicker and jumping by preserving server, GPU, and process DOM nodes, keyboard focus, and inspector scroll during progressive refreshes.
- Preserved refresh progress while filtering, stopped opening the dashboard on extension activation, and reused fresh snapshots when returning to a panel.
- Added memory/card-count resource filters, My tasks, explicit filter reset, and retained filter/selection state across Webview reloads.
- Added grouped in-dashboard settings with validation, explicit saves, preserved unsaved edits, and batched refreshes.
- Refined dense layouts with neutral surfaces, semantic colors, readable metrics, and licensed Lucide line icons.
- Added optional OpenAI-compatible and Anthropic AI question answering with endpoint-scoped SecretStorage keys, previewed opt-in context, cancellation, and in-memory conversation history.
- Fixed shared SSH alias options, wildcard/Match block isolation, quoted/commented config values, and use of custom SSH config files for monitoring.
- Added automatic Marketplace publication for new stable versions merged into main, with matching GitHub releases and retry support.

## 1.2.0 - 2026-08-03

- Added persistent English and Simplified Chinese dashboard switching with independently managed locale files and locale parity checks.
- Reworked refresh scheduling to keep cached data visible, publish host results progressively, coalesce repeated requests, and wait until a refresh completes before scheduling the next automatic cycle.
- Prevented visual, language, threshold, favorite, and server-metadata changes from triggering unnecessary SSH queries.
- Added session-level snapshot reuse and removed the redundant health retry after a failed snapshot query.
- Added visual utilization meters for fleet summaries, GPU metrics, host memory, and disk usage while retaining exact numeric values.
- Moved unreachable servers into a collapsed, neutral unavailable-server section that expands for offline filtering and matching searches.
- Added tag-driven GitHub Actions automation for Marketplace publishing, VSIX artifacts, and GitHub Releases.

## 1.1.0 - 2026-08-01

- Reframed the dashboard around the daily research workflow: find a GPU, understand its owner and job, and enter a prepared SSH environment.
- Added configurable, explainable availability rules based on compute processes, used memory, and utilization.
- Added fleet search, status filters, GPU sorting, active-user aggregation, and an available-GPU Quick Pick command.
- Added full process commands, runtimes, copy actions, and best-effort Slurm job association.
- Added safe research terminals that prepare UUID-based `CUDA_VISIBLE_DEVICES` commands without executing them.
- Added lightweight CPU load, host memory, root disk, uptime, SSH latency, stale-data timestamps, and categorized connection errors.
- Added local aliases, groups, favorites, and duplicate physical-host detection with aggregate de-duplication.
- Added server and GPU state notifications with event selection and cooldown controls.
- Improved performance with bounded SSH concurrency, hidden-dashboard pausing, low-frequency Slurm caching, duplicate-host query suppression, and client-side filtering.
- Expanded parser, availability, aggregation, duplicate-host, responsive Webview, filter, and inspector tests.

## 1.0.0 - 2026-08-01

- Published GPU Fleet Viewer on the Visual Studio Marketplace as `yruichen.gpu-fleet-viewer`.
- Introduced the GPU Fleet Viewer name and a consistent extension namespace.
- Added automatic migration of settings from the legacy `gpu-server-viewer` namespace.
- Redesigned the dashboard around a fleet summary, server bands, and a responsive GPU matrix.
- Added utilization, memory, temperature, power, fan, and process-owner metrics.
- Added a full-width process inspector without changing GPU tile heights.
- Replaced slow XML collection with focused CSV queries.
- Added argument-safe SSH execution, batch authentication, timeouts, refresh locking, and friendly errors.
- Added configurable metrics, warning thresholds, alerts, server visibility, and status-bar summaries.
- Added parser, monitor, preview, and Webview interaction checks.

## Upstream history

This release is based on [Riku-0801/gpu-server-observer](https://github.com/Riku-0801/gpu-server-observer). See [NOTICE](NOTICE).
