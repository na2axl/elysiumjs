---
'@elysiumjs/argus': patch
'@elysiumjs/bun': patch
'@elysiumjs/drizzle': patch
'@elysiumjs/hephaestus': patch
'@elysiumjs/node': patch
'@elysiumjs/olympus': patch
'@elysiumjs/pino': patch
'@elysiumjs/plugin-sentry': patch
'@elysiumjs/redis': patch
'@elysiumjs/styx': patch
'@elysiumjs/workers': patch
---

The published declarations resolve under `moduleResolution: node16` and `nodenext`: their relative imports carry the `.js` extension, so the exported types no longer become `any` in those projects.
