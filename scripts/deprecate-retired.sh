#!/usr/bin/env bash
# Deprecates the packages that @elysiumjs/olympus and its runtime and backend packages replace,
# with the import that replaces each. Not run in CI: run it once the new packages are published.
# Needs an npm login with publish rights on the packages; npm asks for a one-time password.
set -euo pipefail

NPM="npx -y npm@12.2.1"

deprecate() {
	local name="$1" message="$2"
	echo "Deprecating $name"
	$NPM deprecate "$name" "$message"
}

olympus="has moved into @elysiumjs/olympus"

deprecate @elysiumjs/core "$olympus: import from @elysiumjs/olympus."
for domain in heracles mnemosyne moirai ariadne themis cerberus; do
	deprecate "@elysiumjs/$domain" "$olympus: import from @elysiumjs/olympus/$domain."
done
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
