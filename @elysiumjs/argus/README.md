# @elysiumjs/argus

OpenTelemetry tracing for Elysium.

## ArgusModule and preloading

`ArgusModule.with({ serviceName: 'my-api' })` starts the SDK in `onInit` and installs request spans on the root app. OTel auto-instrumentation only covers modules loaded after `onInit`.

For full auto-instrumentation, keep a preload file that calls `ArgusSDK.initialize(...)` before application code is imported. The module detects the already-initialised SDK, leaves it running and does not shut it down.
