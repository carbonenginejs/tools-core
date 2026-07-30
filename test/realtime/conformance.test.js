import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import test from "node:test";

import { WebSocket } from "ws";

import {
    CjsRealtimeClient as CjsBrowserRealtimeClient,
} from "@carbonenginejs/tools-browser/realtime";
import {
    CjsRealtimeProtocol as CjsBrowserRealtimeProtocol,
    REALTIME_PROTOCOL as BROWSER_REALTIME_PROTOCOL,
    REALTIME_PROTOCOL_VERSION as BROWSER_REALTIME_PROTOCOL_VERSION,
    REALTIME_ROUTE as BROWSER_REALTIME_ROUTE,
    REALTIME_SUBPROTOCOL as BROWSER_REALTIME_SUBPROTOCOL,
} from "@carbonenginejs/tools-browser/realtime/wire";
import {
    REALTIME_PROTOCOL,
    REALTIME_PROTOCOL_VERSION,
    REALTIME_ROUTE,
    REALTIME_SUBPROTOCOL,
} from "../../src/realtime/CjsRealtimeProtocol.js";
import { CjsRealtimeHub } from "../../src/realtime/server/CjsRealtimeHub.js";
import { CjsRealtimeSessionAuthority } from "../../src/realtime/server/CjsRealtimeSessionAuthority.js";
import { CjsRealtimeServer } from "../../src/service/CjsRealtimeServer.js";
import {
    CjsRealtimeMemoryTransport,
    CjsRealtimeSyntheticService,
} from "./CjsRealtimeTestSupport.js";

const fixture = JSON.parse(await fs.readFile(
    new URL("../../docs/protocols/realtime-v1.transcript.json", import.meta.url),
    "utf8",
));

class CjsRealtimeConformanceTest
{

    /** Replays one checked-in transcript through a deterministic real hub. */
    static async runTranscript(transcript)
    {
        let nextId = 0;
        const authority = new CjsRealtimeSessionAuthority({ grants: [ transcript.grant ] });
        const service = new CjsRealtimeSyntheticService();
        const hub = new CjsRealtimeHub({
            authority,
            clock: () => Date.parse(fixture.clock),
            createId: prefix => `${prefix}-${++nextId}`,
        });
        const transport = new CjsRealtimeMemoryTransport();

        hub.Register(service);
        await hub.Start();
        const connection = hub.OpenConnection({
            transport,
            origin: transcript.transport.origin,
        });

        try
        {
            for (const step of transcript.steps)
            {
                const start = transport.messages.length;

                if (step.client)
                {
                    await connection.ReceiveText(JSON.stringify(step.client));
                }
                else
                {
                    await service.Emit(step.hostPublish.topic, step.hostPublish.data);
                }

                await connection.Drain();
                assert.deepEqual(
                    transport.messages.slice(start),
                    step.server,
                    `${transcript.id}/${step.id}`,
                );
            }

            assert.deepEqual(transport.closes, []);
        }
        finally
        {
            await hub.Stop();
        }
    }

    /** Creates a real gateway using one fixture transport and capability grant. */
    static async listen(transcript, transport = transcript.transport)
    {
        const server = new CjsRealtimeServer({
            services: [ new CjsRealtimeSyntheticService() ],
            grants: [ transcript.grant ],
            allowedOrigins: transport.allowedOrigins,
            allowMissingOrigin: transport.allowMissingOrigin,
        });
        const address = await server.Listen();

        return {
            server,
            url: `ws://127.0.0.1:${address.port}/v1/realtime`,
        };
    }

    /** Opens a fixture WebSocket with or without an explicit browser Origin. */
    static openSocket(url, transport)
    {
        return new WebSocket(url, REALTIME_SUBPROTOCOL, transport.origin === null
            ? {}
            : { origin: transport.origin });
    }

    /** Resolves the HTTP status from a rejected fixture upgrade. */
    static rejectedStatus(socket)
    {
        return new Promise((resolve, reject) =>
        {
            socket.once("unexpected-response", (request, response) =>
            {
                response.resume();
                resolve(response.statusCode);
            });
            socket.once("error", reject);
        });
    }

    /** Creates a ws implementation with the browser transcript's Origin. */
    static browserWebSocketClass(origin)
    {
        return class CjsRealtimeConformanceBrowserSocket extends WebSocket
        {

            constructor(url, protocols)
            {
                super(url, protocols, origin === null ? {} : { origin });
            }

        };
    }

    /** Bounds one browser-client observation without leaving a live timer. */
    static withTimeout(promise, label)
    {
        let timer = null;
        const timeout = new Promise((resolve, reject) =>
        {
            timer = setTimeout(
                () => reject(new Error(`Timed out waiting for ${label}`)),
                1000,
            );
        });

        return Promise.race([ promise, timeout ]).finally(() => clearTimeout(timer));
    }

}

test("keeps the checked-in v1 constants and wire transcripts executable", async () =>
{
    assert.deepEqual(fixture.protocol, {
        name: REALTIME_PROTOCOL,
        version: REALTIME_PROTOCOL_VERSION,
        subprotocol: REALTIME_SUBPROTOCOL,
        route: REALTIME_ROUTE,
    });

    for (const transcript of fixture.transcripts)
    {
        await CjsRealtimeConformanceTest.runTranscript(transcript);
    }
});

test("drives the real browser client and shared wire from the normative transcript", async () =>
{
    assert.equal(BROWSER_REALTIME_PROTOCOL, REALTIME_PROTOCOL);
    assert.equal(BROWSER_REALTIME_PROTOCOL_VERSION, REALTIME_PROTOCOL_VERSION);
    assert.equal(BROWSER_REALTIME_ROUTE, REALTIME_ROUTE);
    assert.equal(BROWSER_REALTIME_SUBPROTOCOL, REALTIME_SUBPROTOCOL);

    for (const transcript of fixture.transcripts)
    {
        const helloStep = transcript.steps.find(step => step.id === "hello");
        const subscribeStep = transcript.steps.find(step => step.id === "subscribe");
        const publishStep = transcript.steps.find(step => step.id === "publish");
        const commandStep = transcript.steps.find(step => step.id === "command");
        const service = new CjsRealtimeSyntheticService();
        const server = new CjsRealtimeServer({
            services: [ service ],
            grants: [ transcript.grant ],
            allowedOrigins: transcript.transport.allowedOrigins,
            allowMissingOrigin: transcript.transport.allowMissingOrigin,
        });
        const address = await server.Listen();
        let resolveEvent = null;
        const received = subscribeStep === undefined ? null : new Promise(resolve =>
        {
            resolveEvent = resolve;
        });
        let client = null;

        try
        {
            client = new CjsBrowserRealtimeClient({
                url: `ws://127.0.0.1:${address.port}/v1/realtime`,
                capability: transcript.grant.capability,
                client: helloStep.client.client,
                webSocketClass: CjsRealtimeConformanceTest.browserWebSocketClass(
                    transcript.transport.origin,
                ),
                reconnect: { minimumDelayMs: 0, maximumDelayMs: 0 },
            });
            const subscription = subscribeStep === undefined
                ? null
                : client.Subscribe({
                    serviceId: subscribeStep.client.serviceId,
                    topics: subscribeStep.client.topics,
                    onEvent: resolveEvent,
                });
            const hello = await client.Connect();

            assert.deepEqual(hello.actor, transcript.grant.actor, transcript.id);

            if (subscription === null)
            {
                continue;
            }

            await service.Emit(
                publishStep.hostPublish.topic,
                publishStep.hostPublish.data,
            );
            const event = await CjsRealtimeConformanceTest.withTimeout(
                received,
                `${transcript.id} browser event`,
            );

            assert.deepEqual(
                event.payload.data,
                publishStep.server[0].payload.data,
                transcript.id,
            );
            assert.deepEqual(
                await client.Command(
                    commandStep.client.serviceId,
                    commandStep.client.action,
                    commandStep.client.data,
                ),
                commandStep.server[0].data,
                transcript.id,
            );
            assert.equal(await client.Unsubscribe(subscription), true, transcript.id);
            assert.equal(
                CjsBrowserRealtimeProtocol.serviceIdentity(event.service).id,
                subscribeStep.client.serviceId,
                transcript.id,
            );
        }
        finally
        {
            client?.Close();
            await server.Stop();
        }
    }
});

test("keeps browser and missing-Origin agent grants separate", () =>
{
    const transcripts = new Map(fixture.transcripts.map(entry => [ entry.id, entry ]));

    for (const rejection of fixture.authenticationRejections)
    {
        const transcript = transcripts.get(rejection.grant);
        const authority = new CjsRealtimeSessionAuthority({
            grants: [ transcript.grant ],
        });

        assert.throws(
            () => authority.Authenticate(transcript.grant.capability, {
                origin: rejection.origin,
            }),
            error => error.code === rejection.code
                && error.closeCode === rejection.closeCode,
            rejection.id,
        );
    }
});

test("requires both the gateway and grant to admit a missing Origin", async () =>
{
    const transcripts = new Map(fixture.transcripts.map(entry => [ entry.id, entry ]));

    for (const transcript of fixture.transcripts)
    {
        const network = await CjsRealtimeConformanceTest.listen(transcript);

        try
        {
            const socket = CjsRealtimeConformanceTest.openSocket(
                network.url,
                transcript.transport,
            );

            await once(socket, "open");
            socket.send(JSON.stringify(transcript.steps[0].client));
            const [ data ] = await once(socket, "message");
            const hello = JSON.parse(data.toString("utf8"));

            assert.equal(hello.type, "hello", transcript.id);
            assert.deepEqual(hello.actor, transcript.grant.actor, transcript.id);
            const closed = once(socket, "close");

            socket.close();
            await closed;
        }
        finally
        {
            await network.server.Stop();
        }
    }

    for (const gateCase of fixture.authenticationGateCases)
    {
        const transcript = transcripts.get(gateCase.grant);
        const network = await CjsRealtimeConformanceTest.listen(
            transcript,
            gateCase.transport,
        );

        try
        {
            const socket = CjsRealtimeConformanceTest.openSocket(
                network.url,
                gateCase.transport,
            );

            if (gateCase.phase === "upgrade")
            {
                assert.equal(
                    await CjsRealtimeConformanceTest.rejectedStatus(socket),
                    gateCase.statusCode,
                    gateCase.id,
                );
            }
            else
            {
                await once(socket, "open");
                socket.send(JSON.stringify(transcript.steps[0].client));
                const [ code, reason ] = await once(socket, "close");

                assert.equal(code, gateCase.closeCode, gateCase.id);
                assert.equal(reason.toString("utf8"), gateCase.reason, gateCase.id);
            }
        }
        finally
        {
            await network.server.Stop();
        }
    }
});
