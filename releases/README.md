# Local extension packages

This directory holds locally built `.vsix` packages for manual installation and
release verification. Packages are intentionally ignored by Git; publishable
artifacts should be attached to the corresponding GitHub Release instead.

Keep only the versions that are useful for local testing. New packages can be
created with `npx vsce package` and moved here after verification.
