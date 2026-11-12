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

| Package                                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [@elysiumjs/olympus](./@elysiumjs/olympus)             | The framework. The root export holds the application, modules, dependency injection, controllers, middleware, interceptors, filters, problem details, configuration, lifecycle events, logging and console commands. Subpaths add the domains: `/mnemosyne` (database and caching), `/moirai` (actions, queries, outbox, inbox and domain events; `/moirai/heracles` relays outbox jobs), `/heracles` (background jobs), `/ariadne` (multi-step flows), `/harpocrates` (password hashing, encryption, tokens and signed URLs), `/themis` (authentication), `/cerberus` (roles and permissions), and `/hermes` (structured logging). |
| [@elysiumjs/bun](./@elysiumjs/bun)                     | Bun runtime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [@elysiumjs/node](./@elysiumjs/node)                   | Node.js runtime and HTTP server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [@elysiumjs/workers](./@elysiumjs/workers)             | Cloudflare Workers: the runtime and Worker entry, bindings, queue and cron handlers, heracles jobs on Cloudflare Queues, KV caches and sessions, rate limits, and flows and locks in Durable Objects.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [@elysiumjs/redis](./@elysiumjs/redis)                 | Redis: connections, the `redis` lock driver, a cache store, rate limits, the heracles transport and worker, and flow and session stores.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [@elysiumjs/drizzle](./@elysiumjs/drizzle)             | Drizzle ORM: database drivers (Bun SQL, postgres.js, node-postgres, Hyperdrive), models, repositories, migrations, tenancy, the moirai stores and the `postgres` lock driver.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [@elysiumjs/pino](./@elysiumjs/pino)                   | The `pino` logger driver, with pretty output in development.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [@elysiumjs/argus](./@elysiumjs/argus)                 | OpenTelemetry tracing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [@elysiumjs/plugin-sentry](./@elysiumjs/plugin-sentry) | Sentry error reporting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [@elysiumjs/styx](./@elysiumjs/styx)                   | The `styx` command: creates projects, generates code and route types, runs app commands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [@elysiumjs/hephaestus](./@elysiumjs/hephaestus)       | Compilation, bundling and binaries for Elysium apps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [create-elysium](./create-elysium)                     | `bun create elysium`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

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

[Apache 2.0](./LICENSE), Axel Nana
