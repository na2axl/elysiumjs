#!/usr/bin/env bash
# Deprecates the packages that @elysiumjs/olympus and its runtime and backend packages replace,
# with the import that replaces each. Not run in CI: run it once the new packages are published.
# Needs an npm login with publish rights on the packages; npm asks for a one-time password.
set -euo pipefail

NPM="npx -y npm@12.2.1"
# DRY_RUN=1 prints the messages without deprecating anything.
DRY_RUN="${DRY_RUN:-0}"

# The replacements must be published first, or the messages point at missing packages.
for name in @elysiumjs/olympus @elysiumjs/bun @elysiumjs/node @elysiumjs/workers @elysiumjs/redis @elysiumjs/drizzle @elysiumjs/pino; do
	version="$($NPM view "$name" version 2>/dev/null || true)"
	if [ -z "$version" ] || [[ "$version" == 0.0.0* ]]; then
		echo "$name is not published yet: publish the new packages before deprecating the old ones." >&2
		[ "$DRY_RUN" = 1 ] || exit 1
	fi
done

deprecate() {
	local name="$1" message="$2"
	if [ "$DRY_RUN" = 1 ]; then
		echo "$name: $message"
		return
	fi
	echo "Deprecating $name"
	$NPM deprecate "$name" "$message"
}

olympus="has moved into @elysiumjs/olympus"

deprecate @elysiumjs/core "$olympus: import from @elysiumjs/olympus."
for domain in moirai ariadne cerberus; do
	deprecate "@elysiumjs/$domain" "$olympus: import from @elysiumjs/olympus/$domain."
done
deprecate @elysiumjs/heracles "$olympus: import from @elysiumjs/olympus/heracles; the Redis transport and worker are in @elysiumjs/redis."
deprecate @elysiumjs/mnemosyne "$olympus: import from @elysiumjs/olympus/mnemosyne; the Redis cache store is in @elysiumjs/redis."
deprecate @elysiumjs/themis "$olympus: import from @elysiumjs/olympus/themis; passwords, JWT and signed URLs from @elysiumjs/olympus/harpocrates."
deprecate @elysiumjs/hermes "$olympus: logging is LoggerModule from @elysiumjs/olympus, with the pino driver of @elysiumjs/pino."

deprecate @elysiumjs/runtime-bun "Replaced by @elysiumjs/bun."
deprecate @elysiumjs/runtime-node "Replaced by @elysiumjs/node."
for name in runtime-workers heracles-workers themis-workers ariadne-workers; do
	deprecate "@elysiumjs/$name" "Replaced by @elysiumjs/workers."
done
for name in themis-redis ariadne-redis; do
	deprecate "@elysiumjs/$name" "Replaced by @elysiumjs/redis."
done
for name in mnemosyne-drizzle moirai-drizzle; do
	deprecate "@elysiumjs/$name" "Replaced by @elysiumjs/drizzle."
done
