# @elysiumjs/mnemosyne

Database abstractions and caching for Elysium.js applications.

## Installation

```bash
bun add @elysiumjs/mnemosyne
```

## Usage

`MnemosyneModule` provides the caches (`Cache.redis` and `Cache.memory`). Database driver modules such as `DrizzleModule` from `@elysiumjs/mnemosyne-drizzle` import it for you, so you only add it yourself when you want to configure the caches or use them without a database:

```ts
import { Application, RedisModule } from '@elysiumjs/core';
import { MnemosyneModule } from '@elysiumjs/mnemosyne';

@Application.register({
	modules: [
		RedisModule.with({
			default: 'cache',
			connections: { cache: { url: process.env.REDIS_URL! } }
		}),
		// Opt out of a cache with `redis: false` or `memory: false`.
		MnemosyneModule.with({ cache: { memory: { ttl: 60_000, lruSize: 5000 } } })
	]
})
export class App extends Application {}
```

Any Keyv store can back a cache of its own with `stores`, read with `Cache.store(name)`. On Cloudflare Workers, `KeyvWorkersKV` from `@elysiumjs/runtime-workers` stores entries in a KV namespace:

```ts
import { KeyvWorkersKV } from '@elysiumjs/runtime-workers';

MnemosyneModule.with({
	cache: { redis: false, stores: { kv: () => new KeyvWorkersKV({ binding: 'CACHE' }) } }
});

await Cache.store('kv').set('greeting', 'hello', 120_000);
```

## Listings

`Listing.define()` says what clients may filter and sort a listing by, and how it pages. `Listing.parse()` validates the query string, and a repository's `list()` runs it:

```ts
import { Listing } from '@elysiumjs/mnemosyne';

const PostListing = Listing.define(Post, {
	filters: { status: ['eq', 'in'], title: ['contains'] },
	sort: ['createdAt', 'title'],
	defaultSort: '-createdAt'
});

@Http.get('/', { response: Listing.pageSchema(PostResource) })
public list(@Http.query(Listing.schema(PostListing)) query: Listing.Params<typeof PostListing>) {
	return this.posts.list(Listing.parse(PostListing, query));
}
```

- Cursor pagination is the default: `cursor` points after the last row of the previous page, and a page gives `{ data, nextCursor }`. Pages stay stable while rows are added, and each costs the same.
- `pagination: 'offset'` numbers the pages from 1 with `page`, and a page gives `{ data, page, limit, total }`, the total counting the rows the filters match. It suits tables that jump to a page.
- `Listing.pageSchema(item)` and `Listing.offsetPageSchema(item)` describe the pages. `Listing.page()` and `Listing.offsetPage()` build them, `Listing.mapPage(page, map)` maps their rows, such as models to resources, and `Listing.filterPage(page, keep)` keeps the rows that pass a predicate.
- Pages and their schemas are marked, so that an interceptor can render them on its own: `Listing.isPage(value)` and `Listing.paginationOf(page)` read a page, `Listing.pageSchemaPagination(schema)` and `Listing.itemSchemaOf(schema)` read a page schema.

Models and repositories are built with a driver package. See [`@elysiumjs/mnemosyne-drizzle`](../mnemosyne-drizzle/README.md).

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
