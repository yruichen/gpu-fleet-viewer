# Contributing

Thanks for helping improve GPU Fleet Viewer.

## Before opening a change

- Search existing issues and pull requests.
- Keep changes focused and avoid committing hostnames, IP addresses, usernames, SSH configuration, keys, or real process data.
- Open an issue first for large behavior or interface changes.

## Local development

```bash
npm ci
npm test
```

`npm test` compiles TypeScript, runs ESLint, validates parsers, builds the standalone preview, and executes Webview DOM interaction checks.

To inspect the dashboard in a browser:

```bash
npm run preview:build
python3 -m http.server 8765 --bind 127.0.0.1
```

## Pull requests

- Explain the user-facing problem and the chosen solution.
- Add or update tests for behavior changes.
- Update README.md or CHANGELOG.md when users need to know about the change.
- Confirm `npm test` passes.
- Use synthetic server and user names in fixtures and screenshots.

By contributing, you agree that your contribution is licensed under Apache-2.0.
