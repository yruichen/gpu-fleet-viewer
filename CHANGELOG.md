# Changelog

All notable changes to GPU Fleet Viewer are documented here.

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
