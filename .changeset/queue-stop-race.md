---
'@elysiumjs/heracles': patch
---

A queue started while it is being stopped now starts its transport again once the stop finishes, instead of ending up stopped.
