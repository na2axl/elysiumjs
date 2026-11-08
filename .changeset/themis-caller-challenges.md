---
'@elysiumjs/themis': minor
---

`Passkeys` takes `challenges: 'caller'` to leave the challenges to the app, such as in the state of a multi-step flow: `verifyRegistration` and `verifyAuthentication` then take the challenge (and the user) as a second argument. `verifyAuthentication` refuses a passkey of another user than the one given, and `PasskeyRepository.updateCounter` receives the previous counter and may answer `false` to refuse a sign-in that lost a race. `BackupCodes.generate` and `consume` take a `secret` to hash the codes with HMAC, and `consume` answers the hash it used. `Passkeys` also takes `residentKey` and `timeout`, and refuses an assertion whose user handle is another user's than the passkey's.
