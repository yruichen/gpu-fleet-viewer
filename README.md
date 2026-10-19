# GPU Fleet Viewer

[![CI](https://github.com/yruichen/gpu-fleet-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/yruichen/gpu-fleet-viewer/actions/workflows/ci.yml)
[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/yruichen.gpu-fleet-viewer?label=Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=yruichen.gpu-fleet-viewer)
[![Marketplace installs](https://img.shields.io/visual-studio-marketplace/i/yruichen.gpu-fleet-viewer)](https://marketplace.visualstudio.com/items?itemName=yruichen.gpu-fleet-viewer)
[![Latest release](https://img.shields.io/github/v/release/yruichen/gpu-fleet-viewer)](https://github.com/yruichen/gpu-fleet-viewer/releases/latest)
[![License](https://img.shields.io/github/license/yruichen/gpu-fleet-viewer)](LICENSE.txt)

A fast, privacy-friendly research workstation for finding, understanding, and using NVIDIA GPUs across SSH servers without leaving VS Code.

![GPU Fleet Viewer 1.1 research dashboard](docs/dashboard-1.1.0.png)

## Highlights

- Find available GPUs across every configured SSH host with explainable availability rules.
- Search and filter by server, GPU model, user, process command, or Slurm job.
- Responsive server bands and independent process inspectors for dense 8-GPU machines.
- GPU utilization, memory, temperature, power draw/limit, and fan speed.
- Click-to-inspect process details: owner, PID, full command, runtime, GPU memory, and optional Slurm job.
- One-click research terminals with a stable GPU UUID in `CUDA_VISIBLE_DEVICES`; commands are prepared but never auto-executed.
- Lightweight host health for CPU load, RAM, root disk, uptime, and SSH latency.
- Local server aliases, groups, favorites, and duplicate physical-host detection.
- Configurable metrics, warning thresholds, notifications, refresh interval, and SSH timeout.
- Available-GPU count in the VS Code status bar.
- Resource filters for minimum free memory per GPU and matching GPU count per server, plus a **My tasks** filter.
- In-dashboard settings for servers, refresh behavior, display, availability rules, notifications, and optional AI.
- Compact AI chat with a context/reminder sidebar, Markdown, streaming, local SSH task investigation, and your own OpenAI-compatible or Anthropic endpoint.
- Per-server GPU selection, parent-process tracing, authorized log progress, and persistent release/task-end/timed reminders.
- Direct **Connect SSH** action for Remote - SSH users.
- High-performance SSH snapshots, bounded concurrency, hidden-panel pausing, cached Slurm metadata, duplicate-query suppression, and overlapping-refresh protection.
- No telemetry and no stored passwords or private keys.

## Requirements

- Desktop VS Code 1.80 or newer, with the extension installed **locally**. Local SSH is not available in browser-only VS Code.
- `ssh` available on the computer running VS Code.
- `nvidia-smi` installed on each monitored server. Advanced task inspection requires Linux `/proc` and `python3` on the SSH host; basic GPU monitoring does not.
- Non-interactive SSH authentication, normally an SSH key and `BatchMode=yes` compatibility.
- Optional: [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) for the **Connect SSH** button.

## Install

Install [GPU Fleet Viewer from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=yruichen.gpu-fleet-viewer), search for `GPU Fleet Viewer` in the VS Code Extensions view, or run:

```bash
code --install-extension yruichen.gpu-fleet-viewer
```

For offline installation, download the latest `.vsix` from [GitHub Releases](https://github.com/yruichen/gpu-fleet-viewer/releases/latest), then run:

```bash
code --install-extension gpu-fleet-viewer-1.4.0.vsix
```

Reload VS Code and open **GPU Fleet** from the Activity Bar.

## Configure servers

The extension discovers concrete hosts from `~/.ssh/config`; wildcard entries are ignored. A minimal entry looks like this:

```sshconfig
Host gpu-node-01
    HostName 192.0.2.10
    User researcher
    IdentityFile ~/.ssh/id_ed25519
```

You can also run **GPU Fleet Viewer: Add Server** and enter an SSH alias, hostname, IP address, or `user@host`. Use **Configure Servers** from the view toolbar to hide hosts you do not want to monitor.

## Research workflow

1. Run **GPU Fleet Viewer: Find Available GPU**, or filter the dashboard to **Available**.
2. Review the availability explanation, free memory, host health, and active users.
3. Select **Open terminal**. The extension creates an integrated terminal and prepares an SSH command that exports `CUDA_DEVICE_ORDER=PCI_BUS_ID` and the selected GPU UUID.
4. Inspect the command and press Enter when ready. GPU Fleet Viewer never starts or stops research jobs automatically.

When Slurm is installed, the extension detects it automatically and associates local GPU processes with visible job metadata. Ordinary SSH servers continue to work without Slurm.

## Settings

Open **Settings** in the dashboard for common options, or search for `GPU Fleet Viewer` in VS Code Settings. Set **My remote username** to enable **My tasks**. Resource filters combine with search, status, and user filters; available memory is a snapshot and does not guarantee that a workload will fit.

Settings are saved explicitly. **Servers → Visible GPUs per server** lets you select individual cards; omitting a server selects all its cards, including future additions. Scope applies to dashboard statistics, available-GPU selection and default AI context. Existing reminders continue monitoring hidden cards. Background refreshes preserve unsaved edits, selected GPU, filters, keyboard focus, and inspector scroll. Closing settings with unsaved changes offers save or discard; resetting a section changes the draft until saved. The dashboard opens when requested; activating the extension no longer replaces your current editor.

| Setting | Default | Purpose |
| --- | ---: | --- |
| `gpu-fleet-viewer.visibleGpus` | `{}` | Map SSH aliases to GPU indices or UUIDs; omitted alias = all, empty list = none |
| `gpu-fleet-viewer.language` | `auto` | Follow VS Code or use English/简体中文; the dashboard toolbar also switches instantly |
| `gpu-fleet-viewer.autoRefresh` | `true` | Refresh automatically |
| `gpu-fleet-viewer.refreshInterval` | `5` | Refresh interval in seconds |
| `gpu-fleet-viewer.sshTimeout` | `8` | SSH and command timeout in seconds |
| `gpu-fleet-viewer.maxConcurrentHosts` | `8` | Bound concurrent SSH snapshots |
| `gpu-fleet-viewer.pauseWhenHidden` | `true` | Stop automatic SSH work while the dashboard is hidden |
| `gpu-fleet-viewer.compactLayout` | `true` | Use the dense fleet matrix |
| `gpu-fleet-viewer.showUtilization` | `true` | Show GPU utilization |
| `gpu-fleet-viewer.showTemperature` | `true` | Show GPU temperature |
| `gpu-fleet-viewer.showPower` | `true` | Show power draw and limit |
| `gpu-fleet-viewer.showFanSpeed` | `true` | Show fan speed when supported |
| `gpu-fleet-viewer.showProcesses` | `true` | Show process inspection |
| `gpu-fleet-viewer.showHostHealth` | `true` | Show load, RAM, disk, uptime, and latency |
| `gpu-fleet-viewer.enableSlurmIntegration` | `true` | Detect Slurm and associate jobs |
| `gpu-fleet-viewer.slurmRefreshInterval` | `30` | Cache duration for Slurm metadata |
| `gpu-fleet-viewer.availabilityRequireNoProcesses` | `true` | Require no compute processes |
| `gpu-fleet-viewer.availabilityMaxMemoryMiB` | `512` | Maximum used memory for availability |
| `gpu-fleet-viewer.availabilityMaxUtilization` | `10` | Maximum utilization for availability |
| `gpu-fleet-viewer.showStatusBar` | `true` | Show fleet availability in the status bar |
| `gpu-fleet-viewer.enableNotifications` | `false` | Notify on newly crossed warning thresholds |
| `gpu-fleet-viewer.researchUser` | empty | Remote username used by **My tasks** |
| `gpu-fleet-viewer.ai.protocol` | `openai` | OpenAI-compatible Chat Completions or Anthropic Messages |
| `gpu-fleet-viewer.ai.baseUrl` | `https://api.openai.com/v1` | Custom API base URL or full endpoint |
| `gpu-fleet-viewer.ai.model` | empty | Model ID provided by your API service |
| `gpu-fleet-viewer.ai.timeoutSeconds` | `120` | AI response timeout, up to 900 seconds |
| `gpu-fleet-viewer.ai.maxToolCalls` | `0` | Tool calls per turn; 0 = unlimited. A positive budget pauses with a Continue action |
| `gpu-fleet-viewer.ai.logTailLines` | `500` | Task log tail lines per read, up to 10,000 |
| `gpu-fleet-viewer.ai.logTailKiB` | `256` | Task log bytes per read, up to 2,048 KiB |

Target lists, ignored hosts, SSH config path, and warning thresholds are also configurable. Settings from the earlier `gpu-server-viewer` namespace are migrated automatically on first activation.

## Optional AI assistant

1. Open dashboard **Settings → AI**, choose the protocol, enter your provider's API URL and model ID, and save.
2. Select **Set / replace key**. VS Code prompts for the key using a password field and saves it in SecretStorage for that protocol and endpoint. It is never stored in `settings.json` or passed to the Webview.
3. Open **AI assistant**, or select **Ask AI** in a GPU's task inspector. The dashboard remains behind a compact chat window. The sidebar shows the conversation scope, data time, authorized logs, and reminders. Clicking a GPU opens its task inspector in a separate right sidebar, with a drawer on narrow windows; close it with its close button or Escape.

The current visible fleet summary is included automatically when you send a question. The model chooses how to investigate using local SSH tools: trace workers to their launcher, inspect Slurm queue/accounting, compare resources, explore task directories and request explicitly authorized text. Discovery returns metadata from actual working directories, arguments, open files and observed subdirectories, without filename templates or reading their contents. The text tool can read a bounded beginning or tail of logs, JSON/JSONL/CSV metrics, configs or scripts; binary event formats are unsupported. Raw evidence goes to the model for interpretation, without a fixed progress parser or keyword-based question routing. Connection, waiting, response and tool stages appear in the conversation with elapsed time and expandable evidence; successful answers automatically fold the operation records. These are actual operations, not model reasoning. No SSH private keys or API keys are sent to the model. Full commands, discovered filenames and authorized text may contain private experimental data; only authorize files you permit your configured provider to receive. Common credential fields are masked, but masking is not comprehensive data anonymization.

For example: **“What is running on GPU 6 and 7?” → “Check the parent process and its progress” → “Notify me when this task ends.”** If a log needs authorization, an inline card shows its exact server/path, read size and receiving API. Choose **Allow once and continue**, **Always allow this file**, or **Decline**; the pending operation resumes automatically. You can also authorize a known absolute path for the selected server and revoke saved permissions from the sidebar.

Tool-call count is unlimited by default. You can stop a turn at any time or set a positive budget in **Settings → AI**. A paused or failed investigation can continue from pending work without replaying completed actions. Long investigations compact older tool groups into bounded factual excerpts and retain recent evidence; missing details can be queried again. The view retains the latest 80 completed activity records with bounded detail excerpts, independently of how many tools execute. DNS, connection-reset, TLS, timeout and HTTP failures include available error codes/stages; these diagnostics distinguish failure types but do not prove which network party caused them.

Completion estimates need logged progress and an observed speed; they describe the current phase and may exclude validation/checkpoint saving. Slurm time limits are shown as scheduling constraints. Utilization or runtime alone does not provide a reliable ETA. Missing permissions, container visibility, unavailable tools and unknown outcomes are reported rather than inferred as success.

GPU Fleet uses the **local desktop** SSH executable and local SSH configuration, including your port, agent and ProxyJump, even in a Remote SSH or container window. Install it under **Local** in VS Code; a remote-only installation must be moved locally. The AI service does not connect to your machines. It cannot run arbitrary shell, stop jobs, edit training parameters, install packages or delete files. Suggested commands are prepared for review, never auto-run.

AI requests occur only when you send a question or follow-up. Your configured provider receives the question, conversation and relevant evidence. Automatic dashboard refresh and reminders never call AI. Keys remain endpoint-scoped in SecretStorage. **Clear chat** removes the in-memory conversation. Use HTTPS for remote API services; HTTP transmits data without encryption. Streaming and native tool calling depend on your provider/model; the client first retries tool-enabled requests without streaming. If the API still rejects tools, a persistent notice explains that the reply is basic chat without task inspection or reminder creation.

### Refresh and navigation

Language is under **Settings → Display**. The header shows the last data time and refresh mode; select the mode to open refresh settings. Availability and warning summaries can filter the GPU view. Resource requirements, user selection and search share one compact filter area, with a clear action shown only while filters are active.

Hosts refresh concurrently within the configured limit, shared across dashboard snapshots, assistant queries and background reminders. Matching in-flight snapshots coalesce, and automatic refresh can reuse observations less than two seconds old. A new automatic round waits until the prior round finishes; hidden panels pause by default. Failed hosts back off from 10 seconds up to two minutes, with their last known data retained and retry time displayed. Manual refresh bypasses this backoff. No automatic refresh calls AI or repeatedly reads task directories/logs.

### Reminders

Ask for GPU release, verified task end, or a scheduled check. Conditions and absolute deadlines are shown in the sidebar, where you can edit the deadline or cancel. Release reminders require two successful free samples at least 30 seconds apart; unknown/offline snapshots do not count. Unspecified deadlines default to 24 hours. A worker exit alone does not prove an entire experiment completed.

Reminders persist locally and run while **desktop VS Code is running and the machine is awake**, independently of the chat or dashboard panel. They poll only relevant configured servers every 30 seconds, coalescing recent queries. They do not reserve GPUs or guarantee a notified card stays free. After restart or sleep, overdue valid scheduled checks report once; expired conditions are marked expired.

## Security and privacy

GPU Fleet Viewer invokes your system `ssh` client with argument-safe execution, key-only batch mode, and a configurable timeout. A custom SSH config is passed to the SSH client as well as used for host discovery. Hosts and GPU identifiers received from the Webview are validated again in the extension host. It reads your SSH config but never reads or stores private-key contents. Monitoring data stays between VS Code and your servers until you send an AI question, which includes the visible fleet context and may request relevant task evidence. There is no telemetry service, persistent metric history, or job-control endpoint.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Support

See [SUPPORT.md](SUPPORT.md) for troubleshooting and support channels. Bug reports and feature requests are welcome in [GitHub Issues](https://github.com/yruichen/gpu-fleet-viewer/issues).

## Development

```bash
npm ci
npm test
npx vsce package
```

For a standalone local preview:

```bash
npm run preview:build
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/preview/`.

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Maintainers can find the release checklist in [docs/PUBLISHING.md](docs/PUBLISHING.md).

### Project directories

- `src/` — extension source and tests.
- `resources/` — extension icons and static assets.
- `scripts/` — local preview and verification helpers.
- `docs/` — contributor and publishing documentation.
- `design/` — local design-work artifacts.
- `releases/` — ignored local `.vsix` packages for manual verification.
- `out/`, `preview/`, and `output/` — ignored generated build and preview files.

## Acknowledgements

GPU Fleet Viewer is based on [GPU Server Viewer](https://github.com/Riku-0801/gpu-server-observer) by Riku-0801 and includes substantial UI, performance, reliability, configuration, and testing changes. See [NOTICE](NOTICE) for attribution.

Licensed under the [Apache License 2.0](LICENSE.txt).
