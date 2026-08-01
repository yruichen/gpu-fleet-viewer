# Changelog

All notable changes to GPU Fleet Viewer are documented here.

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
