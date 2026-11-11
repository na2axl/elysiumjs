# @elysiumjs/mnemosyne

Database abstractions and caching for Elysium.js applications.

## Installation

```bash
bun add @elysiumjs/mnemosyne
```

## Usage

`MnemosyneModule` provides the caches (`Cache.redis` and `Cache.memory`) and the `db:seed` command. Database driver modules such as `DrizzleModule` from `@elysiumjs/mnemosyne-drizzle` import it for you, so you only add it yourself when you want to configure the caches or use them without a database:

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

## Seeders

A seeder writes the rows an application needs to run, such as reference data. List it in the `seeders` of a module, and `styx db:seed` runs it inside that module, so its `run` method takes the module's services, in a transaction of its own:

```ts
import { Service } from '@elysiumjs/core';
import { Seeder } from '@elysiumjs/mnemosyne';

@Seeder.register()
export class CountriesSeeder extends Seeder {
	protected async run(@Service.inject() countries: CountryRepository): Promise<void> {
		await countries.upsertMany(await readCountries());
	}
}

@Seeder.register({ after: [CountriesSeeder], manual: true })
export class CitiesSeeder extends Seeder {
	protected async run(@Service.inject() cities: CityRepository): Promise<void> {
		await cities.upsertMany(await readCities(this.input.file));
	}
}

@Module.register({ services: [CountryRepository, CityRepository], seeders: [CountriesSeeder, CitiesSeeder] })
export class GeoModule extends Module {}
```

```bash
styx db:seed                                  # every seeder that is not manual
styx db:seed --only geo.cities --file cities.zip
styx db:seed --arg region=africa --list       # prints the order, runs nothing
```

- Seeders run on every call, so write them as upserts.
- A seeder is named after its module and class, without the `Module` and `Seeder` suffixes, in kebab case (`geo.cities` above). `name` sets another one.
- `after` lists the seeder classes that run first when both run. It sets an order and does not add them: `--only geo.cities` runs `geo.cities` alone. Give a function, `after: () => [CountriesSeeder]`, when an import cycle leaves the class undefined.
- `manual: true` seeders run only when `--only` names them. `env` limits a seeder to some environments, and `connection` picks the connection of its transaction.
- `--file` and the `--arg key=value` pairs reach the seeders as `this.input.file` and `this.input.args`.
- `styx make:seeder --name CountriesSeeder --module geo` writes `seeders/countries.seeder.ts`.

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
