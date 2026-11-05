# create-elysium

An utility tool to create Elysium projects.

## Usage

```bash
bun create elysium
```

The wizard asks for the project name and path, the template, the runtime, the modules, plugins and features. The runtime step installs the matching package (`@elysiumjs/runtime-bun` today) and wires it into `src/app.ts`. Node.js and Cloudflare Workers are listed but not selectable yet: the Postgres, Redis and CLI packages the templates use still need Bun, and Workers apps wait for the synchronous module build and the Workers adapter.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../LICENSE) file for more information.
