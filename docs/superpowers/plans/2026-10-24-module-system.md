# Module System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make modules the only way controllers, commands, jobs, middlewares and services enter an Elysium app. Decorators become metadata-only, services are scoped per module, packages are configured through typed `with()`, and the app boots lazily for CLI commands and eagerly for `serve`.

**Architecture:** Core gains three units:
- **Module graph:** a pure, metadata-only walk from the app's `modules`.
- **Scoped container:** global scope plus one scope per module, with visibility computed from the graph and the current module tracked in an `AsyncLocalStorage`.
- **Kernel:** registration, lifecycle and shutdown, on top of the other two.

`Application` becomes a thin CLI/serve front-end over the kernel. Every package then replaces its import-time side effects with a module.

**Tech Stack:** Bun (runtime, `bun test`), TypeScript (`experimentalDecorators`, `emitDecoratorMetadata`), `reflect-metadata`, Elysia 1.4, radash, turbo, changesets.

**Spec:** `docs/superpowers/specs/2026-10-24-module-system-design.md`. Read it before starting any task; section numbers below (§x.y) refer to it.

## Global Constraints

- Clean break: no deprecation shims, no compatibility warnings for the old style (spec §3).
- Use Elysium vocabulary, never Nest's: `services` (not `providers`), `with()` (not `forRoot`), `@Service.register()` (spec §4).
- Decorators only call `Reflect.defineMetadata`. Nothing touches the container at import time (spec §2.2).
- No package entry point keeps a side-effect import except `reflect-metadata` (spec §5.8).
- New and touched library code throws typed errors from `core/src/errors.ts`; only `Application.run()` prints and exits (spec §4, §5.11).
- Environment = `Bun.env.NODE_ENV ?? 'development'` (spec §5.7).
- Every new file starts with the Apache license header used across the repo, and public APIs carry JSDoc with `@author Axel Nana <axel.nana@workbud.com>`.
- Metadata symbols live in the `Symbols` namespace in `core/src/utils.ts`.
- Tests use `bun:test` in each package's `tests/` folder (`bunfig.toml` preloads `tests/setup.ts`). Run per package with `bun test` from the package directory.
- Baseline: 19 core tests fail on `main` before any change (app, http, middleware, module, console). Tasks that rewrite those test files make them pass. The 4 `InteractsWithConsole` failures are out of scope; leave them and don't count them as regressions.
- Release: one changeset marking every touched `@elysiumjs/*` package as a `minor` bump (0.x breaking).

## Review Focus

1. **Lazy CLI plus async `onInit`.** A command calls `Service.get()` at runtime for a singleton whose class or owning module has an async `onInit`. Expected: a `ServiceNotReadyError` telling the user to use constructor injection or `await Service.resolve()`, never a half-initialised service. Test in Task 2.
2. **Diamond imports.** A imports B and C, and both import D. Expected: D is registered and initialised once, and its config is used once. Test in Task 4.
3. **A module listed both plainly and via `with()`.** The app lists `HermesModule` and a package imports `HermesModule.with(x)`. Expected: one instance using `x`, no conflict error. Test in Task 4.
4. **Shutdown when `onInit` fails halfway.** The third of five services throws in `onInit` during eager boot. Expected: `onDestroy` runs for the two already constructed, in reverse order, then the error surfaces. Test in Task 5.
5. **The same class listed in two modules' `services`.** Expected: each module gets its own instance (non-global), or `DuplicateGlobalServiceError` if the class is `global: true`. Test in Task 2.

---

## File Structure

**core/src (new)**
- `errors.ts`: typed errors.
- `module-context.ts`: `AsyncLocalStorage` holding the current `ModuleNode`.
- `module-graph.ts`: Phase 1 walk, dedupe, env filter, cycles, config precedence, command collisions, visibility sets.
- `container.ts`: scoped registry, resolution, lazy singletons, `onInit`, construction order.
- `kernel.ts`: Phase 2 and 3, module init, eager/lazy boot, shutdown, graph queries.
- `testing.ts`: `Application.testing()` helper.

**core/src (modified)**
- `service.ts`: metadata-only `register`; the namespace API delegates to `container.ts`.
- `module.ts`: new `ModuleProps`, hooks, `Module.configurable()`.
- `app.ts`: `run()`/`start()`, CLI and serve through the kernel; drop `redis`/`wamp`/`work`/index signature/`getConfig`.
- `command.ts`: metadata-only `register`, `static boot`.
- `http.ts`, `websocket.ts`, `wamp.ts`, `middleware.ts`: take a `ModuleNode`, run in its context, construct via the container.
- `redis.ts`: `RedisModule`. `wamp.ts`: `WampModule`.
- `utils.ts`: new symbols, `currentEnvironment()`.
- `index.ts`: exports.
- **Deleted:** `job.ts`, `worker.ts`, `tests/job.test.ts`.

**Packages:** each gets `src/<name>.module.ts`. Entry points lose their side-effect imports. `mnemosyne-drizzle/src/init.ts` is deleted, and the migration commands move into `mnemosyne-drizzle/src/commands/`.

---

### Task 1: Errors, environment and module context

**Files:**
- Create: `@elysiumjs/core/src/errors.ts`, `@elysiumjs/core/src/module-context.ts`
- Modify: `@elysiumjs/core/src/utils.ts`
- Test: `@elysiumjs/core/tests/errors.test.ts`, `@elysiumjs/core/tests/module-context.test.ts`

**Interfaces:**
- Produces:
  - `class ElysiumError extends Error`, plus these subclasses, each with a readonly field per constructor argument and a message naming every argument:
    - `ModuleCycleError(path: string[])`: message joins the path with ` -> `
    - `InvalidModuleError(className: string)`
    - `DuplicateGlobalServiceError(name: string, modules: [string, string])`
    - `DuplicateCommandError(command: string, modules: [string, string])`
    - `ConflictingModuleConfigError(module: string, sites: [string, string])`
    - `MissingModuleConfigError(module: string, keys: string[])`
    - `ServiceNotVisibleError(service: string, requester: string, module: string | null, owner: string | null)`: the message includes `import ${owner}` or `add it to ${owner}'s exports` when `owner` is set
    - `ServiceNotFoundError(service: string)`
    - `ServiceNotReadyError(service: string)`: the message mentions `Service.resolve`
    - `EnvironmentSkippedModuleError(service: string, requester: string, skippedModule: string, environment: string)`
  - `currentEnvironment(): string` in `utils.ts`
  - New symbols in `Symbols`: `serviceOptions`, `module`, `configuredModule`, `moduleConfig`
  - `ModuleContext` namespace in `module-context.ts`:
    - `run<T>(node: ModuleNode, fn: () => T): T`
    - `current(): ModuleNode | undefined`
    - `ModuleNode` imported as a type from `module-graph.ts`; declare it there as a forward `export type ModuleNode = { readonly id: string }` placeholder that Task 4 extends.

- [ ] **Step 1: Write failing tests.**
  - `errors.test.ts`: one `it` per class asserting `instanceof ElysiumError`, `.name === '<ClassName>'`, and that the message contains every argument, e.g. `new ModuleCycleError(['A','B','A']).message` contains `A -> B -> A`.
  - `module-context.test.ts`:
    - `current()` is `undefined` outside `run`
    - `run()` returns `fn`'s value
    - the context survives `await` inside `run`
    - nested `run` restores the outer node afterwards
  - `currentEnvironment()` returns `'development'` when `NODE_ENV` is deleted and `'test'` when it is set to `'test'` (restore `NODE_ENV` in `afterEach`).
- [ ] **Step 2: Run `bun test tests/errors.test.ts tests/module-context.test.ts`.** Expected: FAIL, modules not found.
- [ ] **Step 3: Implement the three files.** Errors set `this.name = new.target.name`.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): add typed errors, environment helper and module context"`

---

### Task 2: Scoped service container

**Files:**
- Create: `@elysiumjs/core/src/container.ts`
- Modify: `@elysiumjs/core/src/service.ts`
- Test: `@elysiumjs/core/tests/container.test.ts`; rewrite `@elysiumjs/core/tests/service.test.ts`

**Interfaces:**
- Consumes: Task 1 errors, `ModuleContext`, `Symbols.serviceOptions`.
- Produces:
  - `service.ts` types:
    - `type ServiceProps = Partial<{ name: string; scope: ServiceScope; global: boolean }>`
    - `type ServiceFactoryDefinition = { name: string; factory: (config: any, get: <T>(name: string | Class<T>) => T) => unknown; scope?: ServiceScope; global?: boolean }`
    - `type ServiceDefinition = Class<any> | ServiceFactoryDefinition`
  - `Service` namespace:
    - `Service.register(props?)`: only `Reflect.defineMetadata(Symbols.serviceOptions, props, target)`.
    - `Service.inject`: unchanged.
    - `Service.get<T>(name | Class<T>): T | null`: resolves in `ModuleContext.current()` (globals only when there is none). Returns `null` when nothing is visible.
    - `Service.resolve<T>(name | Class<T>): Promise<T>`: like `get`, but awaits `onInit` of the service and of its owning module (via the module-init hook below). Throws `ServiceNotFoundError` / `ServiceNotVisibleError`.
    - `Service.make<T>(cls: Class<T>): T`: constructs `cls` with injected deps resolved in the current context. Throws `ServiceNotVisibleError` (requester = `cls.name`, owner found by searching all scopes) instead of `process.exit`.
    - `Service.instance`, `Service.factory`, `Service.bind`, `Service.remove`, `Service.exists`, `Service.keys`, `Service.clear`, `Service.registerLazy`: operate on the **global** scope. Duplicates throw `DuplicateGlobalServiceError(name, ['<global>', '<global>'])` instead of `process.exit`.
  - `container.ts`, `namespace Container`:
    - `register(owner: ModuleNode | null, def: ServiceDefinition, config: unknown): string`: `null` owner means global. Returns the registered name. A `global` service owned by a module goes into the global scope but records its owner. Duplicate global name → `DuplicateGlobalServiceError` naming both owners.
    - `setVisibility(resolveVisibleOwners: (node: ModuleNode) => readonly ModuleNode[]): void`: the graph's visibility function (Task 4).
    - `setModuleInitHook(hook: ((owner: ModuleNode) => Promise<void> | void) | null): void`: called before constructing a service whose owner isn't initialised (Task 5 sets it).
  - `setSkippedLookup(lookup: ((name: string) => { module: string; environment: string } | null) | null): void`: consulted when a name isn't found. A hit makes `make`/`resolve` throw `EnvironmentSkippedModuleError` instead of `ServiceNotFoundError`/`ServiceNotVisibleError`; `get` still returns `null`.
    - `lookup(name: string, from: ModuleNode | undefined): { entry: ContainerEntry; owner: ModuleNode | null } | null`
    - `constructed(): readonly { name: string; instance: unknown; owner: ModuleNode | null }[]`: in construction order.
    - `reset(): void`: clears every scope; used by tests and the testing helper.
    - `type ContainerEntry = { name; scope; global; owner; create: () => unknown; instance?: unknown; initialised: boolean }`
- Rules:
  - **Lookup order:** own module → each visible owner's exported names → global scope.
  - **Construction context:** a singleton is constructed once, inside `ModuleContext.run(owner, …)`, and recorded in `constructed()`.
  - **Sync `onInit` on `get`:** `get` calls `onInit` when present. If it returns a promise, or the owning module isn't initialised and the init hook returns a promise, `get` throws `ServiceNotReadyError`.
  - **FACTORY scope:** instances are never recorded and never get `onDestroy`.

- [ ] **Step 1: Write failing tests in `container.test.ts`.** Build `ModuleNode` fixtures by hand (`{ id: 'A' }`), with a fake visibility function where A sees B's exports `['BService']`. Cases:
  - own service visible
  - imported export visible
  - non-exported import service → `get` returns `null`, and `make` of a class injecting it throws `ServiceNotVisibleError` whose message contains `add it to B's exports`
  - global visible from every node and from no context
  - non-global service invisible with no context
  - same class registered in A and C (non-global) → two distinct instances
  - same name registered twice as global → `DuplicateGlobalServiceError` naming both owners
  - singleton constructed once; FACTORY gives a new instance each `get`
  - `constructed()` order matches construction order and excludes FACTORY
  - service with async `onInit` → `get` throws `ServiceNotReadyError`, `await Service.resolve()` returns an initialised instance
  - the service constructor observes `ModuleContext.current()?.id === owner id`
- [ ] **Step 2: Rewrite `service.test.ts`.**
  - `@Service.register()` leaves the container empty and sets `Symbols.serviceOptions`.
  - The global imperative API (`instance`, `factory`, `bind`, `keys`, `registerLazy`, `remove`, `clear`) behaves as before, with duplicates throwing.
- [ ] **Step 3: Run `bun test tests/container.test.ts tests/service.test.ts`.** Expected: FAIL.
- [ ] **Step 4: Implement `container.ts`.** Re-implement the `Service` namespace on top of it; delete `servicesRegistry` from `service.ts`.
- [ ] **Step 5: Run the same command.** Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(core): scoped service container with metadata-only Service.register"`

---

### Task 3: Module declaration and configurable modules

**Files:**
- Modify: `@elysiumjs/core/src/module.ts`
- Test: rewrite `@elysiumjs/core/tests/module.test.ts`

**Interfaces:**
- Consumes: `ServiceDefinition` (Task 2), `Symbols.module`, `Symbols.configuredModule`, `Symbols.moduleConfig`, `MissingModuleConfigError`.
- Produces:
  - `type ModuleProps<TConfig = unknown>`, with these fields:
    - `imports?: (ModuleClass | ConfiguredModule<any>)[]`
    - `services?: ServiceDefinition[] | ((config: TConfig) => ServiceDefinition[])`
    - `exports?: (Class<any> | string | ModuleClass)[] | true`
    - `controllers?: Class<any>[]`
    - `commands?: CommandClass[]`
    - `jobs?: Class<any>[]`
    - `prefix?: Route`
    - `env?: string[]`
  - `type ConfiguredModule<TConfig> = { readonly [Symbols.configuredModule]: true; readonly module: ModuleClass; readonly config: Partial<TConfig> | (() => Partial<TConfig> | Promise<Partial<TConfig>>) }`
  - `isConfiguredModule(value: unknown): value is ConfiguredModule<unknown>`
  - `Module.register(props)`: only `Reflect.defineMetadata(Symbols.module, props, target)`. Mounting moves to Task 7.
  - `getModuleProps(cls: ModuleClass): ModuleProps`: throws `InvalidModuleError` when the metadata is missing.
  - `Module` instance hooks, all default no-ops:
    - `onInit(): Promise<void> | void`
    - `onDestroy(): Promise<void> | void`
    - `onServe(app: Elysia<Route>): Promise<void> | void`
  - `Module` instance getter `config` returns the resolved config, set by the kernel through `Symbols.moduleConfig`.
  - `Module.configurable<TConfig extends object>(options: { defaults?: Partial<TConfig>; required?: (keyof TConfig)[] })` returns an abstract class extending `Module` with:
    - `static with(config): ConfiguredModule<TConfig>`
    - `static readonly config: string`, the injection token `elysium.module.${ClassName}.config`, computed from `this.name`
    - `static resolveConfig(input?: Partial<TConfig>): TConfig`: deep-merges `defaults` with `input` using the `deepMerge` in `utils.ts` and throws `MissingModuleConfigError` listing the missing required keys.
  - `beforeRegister`/`afterRegister` are removed.

- [ ] **Step 1: Write failing tests.**
  - `register` stores props without creating any Elysia instance.
  - `getModuleProps` on an undecorated class throws `InvalidModuleError`.
  - `X.with({...})` returns a configured module that `isConfiguredModule` recognises, with `module === X`.
  - `X.config === 'elysium.module.X.config'`.
  - `resolveConfig` merges defaults deeply and throws `MissingModuleConfigError` with `['url']` when `required: ['url']` is unset.
  - Default hooks resolve to `undefined`.
- [ ] **Step 2: Run `bun test tests/module.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `bun test tests/module.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): metadata-only modules with configurable with() support"`

---

### Task 4: Module graph (Phase 1)

**Files:**
- Modify: `@elysiumjs/core/src/module-graph.ts` (replace the Task 1 placeholder)
- Test: `@elysiumjs/core/tests/module-graph.test.ts`

**Interfaces:**
- Consumes: `getModuleProps`, `isConfiguredModule`, `currentEnvironment`, Task 1 errors.
- Produces:
  - `type ModuleNode = { readonly id: string; readonly moduleClass: ModuleClass; readonly props: ModuleProps; readonly imports: readonly ModuleNode[]; readonly depth: number; readonly configSources: readonly ConfigSource[] }`
    - `id` is the class name.
    - `depth` is the shortest distance from the root; the app's `modules` are depth 1.
  - `type ConfigSource = { readonly site: string; readonly depth: number; readonly config: ConfiguredModule<unknown>['config'] }`, where `site` is the importing module's id, or `'<app>'`.
  - `type ModuleGraph = { readonly nodes: readonly ModuleNode[]; readonly skipped: readonly ModuleClass[]; readonly environment: string; node(cls: ModuleClass): ModuleNode | undefined; visibleOwners(node: ModuleNode): readonly ModuleNode[]; exportsOf(node: ModuleNode): readonly string[] | true; collect<K extends 'controllers' | 'commands' | 'jobs'>(key: K): readonly { item: Class<any>; module: ModuleNode }[] }`
    - `nodes` are in topological order, imports first. Siblings follow their order in the importer's list.
  - `buildModuleGraph(rootModules: (ModuleClass | ConfiguredModule<any>)[], environment = currentEnvironment()): ModuleGraph`
  - `selectConfig(node: ModuleNode): ConfigSource | undefined`
    - Picks the lowest-depth source.
    - If two different sources share that depth: when both are object-form, deep-compare them (radash `isEqual`); equal is fine, different throws `ConflictingModuleConfigError(node.id, [siteA, siteB])`.
    - If either is function-form, return the first and leave the comparison to Task 5.
- Rules:
  - **Env filter:** a node whose `props.env` excludes the environment goes to `skipped`. Its imports are not walked through it.
  - **Cycles:** a cycle throws `ModuleCycleError` with the path.
  - **Duplicate commands:** two commands with the same static `command` in different modules throw `DuplicateCommandError`, checked after env filtering. Commands with `static dev = true` are excluded when `environment === 'production'`.
  - **Visibility:** `visibleOwners(node)` is the node's direct imports plus, recursively, any module a direct import lists in its `exports`. It is not transitive otherwise.

- [ ] **Step 1: Write failing tests.** Fixture modules declared with `Module.register`. Cases:
  - linear and diamond imports: D appears once, after B and C in `nodes`
  - depth is the shortest path
  - cycle A→B→A throws with path `A -> B -> A`
  - an `env: ['development']` module is skipped under `'production'`, and its imports are absent unless another loaded module imports them
  - visibility is non-transitive: A→B→C gives A no C
  - re-export: B `exports: [C]` gives A C
  - `exports: true` returns `true` from `exportsOf`
  - duplicate command name in two modules throws naming both
  - a dev command is dropped under production, so no collision
  - plain import plus `with(x)` gives one node whose selected config is `x`
  - app-level `with(a)` beats a package's `with(b)` at depth 2
  - two different object configs at the same depth throw `ConflictingModuleConfigError`; deep-equal ones don't
  - `collect('jobs')` returns items with their owning node
- [ ] **Step 2: Run `bun test tests/module-graph.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement as a pure function over metadata.** It must construct nothing.
- [ ] **Step 4: Run `bun test tests/module-graph.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): build module graph with env filtering, visibility and config precedence"`

---

### Task 5: Kernel (Phases 2 and 3, shutdown)

**Files:**
- Create: `@elysiumjs/core/src/kernel.ts`
- Test: `@elysiumjs/core/tests/kernel.test.ts`

**Interfaces:**
- Consumes: `ModuleGraph`, `selectConfig`, `Container`, `ModuleContext`, `Module.configurable` statics.
- Produces `class Kernel`:
  - `constructor(graph: ModuleGraph)`
  - `get graph(): ModuleGraph`
  - `register(): Promise<void>` (Phase 2):
    - For each node: evaluate its selected config (await function-form; when function-form sources tie at the same depth, compare the evaluated values and throw `ConflictingModuleConfigError` if they differ).
    - Apply `resolveConfig` when the class is configurable.
    - Instantiate the module class with `Service.make` in its own context and store the config on it via `Symbols.moduleConfig`.
    - Register the config under the class's `config` token as a module-owned service.
    - Evaluate `services` (array, or function of config) and `Container.register` each.
    - Wire `Container.setVisibility(graph.visibleOwners)`, `Container.setModuleInitHook(node => this.initModule(node))`, and `Container.setSkippedLookup(...)`. The lookup matches names of class-form services (from `Symbols.serviceOptions` or the class name) declared in `graph.skipped` modules; function-form services of skipped modules can't be known and aren't matched.
  - `initModule(node: ModuleNode): Promise<void>`: idempotent. Initialises the node's imports first, then calls `module.onInit()` in the module's context.
  - `bootEager(): Promise<void>`: `initModule` for every node in `graph.nodes` order, then `Service.resolve` every non-FACTORY service of every node.
  - `prepare<T>(cls: Class<T>, owner: ModuleNode): Promise<T>` (lazy):
    - Run `initModule(owner)`.
    - Await `Service.resolve` for every constructor-injected dependency of `cls`, read from `Symbols.services` metadata, inside owner context.
    - Construct `cls` with `Service.make` inside owner context.
  - `moduleInstance(node: ModuleNode): Module`
  - `shutdown(): Promise<void>`:
    - Call `onDestroy` on `Container.constructed()` in reverse, then on initialised modules in reverse init order.
    - Each runs in its owner context.
    - Errors are collected and logged with `console.error` (the logger isn't guaranteed to exist), not rethrown.
    - Idempotent.
- `Service.resolve` must, via the init hook, initialise a global service's owning module before construction. That covers the "command touches a model → `DrizzleModule` initialises" case (spec §5.6).

- [ ] **Step 1: Write failing tests.**
  - `register` calls a function-form `services(config)` with the resolved config.
  - Config is injectable through `X.config` inside X and not visible from an unrelated module.
  - Two tied function-form configs that evaluate differently throw.
  - Constructing a class that injects a service only provided by a module skipped for the current environment throws `EnvironmentSkippedModuleError` naming the service, the requester, the skipped module and the environment (spec §5.7).
  - `initModule` initialises imports first and runs once even when called twice.
  - `prepare` (lazy) initialises the command's module and the owner of a global dependency, but not an unrelated module (spy on `onInit`).
  - `bootEager` initialises every module and constructs every singleton.
  - `shutdown` order: services in reverse construction order, then modules in reverse init order.
  - **Review Focus 4:** a service throws in `onInit` during `bootEager` → `shutdown` (called by the test after catching) destroys only the previously constructed services, in reverse.
  - **Review Focus 2:** in a diamond, D's `onInit` is called once.
- [ ] **Step 2: Run `bun test tests/kernel.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `bun test tests/kernel.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): kernel with lazy and eager boot and ordered shutdown"`

---

### Task 6: Application CLI path, commands, and the testing helper

**Files:**
- Modify: `@elysiumjs/core/src/app.ts`, `@elysiumjs/core/src/command.ts`, `@elysiumjs/core/src/index.ts`
- Create: `@elysiumjs/core/src/testing.ts`
- Test: rewrite the command and lifecycle parts of `@elysiumjs/core/tests/app.test.ts`, `@elysiumjs/core/tests/command.test.ts`; create `@elysiumjs/core/tests/testing.test.ts`

**Interfaces:**
- Consumes: `buildModuleGraph`, `Kernel`, `ModuleContext`.
- Produces:
  - `AppProps = { debug?: boolean; server?: ElysiaConfig<Route> & { port?: number }; modules?: (ModuleClass | ConfiguredModule<any>)[]; swagger?: ElysiaSwaggerConfig<Route> | false; env?: TSchema; plugins?: ElysiumPlugin[] }`. No `redis`, `wamp` or index signature.
  - `Application.getConfig` is removed.
  - The `Application` constructor does env validation and `Service.instance('elysium.app', this)` only; it no longer calls `run()`.
  - `Application.prototype.run(argv: string[] = process.argv.slice(2)): Promise<void>`:
    - Builds the graph and kernel and dispatches the CLI action.
    - Catches `ElysiumError`, prints its message with `this.error`, and exits 1.
    - Calls `kernel.shutdown()` after a command completes.
  - `static start<T extends Application>(this: new () => T): Promise<void>` = `new this().run()`.
  - `Application.prototype.kernel: Kernel` getter, used by packages to query the graph.
  - `Command.register(options?: { name?: string })`: metadata only (`Symbols.command`, added to `Symbols`). An optional `name` overrides the static `command`; the graph reads it through `getCommandName(cls)` exported from `command.ts`.
  - `Command.boot: boolean = false`, a static readonly next to `dev`.
  - CLI dispatch:

    | Input | Behaviour |
    |---|---|
    | no args | describe |
    | `list` | Phase 1 only (graph, no `register`) |
    | `help <cmd>` | register + `prepare(cmd)` + `help()` |
    | `<cmd>` with `boot = false` | register + `prepare` + `init(argv)` + `run()` |
    | `<cmd>` with `boot = true` | register + `bootEager` + `Service.make` in owner context + `init` + `run` |
    | `serve` | Task 7 |

    `init`, `run` and `help` execute inside `ModuleContext.run(owner, …)`. The built-in `work` action is removed.
  - SIGINT and SIGTERM handlers call `kernel.shutdown()` then `process.exit(0)`.
  - `testing.ts`: `Application.testing(options: { modules: (ModuleClass | ConfiguredModule<any>)[]; overrides?: Record<string, unknown>; environment?: string; boot?: 'lazy' | 'eager' }): Promise<TestingApp>`, where `TestingApp = { kernel: Kernel; get<T>(name: string | Class<T>, from?: ModuleClass): Promise<T>; shutdown(): Promise<void> }`.
    - `overrides` are registered as globals before Phase 2 and win over module services of the same name.
    - `from` resolves inside that module's context.
    - The default environment is `'test'`.

- [ ] **Step 1: Write failing tests (command and app parts).**
  - `@Command.register()` leaves the container untouched.
  - A command listed in a module runs through `run(['cmd'])` and sees a module-private service via `Service.get` (tracked context).
  - A command not in any module → "not found" and exit 1 (mock `process.exit`).
  - `list` constructs no service (constructor spy).
  - `help cmd` prints the instance `help()`.
  - A lazy command doesn't call `onInit` of an unrelated module; a `boot = true` command does.
  - Constructing an `Application` subclass doesn't call `run`.
  - `ElysiumError` thrown during the graph phase is printed and exits 1.
  - `shutdown` runs after a command completes.
- [ ] **Step 2: Write failing `testing.test.ts`.**
  - An override replaces a module service.
  - An `env: ['test']` module loads under the default environment and is skipped with `environment: 'production'`.
  - `get(X, from: ModuleA)` respects visibility.
  - `shutdown()` calls `onDestroy`.
- [ ] **Step 3: Run `bun test tests/app.test.ts tests/command.test.ts tests/testing.test.ts`.** Expected: FAIL.
- [ ] **Step 4: Implement.** Export from `index.ts`:
  - `ConfiguredModule`, `ModuleProps`
  - `Kernel`, `ModuleGraph`, `ModuleNode`
  - `ModuleContext`
  - all errors
  - `ServiceDefinition`, `ServiceFactoryDefinition`
- [ ] **Step 5: Run the same command.** Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(core): CLI boots through the kernel; add Command.boot and Application.testing"`

---

### Task 7: Serve path and request-time module context

**Files:**
- Modify: `@elysiumjs/core/src/app.ts` (`commandServe`), `@elysiumjs/core/src/http.ts`, `@elysiumjs/core/src/websocket.ts`, `@elysiumjs/core/src/wamp.ts`, `@elysiumjs/core/src/middleware.ts`
- Test: rewrite the serve parts of `@elysiumjs/core/tests/app.test.ts`, `@elysiumjs/core/tests/http.test.ts`, `@elysiumjs/core/tests/middleware.test.ts`; adjust `websocket`/`wamp` tests where they build controllers.

**Interfaces:**
- Consumes: `Kernel`, `ModuleContext`, `ModuleNode`.
- Produces:
  - The controller plugin factory stored under `Symbols.elysiaPlugin` changes signature to `(node: ModuleNode) => Promise<ElysiaApp>` for HTTP, WS and WAMP.
  - Controllers are constructed with `ModuleContext.run(node, () => Service.make(target))`.
  - Every route handler, route-parameter service injection, and custom decorator runs inside `ModuleContext.run(node, …)`.
  - `applyMiddlewares(middlewares: Class<Middleware>[], plugin: AnyElysia, node: ModuleNode | null)`: constructs middlewares in `node`'s context (globals only when `null`, used for app-level middlewares). Each hook's chain runs in that context.
  - `mountModule(node: ModuleNode): Promise<ElysiaApp>` in `app.ts`, private: creates `new Elysia({ name: node.id, prefix: node.props.prefix })`, applies the module class's `Symbols.middlewares`, and uses each controller's plugin.
  - `serve` sequence:
    1. graph
    2. `kernel.register()`
    3. `kernel.bootEager()`
    4. `new Elysia(server)`
    5. swagger and `plugins`
    6. app middlewares
    7. `onServe(rootElysia)` for each node, in `graph.nodes` order, awaited, in that module's context
    8. `mountModule` for every node with controllers
    9. `listen`
    10. `onStop` → `kernel.shutdown()`
  - The transactional wrapper in `http.ts` keeps working: it calls `Service.get('db.connection.default')`, a global (spec §3 leaves moving it out of core to later work).

- [ ] **Step 1: Write failing tests.**
  - A controller in module A injects A's private service and handles a request via `app.elysia.handle(new Request('http://localhost/a/x'))`.
  - Inside the handler, `ModuleContext.current()?.id === 'A'`.
  - A module middleware is constructed with access to A's services.
  - `onServe` is called with the root Elysia instance, in import-first order, before controllers mount (record call order).
  - A boot failure in `bootEager` prevents `listen` (spy) and exits 1.
  - `onStop` triggers `shutdown`.
- [ ] **Step 2: Run `bun test tests/app.test.ts tests/http.test.ts tests/middleware.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the `console.log('Registering …')` lines touched here and use `this.debug` on the app where a message is still useful.
- [ ] **Step 4: Run `bun test` in `@elysiumjs/core`.** Expected: everything passes except the 4 pre-existing `InteractsWithConsole` failures.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): serve mounts modules through the kernel with per-module request context"`

---

### Task 8: RedisModule and WampModule; remove core's job system

**Files:**
- Modify: `@elysiumjs/core/src/redis.ts`, `@elysiumjs/core/src/wamp.ts`, `@elysiumjs/core/src/index.ts`, `@elysiumjs/core/src/utils.ts`
- Delete: `@elysiumjs/core/src/job.ts`, `@elysiumjs/core/src/worker.ts`, `@elysiumjs/core/tests/job.test.ts`
- Test: `@elysiumjs/core/tests/redis.test.ts`, `@elysiumjs/core/tests/wamp.test.ts`

**Interfaces:**
- Produces:
  - `RedisModule = Module.configurable<{ default: string; connections: Record<string, RedisConnectionProps> }>({ required: ['connections'] })`, decorated with `Module.register({ services: (config) => [...] })`.
    - Services: one global factory entry per connection named as `Redis` names it today, plus a global alias for the default.
    - `onDestroy` closes clients that were created.
  - `WampModule`: same shape with `WampClientProps`. `onDestroy` closes open sessions.
  - `Redis.getConnection(name?)` and `Wamp.getConnection(name?)` keep their signatures and read the global container. `registerConnection`/`setDefaultConnection` are deleted.
  - Removed from `index.ts`: `Job`, `Worker`, `WorkerPool`, `QueueOptions`. Removed from `utils.ts`: `Symbols.job`.

- [ ] **Step 1: Update `redis.test.ts` and `wamp.test.ts` to boot through `Application.testing({ modules: [RedisModule.with({...})] })`.**
  - `Redis.getConnection('cache')` returns the client.
  - The default alias resolves.
  - Lazy boot creates no client until first `get`.
  - `shutdown` closes the created client (mock `Bun.RedisClient`/`wampy` as the current tests do).
- [ ] **Step 2: Run `bun test tests/redis.test.ts tests/wamp.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement and delete the job system files.**
- [ ] **Step 4: Run `bun test` and `bun run typecheck` in `@elysiumjs/core`.** Expected: tests as at the end of Task 7, typecheck clean.
- [ ] **Step 5: Commit.** `git commit -m "feat(core)!: RedisModule and WampModule; remove core job system"`

---

### Task 9: HermesModule

**Files:**
- Create: `@elysiumjs/hermes/src/hermes.module.ts`
- Modify: `@elysiumjs/hermes/src/index.ts`
- Test: `@elysiumjs/hermes/tests/hermes.module.test.ts`

**Interfaces:**
- Produces: `HermesModule = Module.configurable<HermesConfig>({ defaults: { level: 'info', format: 'json' } })`.
  - Services: global singletons `HermesLogger` and `'logger'` (the same instance, via a factory definition that resolves `HermesLogger`), built from config.
  - `onDestroy` flushes transports when `HermesLogger` exposes a flush (`pino` `flush`).
  - `index.ts` loses the `Service.registerLazy` block and the `hermesInstance` cache.
  - Export `HermesModule`.
- Use the default values the logger falls back to today if they differ from `{ level: 'info', format: 'json' }`; read `services/logger.service.ts`.

- [ ] **Step 1: Write failing tests.**
  - Importing `@elysiumjs/hermes` registers nothing (`Service.exists('logger') === false`).
  - Under `Application.testing({ modules: [HermesModule.with({ level: 'debug' })] })`, `get('logger')` is a `HermesLogger` at level `debug`, and the same instance as `get(HermesLogger)`.
- [ ] **Step 2: Run `bun test tests/hermes.module.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement; update existing hermes tests that relied on import-time registration.**
- [ ] **Step 4: Run `bun test` in `@elysiumjs/hermes`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(hermes)!: expose HermesModule with typed config"`

---

### Task 10: MnemosyneModule

**Files:**
- Create: `@elysiumjs/mnemosyne/src/mnemosyne.module.ts`
- Modify: `@elysiumjs/mnemosyne/src/cache.ts`, `@elysiumjs/mnemosyne/src/keyv-redis.ts`, `@elysiumjs/mnemosyne/src/tenancy.ts`, `@elysiumjs/mnemosyne/src/database.ts`, `@elysiumjs/mnemosyne/src/index.ts`
- Test: `@elysiumjs/mnemosyne/tests/mnemosyne.module.test.ts`; update existing cache and tenancy tests

**Interfaces:**
- Produces: `MnemosyneModule = Module.configurable<MnemosyneModuleConfig>({ defaults: { cache: { redis: { connection: 'cache' }, memory: { ttl: 60000, lruSize: 5000 } } } })`.
  - `MnemosyneModuleConfig = { cache: { redis?: { connection: string }; memory?: { ttl: number; lruSize: number } } }`
  - Services: globals `'mnemosyne.cache.redis'` and `'mnemosyne.cache.memory'` (`CacheInterface`). Tenancy config is **not** part of this module: driver modules own it (Task 11), because a dependency's config can't depend on its importer's config during Phase 2.
  - `Cache.redis` / `Cache.memory` keep their static getters but resolve from the global container (throw `ServiceNotFoundError` when the module isn't loaded).
  - `KeyvRedis` resolves `Redis.getConnection(connection)` lazily on first use. Remove the `Event.once('elysium:app:launched')`.
  - `getTenancyConfig()` reads `'mnemosyne.tenancy.config'` and falls back to `{ mode: 'schema' }` when it isn't registered.
  - `registerTenancyStrategy` and the module-level `_strategy` are replaced: the strategy becomes a global service `'mnemosyne.tenancy.strategy'` registered by the driver module (Task 11). `getTenancyStrategy()` reads it.
  - `AbstractDatabase.getConnection`/`registerConnection` throw `ServiceNotFoundError`/`DuplicateGlobalServiceError` instead of `process.exit`. `registerConnection`/`setDefaultConnection` are removed; connections are registered by driver modules. `getConnection`, `connectionExists`, `getDefaultConnection` and `getRawClient` stay.
  - Export `MnemosyneModule`, `MnemosyneModuleConfig`.

- [ ] **Step 1: Write failing tests.**
  - Importing the package registers nothing.
  - With `MnemosyneModule` plus `RedisModule.with({...})`, `Cache.redis` works, and constructing it opens no Redis client until first use.
  - `Cache.memory` uses the configured TTL.
  - `getTenancyConfig()` returns `{ mode: 'rls' }` when `'mnemosyne.tenancy.config'` is registered as a global with that value (use `overrides`), and `{ mode: 'schema' }` when it isn't.
  - `getConnection('missing')` throws `ServiceNotFoundError`.
- [ ] **Step 2: Run `bun test tests/mnemosyne.module.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement; fix the existing tests that mocked app config keys.**
- [ ] **Step 4: Run `bun test` in `@elysiumjs/mnemosyne`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(mnemosyne)!: expose MnemosyneModule; remove launch-event wiring"`

---

### Task 11: DrizzleModule and production-safe migrations

**Files:**
- Create: `@elysiumjs/mnemosyne-drizzle/src/drizzle.module.ts`, `@elysiumjs/mnemosyne-drizzle/src/commands/migration_generate.command.ts`, `@elysiumjs/mnemosyne-drizzle/src/commands/migration_run.command.ts`
- Delete: `@elysiumjs/mnemosyne-drizzle/src/init.ts`, `@elysiumjs/styx/src/commands/migration_generate.command.ts`, `@elysiumjs/styx/src/commands/migration_run.command.ts`
- Modify: `@elysiumjs/mnemosyne-drizzle/src/index.ts`, `@elysiumjs/mnemosyne-drizzle/src/database.ts`, `@elysiumjs/mnemosyne-drizzle/src/tenancy.ts`, `@elysiumjs/mnemosyne-drizzle/package.json` (add `prompts` dependency), `@elysiumjs/styx/src/commands/index.ts`, `@elysiumjs/styx/package.json` (drop the `mnemosyne-drizzle` peer if nothing else uses it)
- Test: `@elysiumjs/mnemosyne-drizzle/tests/drizzle.module.test.ts`

**Interfaces:**
- Consumes: `MnemosyneModule` (Task 10).
- Produces: `DrizzleModule = Module.configurable<{ default: string; connections: Record<string, DrizzleConnectionProps>; tenancy?: TenancyConfig }>({ required: ['connections'] })`.
  - Imports `MnemosyneModule` (plain import).
  - Services, all global:
    - `db.connection.<name>` per connection (factory → `driver.createConnection`)
    - `db.connection.default` aliasing `config.default`
    - `'mnemosyne.tenancy.config'`: `config.tenancy ?? { mode: 'schema' }`
    - `'mnemosyne.tenancy.strategy'`: `DrizzleRLSTenancy` when `tenancy.mode === 'rls'`, else `DrizzleSchemaTenancy`
  - `onDestroy` closes `$client` for each created connection.
  - `commands: [MigrationGenerateCommand, MigrationRunCommand]`, both extending `Command`, not styx's `BaseCommand`, so they aren't `dev`. Fix the `migration:run` description to `'Runs pending migrations.'`.
  - `Database` (the singleton helper) keeps resolving through the global container.
  - Export `DrizzleModule`. Remove `import './init'` from `index.ts`.
- Do not commit the uncommitted `init.ts`; delete it. Keep the other staged changes in `package.json`/`index.ts`/`tsconfig.json` that are unrelated to `init`.

- [ ] **Step 1: Write failing tests.**
  - Importing the package registers nothing.
  - With `DrizzleModule.with({ default: 'main', connections: { main: { connection: 'postgres://u:p@localhost:5432/db' } } })` under `Application.testing`, `Database.getConnection()` returns a Drizzle instance without connecting (bun-sql connects lazily).
  - `getTenancyStrategy()` is `DrizzleSchemaTenancy` by default and `DrizzleRLSTenancy` with `tenancy: { mode: 'rls' }`.
  - **Regression (spec §7):** `app.run(['migration:run', '--tenant', 'public'])` reaches `Database.connectionExists('default') === true`. Stub `$client.connect`/`begin` so no database is needed and assert the "Connection does not exist" error is **not** printed.
  - Under `NODE_ENV=production`, `migration:run` is listed (graph `collect('commands')`).
- [ ] **Step 2: Run `bun test tests/drizzle.module.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement; move the commands with their logic unchanged apart from the base class and description.**
- [ ] **Step 4: Run `bun test` in `@elysiumjs/mnemosyne-drizzle`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(mnemosyne-drizzle)!: DrizzleModule owns connections, tenancy and migrations"`

---

### Task 12: HeraclesModule

**Files:**
- Create: `@elysiumjs/heracles/src/heracles.module.ts`, `@elysiumjs/heracles/src/registry.ts`
- Modify: `@elysiumjs/heracles/src/index.ts`, `@elysiumjs/heracles/src/job.ts`, `@elysiumjs/heracles/src/workers/redis.worker.ts`, `@elysiumjs/heracles/src/commands/list.command.ts`, `@elysiumjs/heracles/src/commands/work.command.ts`, `@elysiumjs/heracles/src/commands/index.ts`
- Test: `@elysiumjs/heracles/tests/heracles.module.test.ts`; update `job.test.ts`, `worker.test.ts`

**Interfaces:**
- Produces:
  - `HeraclesModule = Module.configurable<{ queues?: Record<string, Omit<QueueOptions, 'name'>> }>({ defaults: { queues: {} } })`.
    - `commands: [HeraclesCleanCommand, HeraclesListCommand, HeraclesWorkCommand]`.
    - `onInit`:
      - Build the job registry from `Application.instance.kernel.graph.collect('jobs')`, keeping only classes with heracles job metadata.
      - Throw `DuplicateJobError(name: string, modules: [string, string])` (defined in `registry.ts`, extends core `ElysiumError`) on name clashes.
      - Create the configured queues with `Queue.get(name, options)`.
  - `registry.ts`: `JobRegistry.set(entries)`, `JobRegistry.get(name: string): { jobClass: JobClass<Job>; module: ModuleNode } | undefined`, `JobRegistry.all()`.
  - `Job.register`: drop `Service.instance(name, target)`; metadata only.
  - `redis.worker.ts` `handleProcessJob` looks the job up with `JobRegistry.get(jobName)`, then constructs and executes it inside `ModuleContext.run(entry.module, …)`.
  - `list.command.ts` reads `JobRegistry.all()`.
  - `HeraclesWorkCommand`: `public static readonly boot = true`.
  - `index.ts`: remove `import './commands'`; export `HeraclesModule`, `DuplicateJobError`.

- [ ] **Step 1: Write failing tests.**
  - Importing registers nothing.
  - A user module listing `jobs: [SendInvoiceJob]` plus `HeraclesModule` yields `JobRegistry.get('elysium.heracles.job.SendInvoiceJob')` with the user module as owner.
  - The same job name in two modules → `DuplicateJobError` naming both.
  - A job's `execute` sees its module's private service via `Service.get` (call the worker's process path with a stubbed transport, as `worker.test.ts` does today).
  - `HeraclesWorkCommand.boot === true`.
- [ ] **Step 2: Run `bun test tests/heracles.module.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement; update `job.test.ts` and `worker.test.ts` for the registry.**
- [ ] **Step 4: Run `bun test` in `@elysiumjs/heracles`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(heracles)!: HeraclesModule collects jobs from loaded modules"`

---

### Task 13: StyxModule and the styx binary

**Files:**
- Create: `@elysiumjs/styx/src/styx.module.ts`
- Modify: `@elysiumjs/styx/src/index.ts`, `@elysiumjs/styx/src/styx.ts`, `@elysiumjs/styx/src/commands/make_command.command.ts`, `make_job.command.ts`, `make_service.command.ts`, `make_controller.command.ts`, `module_new.command.ts`, and the matching stubs in `@elysiumjs/styx/stubs/`
- Test: `@elysiumjs/styx/tests/styx.module.test.ts` (create `tests/` and `bunfig.toml` `[test]` section mirroring core's, without the coverage threshold)

**Interfaces:**
- Produces:
  - `@Module.register({ env: ['development'], commands: [all make:* and module:* commands] }) export class StyxModule extends Module {}`
  - `index.ts` exports `StyxModule` and has no `import './commands'`. The `App` subclass and top-level await are removed.
  - `styx.ts` (bin):
    - Resolve the project entry as `${getProjectPath()}/src/app.ts` if it exists, else `${getProjectPath()}/index.ts`.
    - Import it, take its exported `Application` subclass (the first export whose prototype chain includes `Application`), and `await App.start()`.
    - If no `Application` subclass is exported, print `Could not find an exported Application class in <path>` and exit 1.
  - Generators: after writing a file, print `Add <ClassName> to the <commands|jobs|services|controllers> list of <ModuleName> in <module file path>.` This is my call from spec §6: print instead of editing module files. `module:new` writes a module file with empty `services`, `controllers` and `commands` arrays.
  - Stubs: command, job and service stubs drop any `import` of side-effect registration, and `@Command.register()` stays only as optional metadata.

- [ ] **Step 1: Write failing tests.**
  - `StyxModule` is skipped under `'production'` and loaded under `'development'` (graph test).
  - The bin's entry resolution picks `src/app.ts` over `index.ts` and fails with the exact message when no app is exported (extract the resolver as `resolveAppEntry(projectPath: string): Promise<typeof Application>` in `utils.ts` and test it against fixture folders under `tests/fixtures/`).
- [ ] **Step 2: Run `bun test` in `@elysiumjs/styx`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `bun test` in `@elysiumjs/styx`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(styx)!: dev-only StyxModule; binary runs the user app"`

---

### Task 14: HephaestusModule and CerberusModule

**Files:**
- Create: `@elysiumjs/hephaestus/src/hephaestus.module.ts`, `@elysiumjs/cerberus/src/cerberus.module.ts`
- Modify: `@elysiumjs/hephaestus/src/index.ts`, `@elysiumjs/cerberus/src/index.ts`, `@elysiumjs/cerberus/src/cerberus.middleware.ts`
- Test: `@elysiumjs/hephaestus/tests/hephaestus.module.test.ts`, `@elysiumjs/cerberus/tests/cerberus.module.test.ts`

**Interfaces:**
- Produces:
  - `HephaestusModule`: `@Module.register({ commands: [BuildCommand, DockerCommand, EmbedCommand] })`. Use the class names actually exported from `src/commands/*.command.ts`. `index.ts` loses `import './commands'`.
  - `CerberusModule = Module.configurable<CerberusConfig>({})`: `services: [CerberusMiddleware]`, `exports: true`.
  - `CerberusMiddleware` injects `@Service.inject(CerberusModule.config)` instead of `Application.instance.getConfig('elysium:cerberus')`.
  - Apps apply the middleware as today with `@Middleware.register(CerberusMiddleware)` on a module that imports `CerberusModule`.

- [ ] **Step 1: Write failing tests.**
  - Importing either package registers nothing.
  - `HephaestusModule`'s graph `collect('commands')` lists the three commands.
  - `CerberusMiddleware`, constructed inside a module importing `CerberusModule.with(cfg)`, receives `cfg`.
  - Constructed from an unrelated module, it throws `ServiceNotVisibleError`.
- [ ] **Step 2: Run `bun test` in both packages.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `bun test` in both packages.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(hephaestus,cerberus)!: expose modules"`

---

### Task 15: ArgusModule and SentryModule

**Files:**
- Create: `@elysiumjs/argus/src/argus.module.ts`, `@elysiumjs/plugin-sentry/src/sentry.module.ts`
- Modify: `@elysiumjs/argus/src/index.ts`, `@elysiumjs/plugin-sentry/src/index.ts`
- Test: `@elysiumjs/argus/tests/argus.module.test.ts`, `@elysiumjs/plugin-sentry/tests/sentry.module.test.ts` (create the test folder and `bunfig.toml` `[test]` section for plugin-sentry)

**Interfaces:**
- Produces:
  - `ArgusModule = Module.configurable<TracingConfig>({})`:
    - `onInit` starts `ArgusSDK` with the config.
    - `onServe(app)` does `app.use(argusPlugin())`.
    - `onDestroy` shuts the SDK down.
  - `SentryModule = Module.configurable<Sentry.BunOptions>({})`: `onServe(app)` does `app.use(await plugin(this.config)(Application.instance))`, reusing the existing `plugin()` factory.
  - Both are exported from their package index. The existing plugin factories stay exported for apps that use `AppProps.plugins` directly.

- [ ] **Step 1: Write failing tests.**
  - Under `Application.testing`, `onServe` is invoked with an Elysia instance whose `use` receives the plugin. Spy on `use` and mock `@sentry/bun` / the OTel exporter.
  - `ArgusModule.onDestroy` calls the SDK shutdown.
- [ ] **Step 2: Run `bun test` in both packages.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `bun test` in both packages.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(argus,plugin-sentry)!: expose modules installing root plugins via onServe"`

---

### Task 16: Example app, templates, docs, changeset

**Files:**
- Modify:
  - `example/src/app.ts`
  - `example/src/modules/hero/hero.module.ts`
  - `example/src/modules/hero/jobs/email.job.ts`
  - `example/src/modules/hero/jobs/failing.job.ts`
  - `example/src/modules/hero/controllers/http/user.controller.ts`
  - `example/package.json` (add `@elysiumjs/heracles`)
  - `example/index.ts` if present (call `App.start()`)
  - `create-elysium/template-single/**`, `create-elysium/template-multi/**` (app file, entry, `package.json`)
  - each package `README.md`
- Create: `.changeset/module-system.md`

**Interfaces:**
- Consumes: every module from Tasks 8–15.
- Produces:
  - Example `App` with `modules`:
    1. `HermesModule.with({ level: 'debug', format: 'pretty' })`
    2. `RedisModule.with({ default: 'cache', connections: { cache: { url: process.env.REDIS_URL! } } })`
    3. `WampModule.with({ default: 'main', connections: { main: { url: process.env.WAMP_URL!, realm: 'realm1' } } })`
    4. `DrizzleModule.with(() => ({ default: 'main', connections: { main: { connection: process.env.DATABASE_URL! } } }))`
    5. `HeraclesModule.with({ queues: { email: { transport: RedisTransport } } })` (use the transport options the heracles README documents)
    6. `StyxModule`
    7. `MainModule`
  - `MainModule` lists its commands (`ProgressDemoCommand`, `SpinnerDemoCommand`, `TestCommand`, using the exported class names) and `jobs`.
  - The `import '#hero/commands/…'` lines are removed.
  - `onStart` no longer creates a `WorkerPool`.
  - Jobs extend heracles `Job` and are dispatched with `Heracles.dispatch`.
  - `user.controller.ts` keeps its `Service.get<UserService>('user.service')` call; it now works through module context.
  - The changeset bumps every touched `@elysiumjs/*` package `minor`, with a summary of the breaking changes from spec §3 and §5.

- [ ] **Step 1: Update the example and templates.**
- [ ] **Step 2: Run `bun run build` and `bun run typecheck` at the repo root.** Expected: success.
- [ ] **Step 3: Run `bun test` at the repo root (turbo).** Expected: all suites pass except the 4 pre-existing `InteractsWithConsole` failures.
- [ ] **Step 4: Smoke-test the example from `example/` and record the outputs in the commit body.**
  - `bun run index.ts list`: shows the `make:*`, `migration:*` and `heracles:*` commands.
  - `NODE_ENV=production bun run index.ts list`: no `make:*`, `migration:*` present.
  - `bun run index.ts serve` with `PORT=3999`, then `curl -s localhost:3999/<a hero route>`: responds.
- [ ] **Step 5: Verify no side-effect imports remain.** `grep -rn "^import '\./\|^import '#" @elysiumjs/*/src example/src` returns nothing.
- [ ] **Step 6: Update READMEs to show module imports and `with()`; write the changeset.**
- [ ] **Step 7: Commit.** `git commit -m "chore: migrate example and templates to module system; add changeset"`
