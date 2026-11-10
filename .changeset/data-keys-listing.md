---
'@elysiumjs/mnemosyne': minor
'@elysiumjs/mnemosyne-drizzle': minor
'@elysiumjs/moirai-drizzle': minor
---

Mnemosyne's list helpers are named `Listing` (`Listing.define()`, `Listing.parse()`, `Listing.mapPage()` and more), so they no longer share a name with the queries of moirai. `Listing.filterPage(page, keep)` filters the rows of a page and keeps its pagination. Repositories take a `RowKey`, a scalar id or an object: `DrizzleRepository` finds rows by the table's primary key, composite keys included, or by the columns named in `DrizzleRepository(model, { key })`, and throws `RepositoryKeyError` for a key that does not match. `list(query, scope)` and `count(query, scope)` take an extra condition. The moirai-drizzle stores accept tables in a domain's own schema with extra columns and another primary key (`StoreTable<T>`).
