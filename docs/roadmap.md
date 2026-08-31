# Tools-core roadmap

Status: Evolving  
Scope: `@carbonenginejs/tools-core`  
Audience: Maintainers and application integrators  
Summary: Records the remaining hardening work for long-lived local services and generated artifacts.

## Current baseline

Tools-core serves an unauthenticated loopback query/resource proxy. The realtime
host that used to sit beside it - with its provider integrations and webhook
ingress - now lives in the demos package, which owns both halves of that
protocol under the `TnyRealtime` names.

Remote index requests use bounded fetches and package output excludes generated
Carbon scan reports.

## Planned hardening

### Protect the legacy local proxy

`CjsToolHttpProxy` is loopback-only, but it still emits wildcard CORS and
private-network permission headers without a capability check. Migrate browser
consumers to an exact-origin or capability boundary with request admission and
rate limits. Do not add write-capable routes to the legacy surface.

### Bound lifecycle and command work

Apply default deadlines and propagated cancellation to service start/stop,
commands, SDE acquisition, and HTTP admission. When cancellation cannot prove
whether an external side effect occurred, operation results need an explicit
indeterminate outcome rather than reporting success or safe failure.

### Isolate resource-watch scans

Filesystem reconciliation currently scans inside the serialized service commit
lane. Scan outside that lane with a generation token, then compare and publish
the accepted result atomically. Preserve the existing bounded collapse to a
full reconciliation when too many paths are pending.

Resource opening also needs either descriptor-based containment checks where
the platform supports them or an explicit trusted-root deployment contract.
The current size-and-modification-time revision is a precondition checked at
open time, not immutable content identity.

### Complete long-lived host seams

Add a structured, secret-safe observer for lifecycle, reconnect, pressure, and
provider failures. Validate the injected operation store's required methods and
define its lifecycle. Prune expired capability grants and keep build-keyed
proxy caches explicitly bounded.

### Publish related artifacts atomically

Generated JSON and gzip siblings are individually replaced. A crash between
those replacements can expose a mismatched pair. Publish a staged,
version-addressed directory and switch one manifest pointer atomically after
every member is durable.

## Realtime moved out

The realtime services, their provider integrations and the webhook ingress now
live in the demos package, which owns both halves of that protocol - the server
and the browser client - under the `TnyRealtime` names. This package no longer
hosts, documents or tests them.
