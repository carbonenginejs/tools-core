import assert from "node:assert/strict";
import test from "node:test";

import { CjsRealtimeHub } from "../../src/realtime/server/CjsRealtimeHub.js";
import { CjsRealtimeServiceRegistry } from "../../src/realtime/server/CjsRealtimeServiceRegistry.js";
import { CjsRealtimeSessionAuthority } from "../../src/realtime/server/CjsRealtimeSessionAuthority.js";
import {
    CjsRealtimeMemoryTransport,
    CjsRealtimeSyntheticService,
    CjsRealtimeTestSupport,
} from "./CjsRealtimeTestSupport.js";

test("broadcasts future events with global and per-topic ordering", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();

    context.after(() => harness.hub.Stop());
    await harness.service.Emit("synthetic.state.changed", { value: 0 });
    const first = await CjsRealtimeTestSupport.connect(harness);
    const second = await CjsRealtimeTestSupport.connect(harness);
    const subscribe = connection => connection.ReceiveText(JSON.stringify({
        type: "subscribe",
        requestId: "subscribe-1",
        serviceId: "synthetic-main",
        topics: [ "synthetic.state.changed" ],
    }));

    await Promise.all([ subscribe(first.connection), subscribe(second.connection) ]);
    await Promise.all([ first.connection.Drain(), second.connection.Drain() ]);
    const firstResult = first.transport.messages.at(-1);

    assert.equal(firstResult.type, "result");
    assert.deepEqual(firstResult.data.cursor.topicSequences, {
        "synthetic.state.changed": 1,
        "synthetic.audit.received": 0,
    });
    assert.equal(first.transport.messages.some(message => message.type === "event"), false);

    await harness.service.Emit("synthetic.audit.received", { ignored: true });
    await harness.service.Emit("synthetic.state.changed", { value: 1 });
    await Promise.all([ first.connection.Drain(), second.connection.Drain() ]);
    const firstEvent = first.transport.messages.find(message => message.type === "event");
    const secondEvent = second.transport.messages.find(message => message.type === "event");

    assert.equal(firstEvent.sequence, 3);
    assert.equal(firstEvent.topicSequence, 2);
    assert.equal(firstEvent.subscriptionId, firstResult.data.subscriptionId);
    assert.deepEqual(secondEvent.payload.data, { value: 1 });

    const session = harness.authority.Authenticate(harness.capability, {
        origin: harness.origin,
    });
    const snapshot = await harness.hub.GetSnapshot(session, "synthetic-main");

    assert.deepEqual(snapshot.payload.data, { value: 0 });
    assert.equal(snapshot.cursor.sequence, 3);
    assert.equal(snapshot.cursor.topicSequences["synthetic.audit.received"], 1);
});

test("places subscribe and unsubscribe results on publication barriers", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const { connection, transport } = await CjsRealtimeTestSupport.connect(harness);

    context.after(() => harness.hub.Stop());
    await connection.ReceiveText(JSON.stringify({
        type: "subscribe",
        requestId: "subscribe-1",
        serviceId: "synthetic-main",
        topics: [ "synthetic.state.changed" ],
    }));
    await harness.service.Emit("synthetic.state.changed", { order: 1 });
    await connection.Drain();
    const subscribeIndex = transport.messages.findIndex(message =>
        message.requestId === "subscribe-1");
    const eventIndex = transport.messages.findIndex(message => message.type === "event");
    const subscriptionId = transport.messages[subscribeIndex].data.subscriptionId;

    assert.ok(subscribeIndex < eventIndex);
    await connection.ReceiveText(JSON.stringify({
        type: "unsubscribe",
        requestId: "unsubscribe-1",
        subscriptionId,
    }));
    await harness.service.Emit("synthetic.state.changed", { order: 2 });
    await connection.Drain();
    const unsubscribeIndex = transport.messages.findIndex(message =>
        message.requestId === "unsubscribe-1");
    const laterEvents = transport.messages.slice(unsubscribeIndex + 1)
        .filter(message => message.type === "event");

    assert.equal(laterEvents.length, 0);
});

test("commits source state and its event under the snapshot publication lane", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const session = harness.authority.Authenticate(harness.capability, {
        origin: harness.origin,
    });

    context.after(() => harness.hub.Stop());
    await harness.service.CommitValue(17);
    const snapshot = await harness.hub.GetSnapshot(session, "synthetic-main");

    assert.deepEqual(snapshot.payload.data, { value: 17 });
    assert.equal(snapshot.cursor.sequence, 1);
    assert.equal(snapshot.cursor.topicSequences["synthetic.state.changed"], 1);
});

test("orders concurrent source commits and snapshots in both enqueue orders", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const session = harness.authority.Authenticate(harness.capability, {
        origin: harness.origin,
    });

    context.after(() => harness.hub.Stop());
    harness.service.BlockCommits();
    const commitFirst = harness.service.CommitValue(21);

    await Promise.resolve();
    const snapshotAfterCommit = harness.hub.GetSnapshot(session, "synthetic-main");

    harness.service.ReleaseCommits();
    await commitFirst;
    const committedSnapshot = await snapshotAfterCommit;

    assert.deepEqual(committedSnapshot.payload.data, { value: 21 });
    assert.equal(committedSnapshot.cursor.sequence, 1);

    harness.service.BlockSnapshots();
    const snapshotFirst = harness.hub.GetSnapshot(session, "synthetic-main");

    await Promise.resolve();
    const commitAfterSnapshot = harness.service.CommitValue(22);

    harness.service.ReleaseSnapshots();
    const earlierSnapshot = await snapshotFirst;

    await commitAfterSnapshot;
    assert.deepEqual(earlierSnapshot.payload.data, { value: 21 });
    assert.equal(earlierSnapshot.cursor.sequence, 1);
    const latestSnapshot = await harness.hub.GetSnapshot(session, "synthetic-main");

    assert.deepEqual(latestSnapshot.payload.data, { value: 22 });
    assert.equal(latestSnapshot.cursor.sequence, 2);
});

test("deduplicates operations by actor, service, action, and operation ID", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const first = await CjsRealtimeTestSupport.connect(harness);
    const second = await CjsRealtimeTestSupport.connect(harness);

    context.after(() => harness.hub.Stop());
    const send = (connection, requestId, value) => connection.ReceiveText(JSON.stringify({
        type: "command",
        requestId,
        serviceId: "synthetic-main",
        action: "set",
        operationId: "turn-42",
        data: { value },
    }));

    await send(first.connection, "command-1", 42);
    await send(second.connection, "command-2", 42);
    await Promise.all([ first.connection.Drain(), second.connection.Drain() ]);

    assert.equal(harness.service.commandCount, 1);
    assert.deepEqual(first.transport.messages.at(-1).data, { value: 42 });
    assert.deepEqual(second.transport.messages.at(-1).data, { value: 42 });

    await send(first.connection, "command-3", 43);
    await first.connection.Drain();
    assert.equal(first.transport.messages.at(-1).code, "operation_conflict");
    assert.equal(harness.service.commandCount, 1);

    const other = await CjsRealtimeTestSupport.connect(harness, {
        capability: harness.otherCapability,
    });

    await send(other.connection, "command-4", 43);
    await other.connection.Drain();
    assert.equal(harness.service.commandCount, 2);
    assert.deepEqual(other.transport.messages.at(-1).data, { value: 43 });
});

test("allows declared read-only commands without an operation ID", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const { connection, transport } = await CjsRealtimeTestSupport.connect(harness);

    context.after(() => harness.hub.Stop());
    await connection.ReceiveText(JSON.stringify({
        type: "command",
        requestId: "inspect-1",
        serviceId: "synthetic-main",
        action: "inspect",
        data: null,
    }));
    await connection.Drain();

    assert.deepEqual(transport.messages.at(-1), {
        type: "result",
        requestId: "inspect-1",
        status: "completed",
        data: { value: 0 },
    });
});

test("routes accepted deferred work back through Commit and expires inline Publish", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const { connection, transport } = await CjsRealtimeTestSupport.connect(harness);

    context.after(() => harness.hub.Stop());
    await connection.ReceiveText(JSON.stringify({
        type: "command",
        requestId: "defer-1",
        serviceId: "synthetic-main",
        action: "defer",
        operationId: "deferred-operation",
        data: null,
    }));
    await connection.Drain();
    assert.equal(transport.messages.at(-1).status, "accepted");
    await assert.rejects(
        harness.service.PublishDeferredValue(5),
        error => error.code === "context_expired",
    );
    await harness.service.CommitDeferredValue(5);
    const session = harness.authority.Authenticate(harness.capability, {
        origin: harness.origin,
    });
    const snapshot = await harness.hub.GetSnapshot(session, "synthetic-main");

    assert.deepEqual(snapshot.payload.data, { value: 5 });
    assert.equal(snapshot.cursor.sequence, 1);
});

test("retries retryable operation failures but retains definitive rejections", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const { connection, transport } = await CjsRealtimeTestSupport.connect(harness);
    const send = (requestId, action, operationId) => connection.ReceiveText(JSON.stringify({
        type: "command",
        requestId,
        serviceId: "synthetic-main",
        action,
        operationId,
        data: { value: 1 },
    }));

    context.after(() => harness.hub.Stop());
    await send("transient-1", "transient", "transient-operation");
    await send("transient-2", "transient", "transient-operation");
    await connection.Drain();
    assert.equal(transport.messages.find(message => message.requestId === "transient-1").code,
        "service_unavailable");
    assert.equal(transport.messages.find(message => message.requestId === "transient-2").status,
        "accepted");
    const countAfterRetry = harness.service.commandCount;

    await send("reject-1", "reject", "rejected-operation");
    await send("reject-2", "reject", "rejected-operation");
    await connection.Drain();
    assert.equal(harness.service.commandCount, countAfterRetry + 1);
    assert.equal(transport.messages.find(message => message.requestId === "reject-2").code,
        "synthetic_rejected");
});

test("observes unawaited nested Commit failures as the command error", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const { connection, transport } = await CjsRealtimeTestSupport.connect(harness);

    context.after(() => harness.hub.Stop());
    await connection.ReceiveText(JSON.stringify({
        type: "command",
        requestId: "nested-1",
        serviceId: "synthetic-main",
        action: "nestedReject",
        operationId: "nested-operation",
        data: null,
    }));
    await connection.Drain();

    assert.equal(transport.messages.at(-1).type, "error");
    assert.equal(transport.messages.at(-1).code, "nested_rejected");
});

test("isolates a failed service start and rejects its work", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness({ failStart: true });
    const runtime = harness.hub.ListRuntimeServices();

    context.after(() => harness.hub.Stop());
    assert.equal(harness.hub.status, "running");
    assert.equal(runtime[0].status, "failed");
    const session = harness.authority.Authenticate(harness.capability, {
        origin: harness.origin,
    });

    await assert.rejects(
        harness.hub.GetSnapshot(session, "synthetic-main"),
        error => error.code === "service_unavailable",
    );
});

test("closes unauthorized, binary, and slow-consumer connections safely", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness({
        limits: {
            maxOutboundMessages: 2,
            maxOutboundBytes: 1024 * 1024,
        },
    });

    context.after(() => harness.hub.Stop());
    const unauthorizedTransport = new CjsRealtimeMemoryTransport();
    const unauthorized = harness.hub.OpenConnection({
        transport: unauthorizedTransport,
        origin: "http://127.0.0.1:8081",
    });

    await unauthorized.ReceiveText(JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        capability: harness.capability,
    }));
    assert.deepEqual(unauthorizedTransport.closes, [ {
        code: 1008,
        reason: "unauthorized",
    } ]);

    const binaryTransport = new CjsRealtimeMemoryTransport();
    const binary = harness.hub.OpenConnection({
        transport: binaryTransport,
        origin: harness.origin,
    });

    binary.RejectBinary();
    assert.equal(binaryTransport.closes[0].code, 1003);

    const blockedTransport = new CjsRealtimeMemoryTransport();
    const slow = await CjsRealtimeTestSupport.connect(harness, {
        transport: blockedTransport,
    });

    blockedTransport.Block();
    await slow.connection.ReceiveText(JSON.stringify({
        type: "subscribe",
        requestId: "subscribe-slow",
        serviceId: "synthetic-main",
        topics: [ "synthetic.state.changed" ],
    }));
    await harness.service.Emit("synthetic.state.changed", { value: 1 });
    await harness.service.Emit("synthetic.state.changed", { value: 2 });
    assert.equal(blockedTransport.closes.at(-1).code, 4409);
    assert.equal(blockedTransport.closes.at(-1).reason, "resync_required");
});

test("bounds queued inbound and cross-connection service work", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness({
        limits: {
            maxInboundMessages: 2,
            maxInboundBytes: 1024 * 1024,
            maxServiceQueue: 1,
        },
    });
    const first = await CjsRealtimeTestSupport.connect(harness);
    const second = await CjsRealtimeTestSupport.connect(harness);

    context.after(() => harness.hub.Stop());
    harness.service.BlockCommands();
    const command = (connection, requestId) => connection.ReceiveText(JSON.stringify({
        type: "command",
        requestId,
        serviceId: "synthetic-main",
        action: "set",
        operationId: requestId,
        data: { value: 1 },
    }));
    const firstWork = command(first.connection, "bounded-1");

    await Promise.resolve();
    await command(second.connection, "bounded-2");
    await second.connection.Drain();
    assert.equal(second.transport.messages.at(-1).code, "queue_full");

    const queued = command(first.connection, "bounded-3");
    const overflow = command(first.connection, "bounded-4");

    assert.equal(first.transport.closes.at(-1).code, 1008);
    assert.equal(first.transport.closes.at(-1).reason, "rate_limited");
    harness.service.ReleaseCommands();
    await Promise.allSettled([ firstWork, queued, overflow ]);
});

test("revocation closes an established subscriber before further delivery", async context =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const { connection, transport } = await CjsRealtimeTestSupport.connect(harness);

    context.after(() => harness.hub.Stop());
    await connection.ReceiveText(JSON.stringify({
        type: "subscribe",
        requestId: "subscribe-revoked",
        serviceId: "synthetic-main",
        topics: [ "synthetic.state.changed" ],
    }));
    await connection.Drain();
    harness.authority.RevokeCapability(harness.capability);
    await harness.service.Emit("synthetic.state.changed", { value: 1 });

    assert.equal(transport.closes.at(-1).code, 1008);
    assert.equal(transport.messages.filter(message => message.type === "event").length, 0);
});

test("starts services supplied through a pre-populated registry", async context =>
{
    const service = new CjsRealtimeSyntheticService();
    const registry = new CjsRealtimeServiceRegistry();
    const capability = CjsRealtimeSessionAuthority.createCapability();
    const authority = new CjsRealtimeSessionAuthority({
        grants: [ {
            capability,
            actor: { id: "agent-one", kind: "agent" },
            allowedOrigins: [],
            allowMissingOrigin: true,
            scopes: { discover: true, services: {} },
        } ],
    });

    registry.Register(service);
    const hub = new CjsRealtimeHub({ authority, registry });

    context.after(() => hub.Stop());
    await hub.Start();
    assert.equal(service.startCount, 1);
    assert.equal(hub.ListRuntimeServices()[0].id, "synthetic-main");
});

test("aborts admitted work during Stop and rejects stale contexts after restart", async () =>
{
    const harness = await CjsRealtimeTestSupport.createHarness();
    const { connection } = await CjsRealtimeTestSupport.connect(harness);
    const staleContext = harness.service.context;
    const command = connection.ReceiveText(JSON.stringify({
        type: "command",
        requestId: "abort-1",
        serviceId: "synthetic-main",
        action: "waitForAbort",
        operationId: "abort-operation",
        data: null,
    }));

    await Promise.resolve();
    await harness.hub.Stop();
    await command;
    await harness.hub.Start();
    await assert.rejects(
        staleContext.Publish("synthetic.state.changed", { stale: true }),
        error => error.code === "stream_changed",
    );
    assert.equal(harness.hub.ListRuntimeServices()[0].cursor.sequence, 0);
    await harness.hub.Stop();
});
