# Elysium.js

A structured web framework built on [ElysiaJS](https://elysiajs.com/), for Bun, Node.js and Cloudflare Workers.

Elysium.js organizes an application into modules of controllers and services, wired by dependency injection and declared with decorators. On top of that core, a set of packages covers what a production API needs: database and caching, background jobs, authentication and authorization, transactional actions with an outbox, multi-step flows, logging and tracing, and a command line tool that creates projects and generates code.

## Features

- **Modules and dependency injection**: modules group controllers and services; services are singletons, factories or request scoped, and each module sees only its own services, the ones its imports export, and global ones.
- **Controllers**: HTTP (with server-sent events), WebSocket and WAMP controllers, with guards, middleware, interceptors and filters.
- **Validation and problem details**: request and response schemas with TypeBox; errors are RFC 9457 problems with a stable `code`, and handlers may return a `DomainError` as a value.
- **Runtimes**: the same application runs on Bun, Node.js and Cloudflare Workers, compiled ahead of time where the runtime forbids code generation.
- **Data**: Drizzle ORM models and repositories, a query DSL for filters, sorting and cursor pages, units of work, and caches over Redis or Workers KV.
- **Actions and events**: validated, transactional, retried and idempotent writes, with an outbox and an inbox for effects and domain events delivered once.
- **Background jobs**: queues on Redis or Cloudflare Queues, schedules and fan-out, retries and dead letters.
- **Flows**: multi-step flows, such as sign-in or checkout, with server-side state and replayable steps, stored in memory, Redis or a Durable Object.
- **Security**: passwords, JWT, sessions, CSRF, TOTP, OAuth and passkeys; ability-based permissions; rate limits.
- **Observability**: structured logging and OpenTelemetry tracing, with an optional Sentry plugin.
- **Tooling**: the `styx` command creates projects, generates controllers, services, models, jobs and modules, generates route types for typed clients, and builds the app.

## Quick start

```bash
bun create elysium my-app
cd my-app
bun run dev
```

`create-elysium` runs `styx create`. It asks for the template (one module or several), the runtime (Bun, Node.js or Cloudflare Workers), the modules, plugins and features; pass them as options to skip the prompts. See [create-elysium](./create-elysium).

## Packages

| Package                                                        | Description                                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [@elysiumjs/core](./@elysiumjs/core)                           | Application, modules, dependency injection, controllers, middleware, interceptors, filters, problem details, configuration, lifecycle events and console commands. |
| [@elysiumjs/runtime-bun](./@elysiumjs/runtime-bun)             | Bun runtime.                                                                                                                                                       |
| [@elysiumjs/runtime-node](./@elysiumjs/runtime-node)           | Node.js runtime.                                                                                                                                                   |
| [@elysiumjs/runtime-workers](./@elysiumjs/runtime-workers)     | Cloudflare Workers runtime: Worker entry, bindings, queue and cron handlers, KV and rate limits.                                                                   |
| [@elysiumjs/mnemosyne](./@elysiumjs/mnemosyne)                 | Database and caching: models, repositories, query DSL, units of work, cache stores.                                                                                |
| [@elysiumjs/mnemosyne-drizzle](./@elysiumjs/mnemosyne-drizzle) | Drizzle ORM driver for mnemosyne, with Bun SQL, postgres.js, node-postgres and Hyperdrive drivers.                                                                 |
| [@elysiumjs/redis](./@elysiumjs/redis)                         | Redis connections (ioredis and Upstash).                                                                                                                           |
| [@elysiumjs/moirai](./@elysiumjs/moirai)                       | Actions and queries, idempotency, outbox, inbox and domain events.                                                                                                 |
| [@elysiumjs/moirai-drizzle](./@elysiumjs/moirai-drizzle)       | Postgres stores for moirai: idempotency keys, outbox, inbox and advisory locks.                                                                                    |
| [@elysiumjs/heracles](./@elysiumjs/heracles)                   | Background jobs: queues, schedules, fan-out and retries.                                                                                                           |
| [@elysiumjs/heracles-workers](./@elysiumjs/heracles-workers)   | Cloudflare Queues and cron triggers for heracles jobs, with dead-letter queues.                                                                                    |
| [@elysiumjs/ariadne](./@elysiumjs/ariadne)                     | Multi-step flows with server-side state and replayable steps.                                                                                                      |
| [@elysiumjs/ariadne-redis](./@elysiumjs/ariadne-redis)         | Redis flow store for ariadne.                                                                                                                                      |
| [@elysiumjs/ariadne-workers](./@elysiumjs/ariadne-workers)     | Durable Object flow store for ariadne.                                                                                                                             |
| [@elysiumjs/themis](./@elysiumjs/themis)                       | Authentication: passwords, tokens, sessions, guards, CSRF, TOTP, OAuth and passkeys.                                                                               |
| [@elysiumjs/themis-redis](./@elysiumjs/themis-redis)           | Redis session store for themis.                                                                                                                                    |
| [@elysiumjs/themis-workers](./@elysiumjs/themis-workers)       | Workers KV session store for themis.                                                                                                                               |
| [@elysiumjs/cerberus](./@elysiumjs/cerberus)                   | Ability-based roles and permissions.                                                                                                                               |
| [@elysiumjs/hermes](./@elysiumjs/hermes)                       | Structured logging, with JSON and pretty output and request logs.                                                                                                  |
| [@elysiumjs/argus](./@elysiumjs/argus)                         | OpenTelemetry tracing.                                                                                                                                             |
| [@elysiumjs/plugin-sentry](./@elysiumjs/plugin-sentry)         | Sentry error reporting.                                                                                                                                            |
| [@elysiumjs/styx](./@elysiumjs/styx)                           | The `styx` command: creates projects, generates code and route types, runs app commands.                                                                           |
| [@elysiumjs/hephaestus](./@elysiumjs/hephaestus)               | Compilation, bundling and binaries for Elysium apps.                                                                                                               |
| [create-elysium](./create-elysium)                             | `bun create elysium`.                                                                                                                                              |

## Repository layout

```
@elysiumjs/       the published packages
create-elysium/   the project creator
conformance/      scenarios run against every runtime (private)
example/          an example application (private)
scripts/          repository checks and release scripts
```

## Development

Requirements: [Bun](https://bun.sh/) 1.4.3, Node.js 24 for the Node.js and workerd conformance lanes, and Postgres and Redis for the integration tests.

```bash
bun install
bun run build
bun run test
bun run typecheck
bun run lint
bun run check:portability
```

The conformance suite runs the same scenarios on each runtime:

```bash
cd conformance
bun run test                # Bun
bun run test:node           # Node.js
bun run test:workerd        # workerd
bun run test:workerd-aot    # workerd, compiled ahead of time
```

## Releases

Versions and changelogs come from [Changesets](https://github.com/changesets/changesets): add one with `bun run changeset` in each pull request that changes a package. The release workflow keeps a Version Packages pull request up to date; merging it stages the new versions on npm, to approve with two-factor authentication.

## License

[Apache 2.0](./LICENSE), Workbud Technologies Inc.
