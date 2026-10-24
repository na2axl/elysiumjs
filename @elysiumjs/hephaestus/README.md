# @elysiumjs/hephaestus

Build tooling for Elysium.js applications: standalone binaries, Docker images and embedded assets.

## Installation

```bash
bun add -D @elysiumjs/hephaestus
```

## Usage

Add `HephaestusModule` to the modules of your application. It provides the Hephaestus commands to `styx`.

```ts
import { Application } from '@elysiumjs/core';
import { HephaestusModule } from '@elysiumjs/hephaestus';

@Application.register({
	modules: [HephaestusModule /* , your other modules */]
})
export class App extends Application {}
```

Then run `bun styx list` to see the available commands.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
