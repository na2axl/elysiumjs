---
'@elysiumjs/mnemosyne': minor
'@elysiumjs/core': patch
---

Type the query string of the query DSL. `Query.define` keeps the names of the filters, their operators and the sortable fields, `Query.Params<typeof spec>` types the parameter that `@Http.query()` decorates (`filter[status]`, `filter[status][in]`, `sort`, `cursor`, `limit`, `fields`, each an optional string), and `Query.schema(spec)` returns a schema of that type. Because the generated routes read the parameter's type, clients get typed query keys. Core re-exports TypeBox's `TOptional` and `TString` types.
