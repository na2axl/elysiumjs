---
'@elysiumjs/olympus': minor
'@elysiumjs/styx': minor
---

Views show resources on the wire. `View(schema)` makes a static-only class with a schema and a static `render`, and `renderAll` and `renderPage` built on it. A route answers with a view by naming it as its `response`: `PostView` for one item, `PostView.list` for a list and `PostView.page` for a page, whose pagination is read from the route's query schema (either kind when it gives none). Routes with a view that cannot render, that send events or that skip serialization are refused when declared. `ViewOutput<S>` takes dates where the schema has strings, written as ISO strings. `styx make:view` writes a new view, and `styx routes:generate` types the routes rendered by a view with the schema of the view.
