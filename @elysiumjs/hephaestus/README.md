# @elysiumjs/hephaestus

Build tooling for Elysium.js applications: standalone binaries, Docker images and embedded assets.

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

Apps that still list `HephaestusModule` in their modules keep working, but the package then has to be a regular dependency.

The classes behind the commands (`BinaryBuilder`, `AssetEmbedder`, `DockerGenerator`) are exported for build scripts. Styx builds its own standalone executables with them.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
