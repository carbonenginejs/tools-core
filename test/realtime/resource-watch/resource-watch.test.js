import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsRealtimeResourceWatchService } from "@carbonenginejs/tools-core/realtime/resource-watch";

import { CjsRealtimeHub } from "../../../src/realtime/server/CjsRealtimeHub.js";
import {
    CjsRealtimeSessionAuthority,
} from "../../../src/realtime/server/CjsRealtimeSessionAuthority.js";
import {
    CjsRealtimeMemoryTransport,
} from "../CjsRealtimeTestSupport.js";

const ENTRY_TOPIC = "resource.watch.entry.changed";
const STATUS_TOPIC = "resource.watch.status.changed";

/** Deterministic injected observer for resource-watch family tests. */
class CjsRealtimeManualObserver
{

    constructor()
    {
        this.closed = false;
        this.options = null;
    }

    /** Captures one service observation registration. */
    Observe(options)
    {
        this.closed = false;
        this.options = options;

        return this;
    }

    /** Delivers one logical filesystem change. */
    Emit(resourcePath, occurredAt = Date.now())
    {
        this.options.onChange({ path: resourcePath, occurredAt });
    }

    /** Delivers one provider failure without exposing its details. */
    Fail()
    {
        this.options.onError(new Error("private provider failure"));
    }

    /** Records observer shutdown. */
    Close()
    {
        this.closed = true;
    }

}

/** Shared filesystem and authenticated-hub helpers for resource-watch tests. */
class CjsResourceWatchTestSupport
{

    /** Creates a disposable physical root. */
    static async createRoot(testContext)
    {
        const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cjs-resource-watch-"));

        testContext.after(() => fs.promises.rm(root, { recursive: true, force: true }));

        return root;
    }

    /** Creates an authenticated hub around one injected resource-watch service. */
    static createHarness(root, options = {})
    {
        const capability = CjsRealtimeSessionAuthority.createCapability();
        const origin = "http://127.0.0.1:8090";
        const observer = options.observer ?? new CjsRealtimeManualObserver();
        const service = new CjsRealtimeResourceWatchService({
            id: "resources-main",
            root,
            logicalRoot: "res:/",
            observe: value => observer.Observe(value),
            settleMs: 0,
            ...options.service,
        });
        const authority = new CjsRealtimeSessionAuthority({
            grants: [ {
                capability,
                actor: { id: "resource-consumer", kind: "test" },
                allowedOrigins: [ origin ],
                scopes: {
                    discover: true,
                    services: {
                        "resources-main": {
                            topics: [ ENTRY_TOPIC, STATUS_TOPIC ],
                            commands: [],
                            snapshots: true,
                            content: true,
                        },
                    },
                },
            } ],
        });
        let nextId = 0;
        const hub = new CjsRealtimeHub({
            authority,
            createId: prefix => `${prefix}-${++nextId}`,
        });

        hub.Register(service);

        return { hub, service, authority, capability, origin, observer };
    }

    /** Authenticates the configured non-persisted capability. */
    static session(harness)
    {
        return harness.authority.Authenticate(harness.capability, {
            origin: harness.origin,
        });
    }

    /** Opens and authenticates an in-memory protocol connection. */
    static async connect(harness)
    {
        const transport = new CjsRealtimeMemoryTransport();
        const connection = harness.hub.OpenConnection({
            transport,
            origin: harness.origin,
        });

        await connection.ReceiveText(JSON.stringify({
            type: "hello",
            protocolVersion: 1,
            capability: harness.capability,
        }));
        await connection.Drain();

        return { connection, transport };
    }

    /** Waits for one asynchronous observation condition with a short bound. */
    static async waitFor(callback, timeoutMs = 1000)
    {
        const startedAt = Date.now();

        while (!callback())
        {
            if (Date.now() - startedAt >= timeoutMs)
            {
                throw new Error("Timed out waiting for resource watch condition");
            }

            await new Promise(resolve => setTimeout(resolve, 5));
        }
    }

    /** Reads one opened resource stream into UTF-8 text. */
    static async readText(resource)
    {
        const chunks = [];

        for await (const chunk of resource.body)
        {
            chunks.push(chunk);
        }

        return Buffer.concat(chunks).toString("utf8");
    }

}

test("exports a provider-neutral resource.watch family with safe snapshot content", async context =>
{
    const root = await CjsResourceWatchTestSupport.createRoot(context);

    await fs.promises.mkdir(path.join(root, "nested"));
    await fs.promises.writeFile(path.join(root, "nested", "state.json"), "{\"value\":1}");
    const harness = CjsResourceWatchTestSupport.createHarness(root);

    context.after(() => harness.hub.Stop());
    await harness.hub.Start();
    const session = CjsResourceWatchTestSupport.session(harness);
    const snapshot = await harness.hub.GetSnapshot(session, "resources-main");

    assert.equal(snapshot.payload.schema, "resource.watch.snapshot");
    assert.equal(snapshot.payload.data.logicalRoot, "res:/");
    assert.equal(snapshot.payload.data.status.state, "ready");
    assert.deepEqual(snapshot.payload.data.entries.map(entry => entry.path), [
        "nested/state.json",
    ]);
    const entry = snapshot.payload.data.entries[0];

    assert.equal(entry.type, "file");
    assert.equal(entry.contentRef.startsWith(
        "/v1/realtime/services/resources-main/content/nested/state.json?revision=",
    ), true);
    assert.equal(JSON.stringify(snapshot).includes(root), false);
    const resource = await harness.hub.OpenResource(
        session,
        "resources-main",
        entry.path,
        { method: "GET", revision: entry.revision },
    );

    assert.equal(resource.contentType, "application/json; charset=utf-8");
    assert.equal(await CjsResourceWatchTestSupport.readText(resource), "{\"value\":1}");
    const head = await harness.hub.OpenResource(
        session,
        "resources-main",
        entry.path,
        { method: "HEAD", revision: entry.revision },
    );

    assert.equal(head.body, undefined);
    assert.equal(head.contentLength, 11);
    await assert.rejects(
        harness.hub.OpenResource(
            session,
            "resources-main",
            "../private.txt",
            { method: "GET", revision: entry.revision },
        ),
        error => error.code === "invalid_path",
    );
});

test("coalesces changes and publishes deterministic add, update, and remove events", async context =>
{
    const root = await CjsResourceWatchTestSupport.createRoot(context);

    await fs.promises.writeFile(path.join(root, "alpha.txt"), "one");
    const harness = CjsResourceWatchTestSupport.createHarness(root);

    context.after(() => harness.hub.Stop());
    await harness.hub.Start();
    const { connection, transport } = await CjsResourceWatchTestSupport.connect(harness);

    await connection.ReceiveText(JSON.stringify({
        type: "subscribe",
        requestId: "resource-subscribe",
        serviceId: "resources-main",
        topics: [ ENTRY_TOPIC ],
    }));
    await connection.Drain();
    await fs.promises.writeFile(path.join(root, "alpha.txt"), "updated-value");
    harness.observer.Emit("alpha.txt", 1000);
    harness.observer.Emit("alpha.txt", 1001);
    await CjsResourceWatchTestSupport.waitFor(() =>
        transport.messages.filter(message => message.type === "event").length === 1);
    await fs.promises.writeFile(path.join(root, "beta.txt"), "two");
    harness.observer.Emit("beta.txt", 1002);
    await CjsResourceWatchTestSupport.waitFor(() =>
        transport.messages.filter(message => message.type === "event").length === 2);
    await fs.promises.rm(path.join(root, "alpha.txt"));
    harness.observer.Emit("alpha.txt", 1003);
    await CjsResourceWatchTestSupport.waitFor(() =>
        transport.messages.filter(message => message.type === "event").length === 3);
    const events = transport.messages.filter(message => message.type === "event");

    assert.deepEqual(events.map(event => event.payload.data.operation), [
        "update",
        "add",
        "remove",
    ]);
    assert.deepEqual(events.map(event => event.payload.data.path), [
        "alpha.txt",
        "beta.txt",
        "alpha.txt",
    ]);
    assert.deepEqual(events.map(event => event.topicSequence), [ 1, 2, 3 ]);
    assert.equal(events[2].payload.data.entry, null);
    const snapshot = await harness.hub.GetSnapshot(
        CjsResourceWatchTestSupport.session(harness),
        "resources-main",
    );

    assert.deepEqual(snapshot.payload.data.entries.map(entry => entry.path), [ "beta.txt" ]);
});

test("reconciles an observation captured while the initial scan is in progress", async context =>
{
    const root = await CjsResourceWatchTestSupport.createRoot(context);

    await fs.promises.writeFile(path.join(root, "initial.txt"), "initial");
    let releaseScan;
    let scanEntered;
    const scanGate = new Promise(resolve =>
    {
        releaseScan = resolve;
    });
    const entered = new Promise(resolve =>
    {
        scanEntered = resolve;
    });
    let firstRead = true;
    const filesystem = {
        ...fs,
        promises: {
            ...fs.promises,
            readdir: async (...args) =>
            {
                const entries = await fs.promises.readdir(...args);

                if (firstRead)
                {
                    firstRead = false;
                    scanEntered();
                    await scanGate;
                }

                return entries;
            },
        },
    };
    const harness = CjsResourceWatchTestSupport.createHarness(root, {
        service: { filesystem },
    });

    context.after(() => harness.hub.Stop());
    const start = harness.hub.Start();

    await entered;
    await fs.promises.writeFile(path.join(root, "raced.txt"), "raced");
    harness.observer.Emit("raced.txt", 2000);
    await Promise.resolve().then(releaseScan);
    await start;
    await CjsResourceWatchTestSupport.waitFor(() =>
        harness.hub.ListRuntimeServices()[0].cursor.sequence === 1);
    const snapshot = await harness.hub.GetSnapshot(
        CjsResourceWatchTestSupport.session(harness),
        "resources-main",
    );

    assert.deepEqual(snapshot.payload.data.entries.map(entry => entry.path), [
        "initial.txt",
        "raced.txt",
    ]);
});

test("reports observer degradation and removes a deleted subtree without replay", async context =>
{
    const root = await CjsResourceWatchTestSupport.createRoot(context);

    await fs.promises.mkdir(path.join(root, "nested"));
    await fs.promises.writeFile(path.join(root, "nested", "one.txt"), "one");
    await fs.promises.writeFile(path.join(root, "nested", "two.txt"), "two");
    const harness = CjsResourceWatchTestSupport.createHarness(root);

    context.after(() => harness.hub.Stop());
    await harness.hub.Start();
    const { connection, transport } = await CjsResourceWatchTestSupport.connect(harness);

    await connection.ReceiveText(JSON.stringify({
        type: "subscribe",
        requestId: "resource-status-subscribe",
        serviceId: "resources-main",
        topics: [ ENTRY_TOPIC, STATUS_TOPIC ],
    }));
    await connection.Drain();
    await fs.promises.rm(path.join(root, "nested"), { recursive: true });
    harness.observer.Emit("nested", 3000);
    await CjsResourceWatchTestSupport.waitFor(() =>
        transport.messages.filter(message => message.topic === ENTRY_TOPIC).length === 2);
    harness.observer.Fail();
    await CjsResourceWatchTestSupport.waitFor(() =>
        transport.messages.some(message => message.topic === STATUS_TOPIC));
    const removed = transport.messages.filter(message => message.topic === ENTRY_TOPIC);

    assert.deepEqual(removed.map(event => event.payload.data.path), [
        "nested/one.txt",
        "nested/two.txt",
    ]);
    assert.equal(removed.every(event => event.payload.data.operation === "remove"), true);
    const status = transport.messages.find(message => message.topic === STATUS_TOPIC);

    assert.deepEqual(status.payload.data, {
        state: "degraded",
        reasonCode: "observer_failed",
        retryable: false,
        occurredAt: status.payload.data.occurredAt,
    });
    assert.equal(JSON.stringify(status).includes("private provider failure"), false);
    const snapshot = await harness.hub.GetSnapshot(
        CjsResourceWatchTestSupport.session(harness),
        "resources-main",
    );

    assert.equal(snapshot.payload.data.status.reasonCode, "observer_failed");
});

test("rejects stale revisions and does not catalog symlinked escape paths", async context =>
{
    const root = await CjsResourceWatchTestSupport.createRoot(context);
    const outside = await CjsResourceWatchTestSupport.createRoot(context);

    await fs.promises.writeFile(path.join(root, "mutable.txt"), "one");
    await fs.promises.writeFile(path.join(outside, "secret.txt"), "outside");
    await fs.promises.symlink(outside, path.join(root, "linked"), "junction");
    const harness = CjsResourceWatchTestSupport.createHarness(root);

    context.after(() => harness.hub.Stop());
    await harness.hub.Start();
    const session = CjsResourceWatchTestSupport.session(harness);
    const snapshot = await harness.hub.GetSnapshot(session, "resources-main");
    const entry = snapshot.payload.data.entries.find(value => value.path === "mutable.txt");

    assert.equal(snapshot.payload.data.entries.some(value => value.path.includes("secret")), false);
    await fs.promises.writeFile(path.join(root, "mutable.txt"), "a changed size");
    await assert.rejects(
        harness.hub.OpenResource(
            session,
            "resources-main",
            "mutable.txt",
            { method: "GET", revision: entry.revision },
        ),
        error => error.code === "revision_mismatch" && error.retryable === true,
    );
    await assert.rejects(
        harness.hub.OpenResource(
            session,
            "resources-main",
            "linked/secret.txt",
            { method: "GET", revision: "guessed" },
        ),
        error => error.code === "resource_not_found",
    );
});

test("collapses bounded pending hints into a complete root reconciliation", async context =>
{
    const root = await CjsResourceWatchTestSupport.createRoot(context);
    const harness = CjsResourceWatchTestSupport.createHarness(root, {
        service: {
            maxPendingPaths: 1,
            settleMs: 25,
        },
    });

    context.after(() => harness.hub.Stop());
    await harness.hub.Start();
    const { connection, transport } = await CjsResourceWatchTestSupport.connect(harness);

    await connection.ReceiveText(JSON.stringify({
        type: "subscribe",
        requestId: "resource-overflow-subscribe",
        serviceId: "resources-main",
        topics: [ ENTRY_TOPIC ],
    }));
    await connection.Drain();
    await fs.promises.writeFile(path.join(root, "one.txt"), "one");
    await fs.promises.writeFile(path.join(root, "two.txt"), "two");
    harness.observer.Emit("one.txt", 4000);
    harness.observer.Emit("two.txt", 4001);
    await CjsResourceWatchTestSupport.waitFor(() =>
        transport.messages.filter(message => message.topic === ENTRY_TOPIC).length === 2);
    const events = transport.messages.filter(message => message.topic === ENTRY_TOPIC);

    assert.deepEqual(events.map(event => event.payload.data.path), [ "one.txt", "two.txt" ]);
    assert.equal(events.every(event => event.payload.data.operation === "add"), true);
});

test("ignores stale observer callbacks after abort and restarts on a fresh stream", async context =>
{
    const root = await CjsResourceWatchTestSupport.createRoot(context);
    const harness = CjsResourceWatchTestSupport.createHarness(root);

    context.after(() => harness.hub.Stop());
    await harness.hub.Start();
    const staleChange = harness.observer.options.onChange;
    const firstStream = harness.hub.ListRuntimeServices()[0].cursor.streamId;

    await harness.hub.Stop();
    await Promise.resolve().then(() => staleChange({
        path: "stale.txt",
        occurredAt: 5000,
    }));
    await fs.promises.writeFile(path.join(root, "fresh.txt"), "fresh");
    await harness.hub.Start();
    const runtime = harness.hub.ListRuntimeServices()[0];

    assert.notEqual(runtime.cursor.streamId, firstStream);
    assert.equal(runtime.cursor.sequence, 0);
    const snapshot = await harness.hub.GetSnapshot(
        CjsResourceWatchTestSupport.session(harness),
        "resources-main",
    );

    assert.deepEqual(snapshot.payload.data.entries.map(entry => entry.path), [ "fresh.txt" ]);
    assert.equal(harness.observer.closed, false);
});

test("rejects direct absolute, drive, separator, and encoded traversal aliases", async context =>
{
    const root = await CjsResourceWatchTestSupport.createRoot(context);

    await fs.promises.writeFile(path.join(root, "safe.txt"), "safe");
    const harness = CjsResourceWatchTestSupport.createHarness(root);

    context.after(() => harness.hub.Stop());
    await harness.hub.Start();
    const session = CjsResourceWatchTestSupport.session(harness);
    const invalid = [
        "/absolute.txt",
        "C:/Windows/win.ini",
        "folder\\secret.txt",
        "../secret.txt",
        "%2e%2e/secret.txt",
        "folder/%2fsecret.txt",
    ];

    for (const resourcePath of invalid)
    {
        await assert.rejects(
            harness.hub.OpenResource(
                session,
                "resources-main",
                resourcePath,
                { method: "GET", revision: "guessed" },
            ),
            error => error.code === "invalid_path",
        );
    }
});
