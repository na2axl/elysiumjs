# create-elysium

Creates Elysium projects. It runs `styx create` from [`@elysiumjs/styx`](../@elysiumjs/styx), so both commands take the same options.

## Usage

```bash
bun create elysium my-app
```

or, with the Styx command installed globally:

```bash
bun add -g @elysiumjs/styx
styx create my-app
```

Without options, it asks for the template, runtime, modules, plugins and features. Pass them to skip the prompts, for example:

```bash
bun create elysium my-app --template multi --modules users,billing --features prettier --yes
```
