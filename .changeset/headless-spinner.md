---
'@elysiumjs/core': patch
---

Command spinners and progress bars write plain lines when the runtime has no terminal, such as the workers runtime, instead of throwing `RuntimeNotSupportedError`. Prompts still throw.
