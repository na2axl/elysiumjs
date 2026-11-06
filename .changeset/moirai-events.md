---
'@elysiumjs/moirai': minor
---

Domain events. `Event.publish(event, payload)` publishes an event in the open unit of work, and each `@Event.on(event, { consumer, retry })` handler gets it once that unit commits: through its own outbox row, so that it retries and dies on its own, and once, through an inbox record named by its consumer. `EventCatalogue` types the names and payloads, and `EventMeta` gives handlers the id, name, publication date and attempt.

`registerEffect()` takes the attempts of a row, and the memory outbox and inbox stores drop what a unit of work that rolls back wrote.
