---
'@elysiumjs/core': minor
'@elysiumjs/themis': minor
'@elysiumjs/ariadne': patch
---

Routes take a success `status` (`@Http.post('/', { status: 201 })`, `@Http.del('/:id', { status: 204 })` without a body), documented with the response schema. `Http.currentContext()` gives the context of the request being handled outside its handler. `Service.extension()` makes an extension point: a tag, a decorator that registers a service with its options, and `all()`, `find()` and `optionsOf()`, which refuse two services with the same name. Themis adds `@Auth.currentUser()` for handler parameters and an `AuthUser` interface that apps augment to type the user everywhere.
