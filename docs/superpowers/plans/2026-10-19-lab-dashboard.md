# Laboratory dashboard implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, as approved by the user. Track completion here.

**Goal:** Deliver a stable, restrained GPU dashboard with laboratory resource filters, accessible settings, optional AI assistance, and automatic Marketplace releases.

**Architecture:** Retain the existing extension/Webview architecture. Share a validated settings schema between the host and settings UI; keep AI transport/context in a separate host module, and dialogs/icons in separate view modules. Use built-in Node HTTP clients and SecretStorage.

**Tech Stack:** TypeScript, VS Code APIs, DOM, JSDOM, Node HTTP/HTTPS, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-lab-dashboard-design.md`.

## Global constraints

- No Computer Use or browser automation. No screenshot verification claims.
- Keep compatibility with VS Code 1.80; no fetch/SDK runtime dependency.
- Keys are user supplied, stored in SecretStorage per endpoint/protocol, and never exposed to the Webview.
- AI makes requests only on explicit Send. Fleet context is optional and previewed; no remote execution.
- Maintain English/Chinese locale parity and VS Code theme support.

## Review focus

- Incremental refresh must retain live controls and inspector scroll/focus.
- Editing settings during background refresh must not overwrite unsaved changes.
- Endpoint changes must not send a previously configured provider's key.
- Cancellation/errors must leave chat usable without leaking keys or server responses.
- Retrying a release after Marketplace success must complete the GitHub Release.

## Tasks

### 1. Refresh and SSH defects

Files: `src/webviewTemplate.ts`, `src/sshConfig.ts`, `src/gpuMonitor.ts`, `src/gpuView.ts`, existing tests.

- [x] Reproduce focus/scroll loss and SSH block bugs with failing tests.
- [x] Reconcile keyed nodes and preserve refreshing state during filtering.
- [x] Parse shared alias blocks correctly and pass custom config through `MonitorOptions.sshConfigPath`.
- [x] Run the complete suite after final integration.

### 2. Preferences and resource filters

Files: new `src/preferences.ts`, `src/preferencesView.ts`; modify `src/gpuView.ts`, `src/webviewTemplate.ts`, `package.json`, locales, and Webview checks.

Interfaces: export `preferenceFields`, `validatePreferenceChanges(values): Record<string, unknown>`, settings HTML/CSS/script helpers. Host posts `preferences` values; UI sends only dirty fields with `savePreferences`.

- [x] Test invalid/unknown values, retained dirty edits, minimum GiB and matching GPU count, reset, and My tasks.
- [x] Implement field groups and key-management actions; batch saves into one refresh.
- [x] Refine typography, spacing, semantic colors, meaningful meters, and licensed line icons.
- [x] Run locale and Webview checks.

### 3. AI transport and chat

Files: new `src/aiClient.ts`, `src/assistantView.ts`, `scripts/checkAi.js`; modify `src/gpuView.ts` and package scripts.

Interfaces: export `aiEndpoint(protocol, baseUrl): URL`, `aiSecretKey(protocol, baseUrl): string`, `buildFleetContext(data, includeCommands): string`, `askAi(options, messages, context, signal): Promise<string>`.

- [x] Test OpenAI/Anthropic payloads on local HTTP server, endpoint normalization, cancellation, errors, size limits, and context exclusions.
- [x] Implement bounded transport and error handling with no redirects or secret-bearing error output.
- [x] Implement context preview, chat history, loading, cancellation, clear, and safe plain text output.
- [x] Test dialog interactions without external requests.

### 4. Release and delivery

Files: `.github/workflows/release.yml`, `docs/PUBLISHING.md`, `README.md`, `CHANGELOG.md`, package/version files.

- [x] Trigger new stable versions on main, preserve tag/manual paths, serialize publication, skip duplicate Marketplace versions, scope secrets.
- [x] Explain release setup and optional AI configuration.
- [x] Run `npm test`, production audit, and VSIX packaging/file inspection.
- [x] Review final diff and record actual verification/remaining limitations.

## Execution ledger

- User approved the written spec and requested implementation in this session.
- Existing feature branch: `agent/dashboard-ux-refresh`; initial working tree was clean. Work stays in this branch.
- Initial suite passed. New regression tests failed on node replacement and custom SSH config before fixes.
- Browser access was unavailable/denied; user then explicitly prohibited Computer Use. All further work uses code/CLI only.

- Final verification: `npm test` passed (compile, lint, locale parity, parsers, protocol/context/cancellation, release decisions, refresh coalescing, and DOM interactions). Production audit found 0 vulnerabilities. VSIX packaging and file inspection passed; artifact is `releases/gpu-fleet-viewer-1.3.0.vsix` (160952 bytes).
- No runtime dependency was added. Icons are vendored from Lucide 0.468.0 with the license included.
- No Computer Use, live AI-provider calls, pushes, merges, or Marketplace publication were performed. Actual visual rendering and real provider credentials remain unverified.
