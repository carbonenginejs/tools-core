import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import test from "node:test";

import { WebSocket } from "ws";

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
