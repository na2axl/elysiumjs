---
'@elysiumjs/core': minor
---

Routes take a `parse` option: how the request body is parsed before the handler runs (`none`, `text`, `json`, `formdata`, `urlencoded` or `arrayBuffer`). By default it follows the request's `Content-Type`. `parse: 'none'` leaves the body unread, so the handler reads it from the request, such as to check a webhook signature over the exact bytes. A route with `parse: 'none'` cannot take `@Http.body()`: mounting it throws.
