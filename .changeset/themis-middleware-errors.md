---
'@elysiumjs/themis': patch
---

`AuthMiddleware` and `CsrfMiddleware` list their problems, so the routes they guard document 401 `UNAUTHENTICATED` and 403 `CSRF_TOKEN_MISMATCH`.
