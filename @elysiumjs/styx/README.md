# @elysiumjs/styx

The command line tool of the Elysium.js framework. It creates projects, generates code and runs your app's commands.

## Installation

Install it globally to create projects and use it anywhere:

```bash
bun add -g @elysiumjs/styx
```

Projects also install it as a dev dependency (`styx create` does this). Inside a project, the global `styx` hands every command to the project's own copy, so each project runs the Styx version it was written for.

Standalone executables, which need neither Bun nor the package files, are built with `bun run build:bin` (current platform) or `bun run build:bin --all` (Linux, macOS and Windows). They embed the code stubs and project templates with Hephaestus.

## Creating a project

```bash
styx create my-app
```

Without options, it asks for the template (single or multi module), the runtime, the modules, plugins and features. Options skip the prompts:

```bash
styx create my-app --template multi --modules users,billing --features prettier,hephaestus --git false
```

`--install false` writes the files without installing dependencies, `--force` replaces a folder that is not empty, and `--yes` takes the defaults for every option not given. `bun create elysium my-app` runs the same command.

## Generating code

The generators write files from stubs and never start your app, so they work before the app can boot:

```bash
styx make:command --name SendReport
styx make:controller --name UserController
styx make:job --name ImportUsers
styx make:middleware --name AuthMiddleware
styx make:model --name User
styx make:repository --name UserRepository
styx make:service --name UserService
styx make:validator --name CreateUser
styx module:new --name billing
styx module:rename --module billing --name payments
```

In a multi module project, pass `--module <name>`. Run `styx help <command>` for every option.

## Running the app

Every other command loads the project's app (`src/app.ts` or `index.ts`) and runs there:

```bash
styx serve
styx migration:generate
styx migration:run
styx <your command>
```

These need `@elysiumjs/styx` in the project's dev dependencies.

## Build tools

When the project installs `@elysiumjs/hephaestus` (as a dev dependency), its `hephaestus:*` commands are available through `styx` without adding anything to the app.

## Listing commands

```bash
styx list
styx help <command>
```

## Contributing

This project is built primarily to meet requirements for internal projects at [Workbud Technologies Inc.](https://www.workbud.com)

Feel free to open issues for any bugs or questions you may have. Pull requests are also welcome, but they will be reviewed to ensure they align with our internal project's goals and standards.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](https://github.com/na2axl/elysiumjs/blob/main/LICENSE) file for more information.
