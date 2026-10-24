# @elysiumjs/styx

CLI tool for Elysium.js framework.

## Installation

```bash
bun install @elysiumjs/styx
```

## Usage

The `styx` command needs to be run inside an Elysium.js project. It loads `src/app.ts` (or `index.ts`) and starts the exported `Application` subclass.

Add `StyxModule` to the modules of your application to get the commands below. It is only active in development (`NODE_ENV=development`, the default), so the `make:*` and `module:*` commands are absent in production. The `migration:*` commands come from your database module (`DrizzleModule`) and stay available in production.

```ts
import { Application } from '@elysiumjs/core';
import { StyxModule } from '@elysiumjs/styx';

@Application.register({
	modules: [StyxModule /* , your other modules */]
})
export class App extends Application {}
```

To create new items:

```bash
bun styx make:command [options]
bun styx make:controller [options]
bun styx make:job [options]
bun styx make:middleware [options]
bun styx make:model [options]
bun styx make:repository [options]
bun styx make:service [options]
bun styx make:validator [options]
```

To manage migrations:

```bash
bun styx migration:generate [options]
bun styx migration:run [options]
```

To manage modules:

```bash
bun styx module:new [options]
bun styx module:rename [options]
```

To start the Elysium.js project:

```bash
bun styx serve
```

To execute a custom command:

```bash
bun styx <command>
```

To show all available commands:

```bash
bun styx list
```

To get help for a specific command:

```bash
bun styx help <command>
```

## Contributing

This project is built primarily to meet requirements for internal projects at [Workbud Technologies Inc.](https://www.workbud.com)

Feel free to open issues for any bugs or questions you may have. Pull requests are also welcome, but they will be reviewed to ensure they align with our internal project's goals and standards.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](https://github.com/workbud/elysium/blob/main/LICENSE) file for more information.
