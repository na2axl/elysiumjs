#!/usr/bin/env bash
# Tags and creates a GitHub release for every package version that is live on
# npm but has no release yet. Run it after approving the staged versions.
# Set DRY_RUN=1 to only print what would be released.
set -euo pipefail

notes="$(mktemp)"
trap 'rm -f "${notes:?}"' EXIT

for dir in @elysiumjs/* create-elysium; do
	name="$(bun -p "require('./$dir/package.json').name")"
	version="$(bun -p "require('./$dir/package.json').version")"
	tag="$name@$version"

	if [ "$(npm view "$tag" version 2>/dev/null)" != "$version" ]; then
		echo "Skipping $tag: not on npm yet"
		continue
	fi
	if gh release view "$tag" >/dev/null 2>&1; then
		echo "Skipping $tag: already released"
		continue
	fi

	# The commit that set this version, i.e. the merged Version Packages PR.
	commit="$(git log -1 --format=%H -G"\"version\": \"$version\"" -- "$dir/package.json")"
	awk -v v="$version" '$0 == "## " v { found = 1; next } found && /^## / { exit } found' \
		"$dir/CHANGELOG.md" > "$notes"
	latest="$([ "$name" = create-elysium ] && echo --latest || echo --latest=false)"

	if [ -n "${DRY_RUN:-}" ]; then
		echo "Would release $tag at ${commit:0:7} ($(wc -l < "$notes" | tr -d ' ') lines of notes)"
		continue
	fi

	if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
		git tag "$tag" "$commit"
		git push origin "refs/tags/$tag"
	fi
	gh release create "$tag" --title "$tag" --notes-file "$notes" --verify-tag "$latest"
	echo "Released $tag"
done
