# Publishing

Keep the npm package version, Visual Studio Marketplace version, Git tag, and GitHub Release synchronized. The `Marketplace Release` GitHub Actions workflow publishes both the Marketplace package and GitHub Release asset from a version tag.

## One-time GitHub setup

1. Create a Visual Studio Marketplace publishing token for publisher `yruichen` with Marketplace management permission.
2. Open the repository's **Settings → Secrets and variables → Actions** page.
3. Add the token as a repository secret named `VSCE_PAT`.
4. Protect access to repository settings and rotate the token before it expires.

Never place the token in source files, workflow YAML, release notes, or shell history. The workflow reads it only from GitHub Actions secrets.

## Release checklist

1. Create a release branch from an up-to-date `main` branch.
2. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` with the same semantic version.
3. Run `npm ci`, `npm test`, and `npm audit --omit=dev --registry=https://registry.npmjs.org`.
4. Build the VSIX with `npx vsce package` and inspect its file list.
5. Open a pull request and wait for the required `test` check to pass.
6. Merge the pull request and update the local `main` branch.
7. Create and push the matching version tag, for example `git tag v1.2.0 && git push origin v1.2.0`.
8. Watch the **Marketplace Release** workflow. It validates the version, runs tests and the production audit, packages the VSIX, publishes it to the Marketplace, and creates the GitHub Release.
9. Verify the Marketplace page and install the public extension ID in a clean VS Code profile.

If the workflow stops at **Verify Marketplace credential**, configure or rotate `VSCE_PAT` and re-run the failed job. A tag whose version differs from `package.json` is rejected before publishing.
