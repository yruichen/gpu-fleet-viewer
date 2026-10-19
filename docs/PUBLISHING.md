# Publishing

Keep the package version, Visual Studio Marketplace version, Git tag, and GitHub Release synchronized. The `Marketplace Release` workflow publishes a new stable package version when it is merged into `main`, then creates the matching GitHub tag and Release. Matching version tags and manual workflow runs are also supported.

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
7. The push to `main` automatically triggers **Marketplace Release**. No manual version tag is needed. A commit that retains an already tagged version is skipped.
8. Watch the workflow. It validates the version, runs tests and the production audit, packages the VSIX, publishes it to the Marketplace, and creates the matching GitHub Release and version tag for the packaged commit.
9. Verify the Marketplace page and install the public extension ID in a clean VS Code profile.

If the workflow stops at **Verify Marketplace credential**, configure or rotate `VSCE_PAT` and re-run the failed job. A tag whose version differs from `package.json` is rejected before publishing.

If publishing succeeds but GitHub Release creation fails, re-run the job from the same commit or tag. `--skip-duplicate` skips the already published Marketplace version and continues with the GitHub asset. Publication is serialized across release events. The token is provided only to the credential check and Marketplace publishing step.

To publish from a tag explicitly, push a matching tag such as `v1.3.0`. Manual runs must target `main` or a matching version tag. Never move an existing release tag or reuse a version for different code; increment the package version instead. Users receive Marketplace updates according to their VS Code extension auto-update settings.
