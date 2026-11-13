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
	if [ "$(bun -p "require('./$dir/package.json').private === true")" = true ]; then
		continue
	fi

	if [ "$($NPM view "$name@$version" version 2>/dev/null)" = "$version" ]; then
		echo "Skipping $name@$version: already published"
		continue
	fi

	# bun pack resolves workspace: and catalog: versions, which npm cannot.
	tarball="$(cd "$dir" && bun pm pack --destination "$out" --quiet --ignore-scripts)"
	# A version staged by an earlier run is not visible to `npm view` until it is approved:
	# skip it, so that a run can be repeated after a partial failure.
	if ! log="$($NPM stage publish "$tarball" --access public 2>&1)"; then
		if grep -q "E409" <<<"$log"; then
			echo "Skipping $name@$version: already staged"
			continue
		fi
		echo "$log" >&2
		exit 1
	fi
	echo "$log"
done
