import { CjsRealtimeError } from "../../src/realtime/CjsRealtimeError.js";
import { CjsRealtimeHub } from "../../src/realtime/server/CjsRealtimeHub.js";
import { CjsRealtimeSessionAuthority } from "../../src/realtime/server/CjsRealtimeSessionAuthority.js";

/** Synthetic state, event, command, snapshot, and content service for conformance tests. */
export class CjsRealtimeSyntheticService
{

    constructor({ id = "synthetic-main", failStart = false } = {})
    {
        this.id = id;
        this.failStart = failStart;
        this.value = 0;
        this.commandCount = 0;
        this.startCount = 0;
        this.stopCount = 0;
        this.context = null;
        this.commandGate = null;
        this.commandRelease = null;
        this.commitGate = null;
        this.commitRelease = null;
        this.snapshotGate = null;
        this.snapshotRelease = null;
        this.deferredContext = null;
        this.transientFailures = 0;
    }

    /** Declares the synthetic family surface. */
    Describe()
    {
        return {
            family: "synthetic.state",
            familyVersion: 1,
            kind: "synthetic.memory",
            id: this.id,
            topics: [
                { name: "synthetic.state.changed", recovery: "snapshot" },
                { name: "synthetic.audit.received", recovery: "loss-tolerant" },
            ],
            commands: [
                "set",
                "audit",
                "reject",
                "transient",
                "defer",
                "waitForAbort",
                "nestedReject",
                { name: "inspect", operationRequired: false },
            ],
            snapshot: true,
            resources: true,
        };
    }

    /** Starts the synthetic source. */
    async Start(context)
    {
        this.startCount++;
        this.context = context;

        if (this.failStart)
        {
            throw new Error("synthetic start failure");
        }
    }

    /** Stops the synthetic source. */
    async Stop()
    {
        this.stopCount++;
    }

    /** Returns current synthetic state. */
    async GetSnapshot()
    {
        if (this.snapshotGate)
        {
            await this.snapshotGate;
        }

        return { value: this.value };
    }

    /** Opens a revision-pinned synthetic JSON resource. */
    async OpenResource(path, request)
    {
        if (path !== "state.json")
        {
            throw new CjsRealtimeError("resource_not_found", "Synthetic resource was not found", {
                statusCode: 404,
            });
        }

        const revision = `value-${this.value}`;

        if (request.revision !== revision)
        {
            throw new CjsRealtimeError(
                "revision_mismatch",
                "Synthetic resource revision does not match",
                { statusCode: 409, retryable: true },
            );
        }

        const body = Buffer.from(JSON.stringify({ value: this.value }));

        return {
            body,
            revision,
            contentType: "application/json",
            contentLength: body.byteLength,
            etag: `"${revision}"`,
        };
    }

    /** Applies a synthetic command and publishes its canonical event. */
    async HandleCommand(command, context)
    {
        this.commandCount++;

        if (this.commandGate)
        {
            await this.commandGate;
        }

        if (command.action === "reject")
        {
            throw new CjsRealtimeError("synthetic_rejected", "Synthetic command was rejected");
        }

        if (command.action === "transient" && this.transientFailures++ === 0)
        {
            throw new CjsRealtimeError(
                "service_unavailable",
                "Synthetic service is temporarily unavailable",
                { retryable: true, statusCode: 503 },
            );
        }

        if (command.action === "defer")
        {
            this.deferredContext = context;

            return { status: "accepted", data: { deferred: true } };
        }

        if (command.action === "waitForAbort")
        {
            if (!context.signal.aborted)
            {
                await new Promise(resolve => context.signal.addEventListener(
                    "abort",
                    resolve,
                    { once: true },
                ));
            }

            await context.Publish("synthetic.audit.received", { aborted: true });

            return { status: "completed", data: { aborted: true } };
        }

        if (command.action === "nestedReject")
        {
            context.Commit(async () =>
            {
                throw new CjsRealtimeError(
                    "nested_rejected",
                    "Synthetic nested commit was rejected",
                );
            });

            return { status: "completed", data: null };
        }

        if (command.action === "set")
        {
            this.value = command.data.value;
            await context.Publish("synthetic.state.changed", { value: this.value });

            return { status: "completed", data: { value: this.value } };
        }

        if (command.action === "inspect")
        {
            return { status: "completed", data: { value: this.value } };
        }

        await context.Publish("synthetic.audit.received", command.data);

        return { status: "accepted", data: command.data };
    }

    /** Publishes an event as the synthetic source rather than a command actor. */
    Emit(topic, data)
    {
        return this.context.Publish(topic, data);
    }

    /** Mutates state and publishes its event in one host publication lane. */
    CommitValue(value)
    {
        return this.context.Commit(async context =>
        {
            if (this.commitGate)
            {
                await this.commitGate;
            }

            this.value = value;
            await context.Publish("synthetic.state.changed", { value });
        });
    }

    /** Commits state through a context retained by accepted asynchronous work. */
    CommitDeferredValue(value)
    {
        return this.deferredContext.Commit(async context =>
        {
            this.value = value;
            await context.Publish("synthetic.state.changed", { value });
        });
    }

    /** Attempts an unsafe publication through an expired inline context. */
    PublishDeferredValue(value)
    {
        return this.deferredContext.Publish("synthetic.state.changed", { value });
    }

    /** Blocks synthetic command completion until explicitly released. */
    BlockCommands()
    {
        this.commandGate = new Promise(resolve =>
        {
            this.commandRelease = resolve;
        });
    }

    /** Releases blocked synthetic commands. */
    ReleaseCommands()
    {
        this.commandRelease?.();
        this.commandRelease = null;
        this.commandGate = null;
    }

    /** Blocks source commits inside the service lane. */
    BlockCommits()
    {
        this.commitGate = new Promise(resolve =>
        {
            this.commitRelease = resolve;
        });
    }

    /** Releases source commits. */
    ReleaseCommits()
    {
        this.commitRelease?.();
        this.commitRelease = null;
        this.commitGate = null;
    }

    /** Blocks snapshot capture inside the service lane. */
    BlockSnapshots()
    {
        this.snapshotGate = new Promise(resolve =>
        {
            this.snapshotRelease = resolve;
        });
    }

    /** Releases snapshot capture. */
    ReleaseSnapshots()
    {
        this.snapshotRelease?.();
        this.snapshotRelease = null;
        this.snapshotGate = null;
    }

}

/** Captures transport-neutral protocol output for offline conformance tests. */
export class CjsRealtimeMemoryTransport
{

    #blocked;

    #release;

    constructor({ blocked = false } = {})
    {
        this.messages = [];
        this.closes = [];
        this.#blocked = blocked;
        this.#release = null;
    }

    /** Captures one JSON message, optionally under backpressure. */
    async Send(text)
    {
        this.messages.push(JSON.parse(text));

        if (this.#blocked)
        {
            await new Promise(resolve =>
            {
                this.#release = resolve;
            });
        }
    }

    /** Captures one transport close. */
    Close(code, reason)
    {
        this.closes.push({ code, reason });
        this.Release();
    }

    /** Applies backpressure to subsequent transport sends. */
    Block()
    {
        this.#blocked = true;
    }

    /** Releases one blocked transport send. */
    Release()
    {
        this.#blocked = false;
        this.#release?.();
        this.#release = null;
    }

}

/** Shared construction helpers for realtime conformance tests. */
export class CjsRealtimeTestSupport
{

    /** Creates a started synthetic hub with two scoped actors. */
    static async createHarness({ limits = {}, failStart = false } = {})
    {
        const capability = CjsRealtimeSessionAuthority.createCapability();
        const otherCapability = CjsRealtimeSessionAuthority.createCapability();
        const origin = "http://127.0.0.1:8080";
        const service = new CjsRealtimeSyntheticService({ failStart });
        const serviceScope = {
            topics: [ "synthetic.state.changed", "synthetic.audit.received" ],
            commands: [
                "set",
                "audit",
                "reject",
                "transient",
                "defer",
                "waitForAbort",
                "nestedReject",
                "inspect",
            ],
            snapshots: true,
            content: true,
        };
        const authority = new CjsRealtimeSessionAuthority({
            grants: [
                {
                    capability,
                    actor: { id: "agent-one", kind: "agent" },
                    allowedOrigins: [ origin ],
                    scopes: {
                        discover: true,
                        services: { "synthetic-main": serviceScope },
                    },
                },
                {
                    capability: otherCapability,
                    actor: { id: "agent-two", kind: "agent" },
                    allowedOrigins: [ origin ],
                    scopes: {
                        discover: true,
                        services: { "synthetic-main": serviceScope },
                    },
                },
            ],
        });
        let nextId = 0;
        const hub = new CjsRealtimeHub({
            authority,
            limits,
            createId: prefix => `${prefix}-${++nextId}`,
        });

        hub.Register(service);
        await hub.Start();

        return { hub, service, authority, capability, otherCapability, origin };
    }

    /** Opens and authenticates one in-memory protocol connection. */
    static async connect(harness, {
        capability = harness.capability,
        transport = new CjsRealtimeMemoryTransport(),
        origin = harness.origin,
    } = {})
    {
        const connection = harness.hub.OpenConnection({ transport, origin });

        await connection.ReceiveText(JSON.stringify({
            type: "hello",
            protocolVersion: 1,
            capability,
            client: { id: "offline-test", kind: "test" },
        }));
        await connection.Drain();

        return { connection, transport };
    }

}
