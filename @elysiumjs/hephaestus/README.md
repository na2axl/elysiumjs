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

A Worker can import `.wasm` files. Each imported file is copied next to the bundle and kept as an import, so workerd loads it as a compiled WebAssembly module. Files with the same name from different folders get a numbered suffix.

With `--target node`, it bundles the app into one ES module for Node.js: the entry (`node.entry`, `./src/server.ts` by default, or `--entry`) builds the app with `@elysiumjs/runtime-node` and serves it. The bundle is written to `output.dir` as `node.outfile` (`server.js` by default), with every dependency inside except those listed in `node.external`. The bundler emits the decorator metadata the container reads, so no `tsc` step is needed. This target needs no config file either.

```bash
styx build --target node
node dist/server.js
```

Bun plugins listed in `build.plugins` run in the Workers and Node builds, after the built-in ones. Plugins are functions, so they need a `hephaestus.config.ts` (or `.js`); a JSON config refuses them. The binary target does not run them.

```ts
import type { BunPlugin } from 'bun';

const banner: BunPlugin = {
	name: 'banner',
	setup(build) {
		build.onLoad({ filter: /\/src\/banner\.ts$/ }, () => ({
			contents: `export const banner = ${JSON.stringify(process.env.APP_BANNER ?? '')};`,
			loader: 'ts'
		}));
	}
};

export default {
	output: { name: 'my-app' },
	build: { plugins: [banner] }
};
```

To provide the commands from the app itself instead, list `HephaestusModule` in its modules and install the package as a regular dependency.

The classes behind the commands (`BinaryBuilder`, `WorkersBuilder`, `NodeBuilder`, `AssetEmbedder`, `DockerGenerator`) are exported for build scripts. Styx builds its own standalone executables with them.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
