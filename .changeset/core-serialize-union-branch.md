---
'@elysiumjs/core': patch
---

`Resource.serialize` serializes an object through the union branch it belongs to: the first object branch whose required properties it has and whose literals it matches, keeping the most of its properties. It used to take the first object branch, which stripped the fields of the others.
