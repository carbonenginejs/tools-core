import { CjsRealtimeError } from "./CjsRealtimeError.js";

export const REALTIME_PROTOCOL = "carbon.tools.realtime";
export const REALTIME_PROTOCOL_VERSION = 1;
export const REALTIME_SUBPROTOCOL = "carbon.tools.realtime.v1";
export const REALTIME_ROUTE = "/v1/realtime";

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const REQUEST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Validation and normalization for the versioned realtime wire boundary. */
export class CjsRealtimeProtocol
{

    /** Parses one bounded JSON text message. */
    static parseText(text, {
        maxBytes = 64 * 1024,
        maxDepth = 16,
        maxNodes = 4096,
    } = {})
    {
        if (typeof text !== "string")
        {
            throw new CjsRealtimeError("invalid_message", "Realtime messages must be text", {
                connectionUsable: false,
                closeCode: 1003,
            });
        }

        if (new TextEncoder().encode(text).byteLength > maxBytes)
        {
            throw new CjsRealtimeError("message_too_large", "Realtime message exceeds the byte limit", {
                connectionUsable: false,
                closeCode: 1009,
            });
        }

        let value;

        try
        {
            value = JSON.parse(text);
        }
        catch (error)
        {
            throw new CjsRealtimeError("invalid_json", "Realtime message is not valid JSON", {
                connectionUsable: false,
                closeCode: 1002,
                cause: error,
            });
        }

        CjsRealtimeProtocol.validateJson(value, { maxDepth, maxNodes });

        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new CjsRealtimeError("invalid_message", "Realtime message must be an object", {
                connectionUsable: false,
                closeCode: 1002,
            });
        }

        return value;
    }

    /** Validates and normalizes a client-to-server message. */
    static normalizeClientMessage(value, { authenticated = false } = {})
    {
        if (!CjsRealtimeProtocol.isRecord(value) || typeof value.type !== "string")
        {
            throw new CjsRealtimeError("invalid_message", "Realtime message type is required", {
                connectionUsable: false,
                closeCode: 1002,
            });
        }

        if (!authenticated && value.type !== "hello")
        {
            throw new CjsRealtimeError("hello_required", "The first realtime message must be hello", {
                connectionUsable: false,
                closeCode: 1002,
            });
        }

        if (authenticated && value.type === "hello")
        {
            throw new CjsRealtimeError("unexpected_hello", "Realtime hello was already accepted", {
                connectionUsable: false,
                closeCode: 1002,
            });
        }

        if (value.type === "hello")
        {
            if (value.protocolVersion !== REALTIME_PROTOCOL_VERSION)
            {
                throw new CjsRealtimeError("unsupported_version", "Unsupported realtime protocol version", {
                    connectionUsable: false,
                    closeCode: 1002,
                });
            }

            CjsRealtimeProtocol.assertString(value.capability, "capability", 1, 2048);

            if (value.client !== undefined && !CjsRealtimeProtocol.isRecord(value.client))
            {
                throw new CjsRealtimeError("invalid_request", "hello.client must be an object");
            }

            return Object.freeze({
                type: "hello",
                protocolVersion: value.protocolVersion,
                capability: value.capability,
                client: value.client === undefined
                    ? null
                    : CjsRealtimeProtocol.cloneJson(value.client),
            });
        }

        CjsRealtimeProtocol.assertRequestId(value.requestId);

        if (value.type === "subscribe")
        {
            CjsRealtimeProtocol.assertServiceId(value.serviceId);

            if (!Array.isArray(value.topics) || value.topics.length === 0)
            {
                throw new CjsRealtimeError("invalid_request", "subscribe.topics must be a non-empty array");
            }

            const topics = value.topics.map(topic =>
            {
                CjsRealtimeProtocol.assertName(topic, "topic");

                return topic;
            });

            if (new Set(topics).size !== topics.length)
            {
                throw new CjsRealtimeError("invalid_request", "subscribe.topics must be unique");
            }

            return Object.freeze({
                type: "subscribe",
                requestId: value.requestId,
                serviceId: value.serviceId,
                topics: Object.freeze([ ...topics ]),
            });
        }

        if (value.type === "unsubscribe")
        {
            CjsRealtimeProtocol.assertString(value.subscriptionId, "subscriptionId", 1, 128);

            return Object.freeze({
                type: "unsubscribe",
                requestId: value.requestId,
                subscriptionId: value.subscriptionId,
            });
        }

        if (value.type === "command")
        {
            CjsRealtimeProtocol.assertServiceId(value.serviceId);
            CjsRealtimeProtocol.assertName(value.action, "action");

            if (value.operationId !== undefined && value.operationId !== null)
            {
                CjsRealtimeProtocol.assertString(value.operationId, "operationId", 1, 128);
            }

            CjsRealtimeProtocol.validateJson(value.data ?? null);

            return Object.freeze({
                type: "command",
                requestId: value.requestId,
                serviceId: value.serviceId,
                action: value.action,
                operationId: value.operationId ?? null,
                data: CjsRealtimeProtocol.cloneJson(value.data ?? null),
            });
        }

        throw new CjsRealtimeError("invalid_message", "Unsupported realtime message type", {
            connectionUsable: false,
            closeCode: 1002,
        });
    }

    /** Validates and freezes one registered service description. */
    static normalizeServiceDescription(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Realtime service Describe() must return an object");
        }

        CjsRealtimeProtocol.assertServiceId(value.id);
        CjsRealtimeProtocol.assertName(value.family, "family");
        CjsRealtimeProtocol.assertName(value.kind, "kind");

        if (!Number.isSafeInteger(value.familyVersion) || value.familyVersion < 1)
        {
            throw new TypeError("Realtime service familyVersion must be a positive integer");
        }

        if (!Array.isArray(value.topics))
        {
            throw new TypeError("Realtime service topics must be an array");
        }

        const topics = value.topics.map(entry =>
        {
            const topic = typeof entry === "string" ? { name: entry } : entry;

            if (!CjsRealtimeProtocol.isRecord(topic))
            {
                throw new TypeError("Realtime service topic must be a string or object");
            }

            CjsRealtimeProtocol.assertName(topic.name, "topic name");
            const recovery = topic.recovery ?? "loss-tolerant";

            if (![ "loss-tolerant", "snapshot" ].includes(recovery))
            {
                throw new TypeError(`Unsupported realtime topic recovery: ${recovery}`);
            }

            return Object.freeze({ name: topic.name, recovery });
        });
        const commands = (value.commands ?? []).map(entry =>
        {
            const command = typeof entry === "string" ? { name: entry } : entry;

            if (!CjsRealtimeProtocol.isRecord(command))
            {
                throw new TypeError("Realtime service command must be a string or object");
            }

            CjsRealtimeProtocol.assertName(command.name, "command name");

            return Object.freeze({
                name: command.name,
                operationRequired: command.operationRequired !== false,
            });
        });

        if (new Set(topics.map(topic => topic.name)).size !== topics.length)
        {
            throw new TypeError("Realtime service topic names must be unique");
        }

        if (new Set(commands.map(command => command.name)).size !== commands.length)
        {
            throw new TypeError("Realtime service command names must be unique");
        }

        if (topics.some(topic => topic.recovery === "snapshot") && value.snapshot !== true)
        {
            throw new TypeError(
                "Realtime snapshot-recovery topics require service snapshot support",
            );
        }

        return Object.freeze({
            family: value.family,
            familyVersion: value.familyVersion,
            kind: value.kind,
            id: value.id,
            topics: Object.freeze(topics),
            commands: Object.freeze(commands),
            snapshot: value.snapshot === true,
            resources: value.resources === true,
        });
    }

    /** Returns the stable identity portion of a service description. */
    static serviceIdentity(description)
    {
        return Object.freeze({
            family: description.family,
            familyVersion: description.familyVersion,
            kind: description.kind,
            id: description.id,
        });
    }

    /** Creates an immutable JSON-compatible clone. */
    static cloneJson(value)
    {
        CjsRealtimeProtocol.validateJson(value);

        return JSON.parse(JSON.stringify(value));
    }

    /** Produces deterministic JSON for operation fingerprints. */
    static canonicalStringify(value)
    {
        CjsRealtimeProtocol.validateJson(value);

        return JSON.stringify(CjsRealtimeProtocol.#canonicalize(value));
    }

    /** Validates a JSON-compatible value with bounded depth and node count. */
    static validateJson(value, { maxDepth = 32, maxNodes = 16384 } = {})
    {
        const state = { nodes: 0, seen: new WeakSet() };

        CjsRealtimeProtocol.#validateJsonValue(value, 0, maxDepth, maxNodes, state);

        return value;
    }

    /** Returns true for a non-array object record. */
    static isRecord(value)
    {
        if (value === null || typeof value !== "object" || Array.isArray(value))
        {
            return false;
        }

        const prototype = Object.getPrototypeOf(value);

        return prototype === Object.prototype || prototype === null;
    }

    /** Validates one configured service ID. */
    static assertServiceId(value)
    {
        if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value))
        {
            throw new CjsRealtimeError("invalid_request", "Invalid realtime service ID");
        }

        return value;
    }

    /** Validates one topic, family, kind, or command name. */
    static assertName(value, label)
    {
        if (typeof value !== "string" || !NAME_PATTERN.test(value))
        {
            throw new CjsRealtimeError("invalid_request", `Invalid realtime ${label}`);
        }

        return value;
    }

    /** Validates one connection-scoped request ID. */
    static assertRequestId(value)
    {
        if (typeof value !== "string" || !REQUEST_PATTERN.test(value))
        {
            throw new CjsRealtimeError("invalid_request", "Invalid realtime requestId");
        }

        return value;
    }

    /** Validates a bounded string field. */
    static assertString(value, label, minimum, maximum)
    {
        if (typeof value !== "string" || value.length < minimum || value.length > maximum)
        {
            throw new CjsRealtimeError("invalid_request", `${label} must be a bounded string`);
        }

        return value;
    }

    static #canonicalize(value)
    {
        if (Array.isArray(value))
        {
            return value.map(entry => CjsRealtimeProtocol.#canonicalize(entry));
        }

        if (CjsRealtimeProtocol.isRecord(value))
        {
            const result = Object.create(null);

            for (const key of Object.keys(value).sort())
            {
                result[key] = CjsRealtimeProtocol.#canonicalize(value[key]);
            }

            return result;
        }

        return value;
    }

    static #validateJsonValue(value, depth, maxDepth, maxNodes, state)
    {
        state.nodes++;

        if (state.nodes > maxNodes || depth > maxDepth)
        {
            throw new CjsRealtimeError("invalid_request", "JSON value exceeds structural limits");
        }

        if (value === null || typeof value === "string" || typeof value === "boolean")
        {
            return;
        }

        if (typeof value === "number")
        {
            if (!Number.isFinite(value))
            {
                throw new CjsRealtimeError("invalid_request", "JSON numbers must be finite");
            }

            return;
        }

        if (typeof value !== "object")
        {
            throw new CjsRealtimeError("invalid_request", "Value is not JSON-compatible");
        }

        if (!Array.isArray(value) && !CjsRealtimeProtocol.isRecord(value))
        {
            throw new CjsRealtimeError("invalid_request", "JSON objects must be plain records");
        }

        if (state.seen.has(value))
        {
            throw new CjsRealtimeError("invalid_request", "JSON value must not contain a cycle");
        }

        state.seen.add(value);
        const entries = Array.isArray(value) ? value : Object.values(value);

        for (const entry of entries)
        {
            CjsRealtimeProtocol.#validateJsonValue(
                entry,
                depth + 1,
                maxDepth,
                maxNodes,
                state,
            );
        }

        state.seen.delete(value);
    }

}
