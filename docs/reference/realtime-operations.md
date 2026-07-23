# Realtime operations

Status: Evolving  
Scope: Future provider mutation adapters over Carbon tools realtime protocol v1  
Audience: Integration authors and application architects  
Summary: Records the minimal planned shape for posting, editing, deleting, reactions, and moderation.

## Current boundary

Protocol v1 already carries authenticated commands with a service, action,
request ID, optional operation ID, and JSON data. Tools-core currently ships
receive-side Twitch/Kick integrations; it does not implement provider posting
or moderation adapters.

Provider writes remain opt-in capabilities. Adding one must not turn a
receive-only source into an implicitly privileged client.

## Planned action families

| Action | Purpose | Typical required identity |
| --- | --- | --- |
| `message.post` | Post one message | destination channel, body |
| `message.edit` | Replace an authored message | channel and message ID |
| `message.delete` | Remove one message | channel and message ID |
| `reaction.add` | Add one reaction | channel, message ID, reaction |
| `reaction.remove` | Remove one reaction | channel, message ID, reaction |
| `moderation.timeout` | Temporarily restrict an actor | channel, actor, duration, reason |
| `moderation.ban` | Ban an actor | channel, actor, optional reason |
| `moderation.unban` | Remove a ban | channel and actor |
| `moderation.delete` | Moderator removal of content | channel and message ID |

Names remain provisional until the first provider adapter proves the common
shape. Provider-only capabilities stay behind provider-specific actions rather
than expanding the canonical contract prematurely.

## Common requirements

Every mutating adapter must:

- declare exact action scopes in the server-owned capability grant;
- require an operation ID for idempotency;
- retain provider, account/container, channel, target, and actor identity;
- validate content and limits before contacting the provider;
- return a canonical accepted/rejected result without reflecting credentials;
- publish the resulting canonical event only after provider acceptance;
- distinguish retryable transport/rate failures from definitive policy
  rejection;
- preserve provider receipts and diagnostics only in sanitized extensions.

Edits and deletes refer to stable message IDs, never message text. Reactions
identify the exact provider reaction representation. Moderation requires
separate scopes from ordinary posting.

## Provider capability discovery

Logical services should describe supported actions so clients do not infer
writes from the provider name. An aggregate read service may remain entirely
read-only while one exact-channel service exposes a narrow posting adapter.

This document is a reviewed roadmap, not an available API. Implemented action
names and payloads must be added to executable fixtures before they become a
stable contract.
