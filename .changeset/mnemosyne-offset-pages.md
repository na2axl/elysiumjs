---
'@elysiumjs/mnemosyne': minor
'@elysiumjs/mnemosyne-drizzle': minor
---

Listings page by offset too: `pagination: 'offset'` on a query spec reads `page` instead of `cursor`, and `list()` gives `{ data, page, limit, total }`. `Query.offsetPage()`, `Query.offsetPageSchema()` and `Query.mapPage()` are new. Pages and page schemas are marked so that interceptors can render them (`Query.isPage()`, `Query.paginationOf()`, `Query.pageSchemaPagination()`, `Query.itemSchemaOf()`). `paginate()` of repositories is deprecated.
