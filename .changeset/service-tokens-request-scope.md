---
'@elysiumjs/core': minor
'@elysiumjs/hermes': minor
'@elysiumjs/mnemosyne-drizzle': patch
---

Services are identified by their class, or by the name given to `@Service.register({ name })`. Class names are never used as identifiers, so services resolve the same way in minified builds; `bun run check:minified` in core bundles a minified app and checks that every service resolves. `@Service.inject()` without an argument injects the class of the parameter type, and throws when the type is unknown. Factory services in a module's `services` take a class or a name in `name`.

`ServiceScope.REQUEST` gives one instance per HTTP request, shared by the request's middlewares, controller and handler. `Service.runInRequestScope(fn)` opens a request scope outside a route. Resolving a request-scoped service outside a request throws `OutsideRequestScopeError`, and a singleton (or a server-scoped controller) depending on one throws `ScopeMismatchError`.

`HermesModule` registers the logger by the `HermesLogger` class and as `logger`.
