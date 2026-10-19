# GPU Task Assistant Implementation Plan

> Execute inline with superpowers:executing-plans. User approved the revised spec and explicitly requested execution.

**Goal:** Keep the dashboard and provide a compact, contextual GPU assistant that investigates through local SSH and manages useful reminders.
**Architecture:** Reuse the monitor and Webview. Add bounded task queries, extension-owned reminders and native OpenAI/Anthropic tool turns; render safe Markdown in the host.
**Stack:** TypeScript, Node HTTP/SSH, VS Code Webview, markdown-it with HTML/images disabled.
**Spec:** ../specs/2026-10-19-gpu-task-assistant-design.md

## Constraints

Local desktop SSH only; no arbitrary command execution, remote writes, Computer Use, real provider credentials or automatic publication. Preserve settings and dashboard focus. Logs require explicit task-path authorization. Meaningful boundary checks only.

## Review focus

- Model tool arguments and remote output are untrusted; validate host/PID/path/operation before execution.
- A disappearing worker, stale snapshot or PID reuse must not claim successful job completion.
- Tool results must retain protocol ordering through subsequent turns, cancellation and errors.
- Reminders survive closing the panel and do not invoke AI or duplicate notifications.
- Markdown must not execute HTML, load tracking images or open command links.

## Tasks

- [x] 1. Local SSH/task evidence: add `taskQueries.ts`; expose cancellation-aware monitor execution to trusted query code. Check process ancestry, bounded authorized log reads, progress estimation and injection rejection using synthetic local process/file data. Update desktop extension kind.
- [x] 2. Shared task service/reminders: add `taskService.ts` and `reminders.ts`; reuse snapshots/in-flight queries; persist reminder conditions and log grants; attach lifecycle at extension activation. Check stable free state, task identity, deadlines and deduplication with a controlled clock.
- [x] 3. Native AI tools: extend `aiClient.ts`, replace controller opt-in context with automatic scoped context, tool turns and streamed text. Local HTTP fixtures verify both protocols, result ordering, limits and cancellation; no real API calls.
- [x] 4. UI: replace assistant internals with chat plus sidebar in the existing dialog; safe Markdown, IME-safe input, code copy, tool evidence, log authorization and reminders. Rebuild GPU inspector as a task list and readable details; retain focus/scroll. Update actual DOM checks and preview fixtures.
- [x] 5. Integration/review: compile, lint, run affected and existing checks, review connected code, update README/changelog and prepare a local VSIX. No push, merge or publish without a concrete reviewable result.

## Execution ledger

- Start: branch `agent/gpu-task-assistant`, based on origin/main; original working tree only contained the approved draft spec. Work remains in the user-visible checkout to avoid duplicating the workspace/dependencies. No separate worktree needed for this single active change.
- Ruling: explicit “开始执行” authorizes inline execution of this approved scope; do not add another permission round for the implementation plan.

- Tasks 1–4 implemented: native protocol tools and streaming, local SSH investigation and authorized logs, phase progress, extension-owned reminders, compact chat/sidebar, task inspector and scoped GPU settings.
- User scope additions implemented: individual GPU masks, monitored/excluded hosts, notification events, section draft reset, dependent controls, unsaved close protection and return from AI settings to chat.
- Meaningful checks: real local HTTP protocol/controller flows, actual local bounded file reads and injection rejection, controlled reminder time/identity, real monitor/controller parsing at the external SSH boundary, actual preview DOM interactions. No Computer Use, live provider or research host used. Linux /proc success path was not exercised on this macOS host; unsupported-host failure was exercised.
- Independent read-only review found four Important issues. Fixed scope escape through cached ancestors, worker-vs-launcher reminder identity, streaming compatibility retry, and Node far-future timer overflow; reproducing assertions now cover each behavior. Also guarded deadline-edit/tick interleaving.
- Full npm test passed after review fixes. Production dependency audit passed against registry.npmjs.org (configured mirror does not provide audit endpoints). git diff --check passed. Packaging is being refreshed after final edits.
- No deferred minor findings from the independent reviewer. No production credentials or real task data were used in fixtures.

- Final: npm test (compile, lint and all check groups) passed after all production edits; VSIX 1.4.0 packaged and manifest/runtime inclusion inspected. No Marketplace publication or installation into the user’s VS Code was performed. GitHub fetch failed over HTTP/2 and timed out with HTTP/1.1; no remote branch change was attempted.
- Additional setting consistency fix: prepared GPU terminal commands now reuse the selected SSH config; the command remains unexecuted. Native Remote-SSH Connect continues to use that extension’s own configuration.
