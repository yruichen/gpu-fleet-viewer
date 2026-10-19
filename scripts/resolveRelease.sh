#!/usr/bin/env bash
set -euo pipefail

version=$(node -p "require('./package.json').version")
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo 'Marketplace releases require a stable semantic version.' >&2
  exit 1
fi
tag="v$version"
if [[ "$GITHUB_REF" == refs/tags/* ]]; then
  if [[ "$GITHUB_REF_NAME" != "$tag" ]]; then
    echo "Tag $GITHUB_REF_NAME does not match package version $version." >&2
    exit 1
  fi
elif [[ "$GITHUB_REF" != refs/heads/main ]]; then
  echo 'Release from main or a matching version tag.' >&2
  exit 1
fi

publish=true
existing=$(git rev-parse -q --verify "refs/tags/$tag^{commit}" || true)
if [[ -n "$existing" && "$existing" != "$(git rev-parse HEAD)" ]]; then
  publish=false
  echo "Skipping $tag: that version is already tagged at another commit."
fi
{
  echo "version=$version"
  echo "tag=$tag"
  echo "vsix=gpu-fleet-viewer-$version.vsix"
  echo "publish=$publish"
} >> "$GITHUB_OUTPUT"
