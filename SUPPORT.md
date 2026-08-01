# Support

## Before opening an issue

Verify that the same SSH target works outside VS Code:

```bash
ssh -o BatchMode=yes gpu-node-01 nvidia-smi
```

GPU Fleet Viewer requires non-interactive SSH authentication and a working `nvidia-smi` command on the remote host. Increase `gpu-fleet-viewer.sshTimeout` when a server is reachable but slow to respond.

## Bugs and feature requests

Use [GitHub Issues](https://github.com/yruichen/gpu-fleet-viewer/issues) and choose the appropriate template. Remove real hostnames, IP addresses, usernames, credentials, and sensitive process information before posting logs or screenshots.

## Security reports

Do not report vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md) and use GitHub's private vulnerability reporting form.

## Marketplace

Install the current stable release from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=yruichen.gpu-fleet-viewer). Offline VSIX packages are also available from [GitHub Releases](https://github.com/yruichen/gpu-fleet-viewer/releases).
