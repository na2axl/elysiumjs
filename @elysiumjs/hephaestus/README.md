# @elysiumjs/hephaestus

Build tooling for Elysium.js applications: standalone binaries, Cloudflare Worker bundles, Docker images and embedded assets.

## Installation

Install it as a dev dependency of your project, beside `@elysiumjs/styx`:

```bash
bun add -D @elysiumjs/hephaestus
```

## Usage

Styx loads the Hephaestus commands itself when the project installs the package, so the app imports nothing:

```bash
styx hephaestus:build
styx list
```

The build settings live in `hephaestus.config.ts` (`styx create --features hephaestus` writes one).

`styx build` runs `hephaestus:build`. With `--target workers`, it bundles a Cloudflare Worker instead of a binary: the entry (`workers.entry`, `./src/worker.ts` by default, or `--entry`) is compiled ahead of time with `elysia/plugin/aot`, written to `output.dir` as `workers.outfile` (`worker.js` by default), and refused if it still generates code at runtime. The entry exports the Worker handlers as default and the root Elysia app as `app`, as `createWorker()` from `@elysiumjs/runtime-workers` lets it. This target needs no config file.

```bash
styx build --target workers
```

To provide the commands from the app itself instead, list `HephaestusModule` in its modules and install the package as a regular dependency.

The classes behind the commands (`BinaryBuilder`, `WorkersBuilder`, `AssetEmbedder`, `DockerGenerator`) are exported for build scripts. Styx builds its own standalone executables with them.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
