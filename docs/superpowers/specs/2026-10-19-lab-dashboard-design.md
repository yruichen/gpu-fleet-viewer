# Laboratory dashboard improvements

## Purpose and scope

Improve the existing VS Code GPU Fleet Viewer for laboratory research: reliably inspect running experiments, find suitable resources, configure the extension, and ask questions about a snapshot of the fleet. No macOS widget is included. Computer Use and browser automation are prohibited by the user; verification uses compilation, parser tests, DOM interaction tests, local mock HTTP servers, and VSIX packaging.

## Existing defects

- Every progressive refresh rebuilds the dashboard DOM, dropping focus and inspector scroll position. Reconcile keyed server, GPU, process, and user nodes in place, with updated handlers.
- Filtering can overwrite active refresh progress. Keep refresh status independent of filter rendering.
- Hosts with zero GPUs disappear even when all servers are selected. Keep their explanatory empty state visible.
- SSH parser assigns shared options only to the last alias and lets wildcard/Match sections overwrite a preceding host. Track block aliases and stop inheritance at section boundaries; support quotes, comments, and equals syntax.
- The configured SSH file is used for discovery but not passed to monitoring. Pass its resolved path to ssh with `-F`.
- Data-affecting configuration changes during a query must queue one new refresh.

## Visual direction

Use existing VS Code theme tokens and a compact server/GPU matrix. Keep necessary colors: green availability, amber warning, blue focus/selection/actions. Use neutral surfaces and subtle separators; avoid repeated colored metric boxes. Show exact memory values, utilization, temperature, power, and owners. Restrict meters to meaningful comparisons, especially GPU memory and utilization. Use small consistent line icons from a licensed established icon library, with text labels and accessible names. Preserve search, selection, and focus during updates. Honor reduced motion.

## Laboratory resource tools

- Filter GPUs by minimum free memory in GiB, and servers by a minimum count of matching GPUs. These conditions combine with existing status, search, user, and sorting controls.
- A configured research username enables a “My tasks” filter. Explain how to configure it when absent.
- Provide an explicit reset action and visible result counts. Do not imply that free memory alone guarantees a job will fit.
- Reuse existing GPU availability notifications with clearer settings rather than creating a second alert system.

## Settings

Provide an in-dashboard settings dialog grouped into Servers, Refresh, Display, Availability, Notifications, and AI. Read current values on open. Save only edited fields, validate on both UI and extension-host boundaries, show save/error status, and preserve edits while background metrics update. Keep the native VS Code Settings command available. Use existing setting names and global scope. Provide server selection/addition actions and research username. Changing several fields causes at most one follow-up data refresh.

## AI assistant

- User supplies their own key; do not create keys or reuse local environment credentials.
- Support OpenAI-compatible Chat Completions and Anthropic Messages protocols, with a user-configured base URL and model ID. Accept a base URL or full protocol endpoint. Keep provider calls in the extension host and avoid runtime SDK dependencies.
- Store keys only in VS Code SecretStorage, scoped to protocol and API endpoint. Show only configured/not configured; endpoint changes require the matching saved key. Entry uses a password input owned by VS Code, never the Webview. Provide replacement and deletion.
- Show a separate compact chat dialog with suggestions for available GPUs, capacity, and current load. Provide loading state, cancel, clear conversation, and actionable authentication/timeout/network errors.
- Fleet context is opt-in per question. Preview the exact prepared context before sending; include collection timestamps, aliases, GPU identifiers, utilization, memory, availability, and user/process counts. Exclude physical addresses and full process commands by default. Add a separate explicit option for commands. Never include SSH config, key paths, SSH keys, passwords, or API credentials.
- Conversations stay in memory and are bounded. Only send requests in response to a user action; no automatic AI calls during monitoring. Render replies as plain text to avoid executing model-supplied HTML. No tools, remote command execution, job submission, or job cancellation.
- The assistant must distinguish missing/stale data and avoid claims about historical trends or job completion that snapshots cannot establish.

## Release automation

Run validation and packaging on GitHub. Publish a new stable package version automatically when it is merged into main; continue supporting matching version tags and manual reruns. Skip unchanged already released versions. Serialize Marketplace publishing and permit safe retry after partial success by skipping duplicate Marketplace versions. Create a GitHub tag/release for the same packaged commit and version. Scope the Marketplace credential to the publishing step. The existing repository secret is named VSCE_PAT; its presence was verified without reading its value.

## Verification and limits

Add focused regression tests for retained DOM identity, focus, process scroll, refresh/filter interaction, SSH blocks, and custom config arguments. Exercise resource filters and settings editing through the existing JSDOM preview. Verify AI request formats, endpoint handling, error sanitization, cancellation, and context exclusion using a local fake HTTP server with synthetic data and dummy credentials. Run the complete existing suite and package/inspect the VSIX. No live provider calls or visual screenshot claims. Remote publication requires the final changes to be pushed/merged; local configuration alone is not publication.
