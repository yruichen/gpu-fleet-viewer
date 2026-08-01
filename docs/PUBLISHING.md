# Publishing

Keep the npm package version, Visual Studio Marketplace version, Git tag, and GitHub Release synchronized.

## Release checklist

1. Create a release branch from an up-to-date `main` branch.
2. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` with the same semantic version.
3. Run `npm ci`, `npm test`, and `npm audit --omit=dev`.
4. Build the VSIX with `npx vsce package` and inspect its file list.
5. Open a pull request and wait for the required `test` check to pass.
6. Merge the pull request, create the matching Git tag and GitHub Release, and attach the VSIX.
7. Upload the same VSIX in the Marketplace publisher portal or publish it with `npx vsce publish --packagePath <file>`.
8. Verify the Marketplace page and install the public extension ID in a clean VS Code profile.

Never commit a Marketplace Personal Access Token. Prefer Microsoft Entra ID for automated publishing; otherwise enter short-lived credentials only in the local publishing environment.
