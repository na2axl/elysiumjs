---
'@elysiumjs/core': patch
---

The OpenAPI page is served on Cloudflare Workers when the app is compiled ahead of time: on the Workers runtime the page embeds the spec, so the route compiled by the build matches the one workerd mounts.
