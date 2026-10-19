# Local assistant feedback fixes

User explicitly requested local-only work, one coherent pass, no push. Process feedback, authorization friction, generic network errors and restrictive budgets are one active task. Default tool-call cap must be disabled (0 = unlimited), with an optional user cap.

- [x] 1. Make actual model/network/tool stages and elapsed time visible inline; pair start/end records; clean failed placeholders.
- [x] 2. Inline exact-file approvals with allow once / remember / deny; suspend the pending tool and resume automatically; cancellation resolves pending approval. Keep sensitive-path validation.
- [x] 3. Preserve safe network error codes and request stage; distinguish HTTP errors, connection failure and response interruption. No real key or training data used for diagnosis.
- [x] 4. Default unlimited tool count, optional configured cap with continuation retaining completed results or bounded factual excerpts. Expand input/context/log/result capacities and avoid replaying completed actions. Retain permission boundaries.
- [x] 4a. User addition: move GPU/task expansion out of the server list into a right sidebar, with a narrow-window drawer, Escape/focus restoration, and stable task/scroll state through refresh.
- [x] 5. Meaningful local HTTP/controller/DOM checks, fresh full suite, package and install a local patch version. No Computer Use, real provider calls with credentials, Git push or Marketplace publication.

- Step 1 verified: real local HTTP emits connection/wait/receiving/tool phases; controller pairs operation IDs; actual preview DOM shows elapsed time inline, updates rather than duplicates tool rows, and terminates indicators on failure.

- Step 2: inline token-bound log permission pauses the actual tool; once/remember/deny resume automatically without native dialogs or another model question. Cancel/late tokens cannot grant access. Local HTTP/controller and DOM checks cover these paths.

- Step 3: preserved safe network codes and actual failure phase, bounded/redacted provider HTTP diagnostics. A deliberate local connection reset reproduces ECONNRESET and does not leak the dummy key. Anonymous HEAD of the configured public base endpoint returned HTTP 404 in ~0.9s from Node; this proves current reachability only, not prior request success or credential/model health.

- Step 4: actual controller completes 65 tool calls with default settings; a configured budget pauses and continues without replay. 5,000 small tool outputs compact below 1MiB history and serialize through both protocol clients. Cancel during log approval then continue requests a fresh approval and really performs the read. The DOM bounds finished records/details without limiting execution. Read-only review found and confirmed fixes for all three continuation/memory defects.

- Step 4a: local DOM checks verify inspector is outside server bands, closes with button/Escape and restores original card focus, and retains the same task nodes and both scroll containers during updates. Static review found no important regression; no real-window visual verification was performed.

- Step 5: `npm test` passed for 1.4.1 (compile, lint, locales, monitor, AI protocols, task boundaries, reminders, controller, release, refresh, preview/DOM). The additional actual 500-line/>64KiB log read and smaller byte-bound checks also passed. `git diff --check` passed and production npm audit reported zero vulnerabilities. VSIX manifest/runtime/defaults inspected; local install succeeded and CLI reports `yruichen.gpu-fleet-viewer@1.4.1`. VSIX SHA256: `e6e174a326ee29d5265ee73db684a383d064a3cb3bf99bb8568f5e09113ccf9c`. The user must reload the window to activate it; no automatic reload, push or publication performed.
