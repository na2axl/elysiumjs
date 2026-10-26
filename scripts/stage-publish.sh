#!/usr/bin/env bash
# Stages every package version that is not on npm yet. Staged versions are
# published once approved with 2FA: `npm stage list`, then `npm stage approve <id>`.
set -euo pipefail

NPM="npx -y npm@12.2.1"
out="$(mktemp -d)"
trap 'rm -rf "${out:?}"' EXIT

for dir in @elysiumjs/* create-elysium; do
	name="$(bun -p "require('./$dir/package.json').name")"
	version="$(bun -p "require('./$dir/package.json').version")"

	if [ "$($NPM view "$name@$version" version 2>/dev/null)" = "$version" ]; then
		echo "Skipping $name@$version: already published"
		continue
	fi

	# bun pack resolves workspace: and catalog: versions, which npm cannot.
	tarball="$(cd "$dir" && bun pm pack --destination "$out" --quiet --ignore-scripts)"
	$NPM stage publish "$tarball" --access public
done
