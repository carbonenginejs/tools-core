import crypto from "node:crypto";

import { CjsRealtimeError } from "../CjsRealtimeError.js";
import { CjsRealtimeProtocol } from "../CjsRealtimeProtocol.js";

/** Authenticates injected capabilities and enforces their service scopes. */
export class CjsRealtimeSessionAuthority
{

    #grants;

    #clock;

    #generation;

    constructor({ grants = [], clock = () => Date.now() } = {})
    {
        if (!Array.isArray(grants))
        {
            throw new TypeError("Realtime authority grants must be an array");
        }

        if (typeof clock !== "function")
        {
            throw new TypeError("Realtime authority clock must be a function");
        }

        this.#clock = clock;
        this.#grants = new Map();
        this.#generation = 0;

        for (const grant of grants)
        {
            this.AddGrant(grant);
        }

        Object.freeze(this);
    }

    /** Adds or replaces one injected capability grant. */
    AddGrant(grant)
    {
        if (!CjsRealtimeProtocol.isRecord(grant))
        {
            throw new TypeError("Realtime capability grant must be an object");
        }

        CjsRealtimeProtocol.assertString(grant.capability, "capability", 32, 2048);

        if (!CjsRealtimeProtocol.isRecord(grant.actor))
        {
            throw new TypeError("Realtime capability actor must be an object");
        }

        CjsRealtimeProtocol.assertServiceId(grant.actor.id);
        CjsRealtimeProtocol.assertName(grant.actor.kind, "actor kind");

        if (!Array.isArray(grant.allowedOrigins))
        {
            throw new TypeError("Realtime capability allowedOrigins must be an array");
        }

        const allowedOrigins = grant.allowedOrigins.map(origin =>
            CjsRealtimeSessionAuthority.normalizeOrigin(origin));
        const expiresAt = grant.expiresAt === undefined || grant.expiresAt === null
            ? null
            : new Date(grant.expiresAt).getTime();

        if (expiresAt !== null && !Number.isFinite(expiresAt))
        {
            throw new TypeError("Realtime capability expiresAt must be a valid date");
        }

        const scopes = CjsRealtimeSessionAuthority.normalizeScopes(grant.scopes ?? {});
        const record = Object.freeze({
            generation: ++this.#generation,
            actor: Object.freeze({
                id: grant.actor.id,
                kind: grant.actor.kind,
            }),
            allowedOrigins: Object.freeze([ ...allowedOrigins ]),
            allowMissingOrigin: grant.allowMissingOrigin === true,
            scopes,
            expiresAt,
        });

        this.#grants.set(CjsRealtimeSessionAuthority.digestCapability(grant.capability), record);

        return record;
    }

    /** Revokes one injected capability without retaining its raw value. */
    RevokeCapability(capability)
    {
        return this.#grants.delete(CjsRealtimeSessionAuthority.digestCapability(capability));
    }

    /** Authenticates a capability for the captured connection origin. */
    Authenticate(capability, { origin = null } = {})
    {
        if (typeof capability !== "string")
        {
            throw CjsRealtimeSessionAuthority.unauthorized();
        }

        const grantId = CjsRealtimeSessionAuthority.digestCapability(capability);
        const grant = this.#grants.get(grantId);

        if (!grant || (grant.expiresAt !== null && grant.expiresAt <= this.#clock()))
        {
            throw CjsRealtimeSessionAuthority.unauthorized();
        }

        if (origin === null || origin === undefined || origin === "")
        {
            if (!grant.allowMissingOrigin)
            {
                throw CjsRealtimeSessionAuthority.unauthorized();
            }
        }
        else
        {
            let normalizedOrigin;

            try
            {
                normalizedOrigin = CjsRealtimeSessionAuthority.normalizeOrigin(origin);
            }
            catch
            {
                throw CjsRealtimeSessionAuthority.unauthorized();
            }

            if (!grant.allowedOrigins.includes(normalizedOrigin))
            {
                throw CjsRealtimeSessionAuthority.unauthorized();
            }
        }

        return Object.freeze({
            grantId,
            grantGeneration: grant.generation,
            actor: grant.actor,
            scopes: grant.scopes,
            expiresAt: grant.expiresAt,
        });
    }

    /** Revalidates expiry or revocation for an established session. */
    ValidateSession(session)
    {
        const grant = typeof session?.grantId === "string"
            ? this.#grants.get(session.grantId)
            : null;

        if (!grant || grant.generation !== session.grantGeneration
            || (grant.expiresAt !== null && grant.expiresAt <= this.#clock()))
        {
            throw CjsRealtimeSessionAuthority.unauthorized();
        }

        return session;
    }

    /** Requires discovery permission for a session. */
    AuthorizeDiscovery(session)
    {
        this.ValidateSession(session);

        if (session?.scopes?.discover !== true)
        {
            throw CjsRealtimeSessionAuthority.unauthorized();
        }
    }

    /** Filters service descriptions to those visible to the session. */
    FilterServices(session, descriptions)
    {
        this.AuthorizeDiscovery(session);

        return descriptions.filter(description => Object.hasOwn(
            session.scopes.services,
            description.id,
        ));
    }

    /** Requires permission for every selected topic. */
    AuthorizeTopics(session, serviceId, topics)
    {
        const scope = this.#GetServiceScope(session, serviceId);

        if (!topics.every(topic => scope.topics.includes(topic)))
        {
            throw CjsRealtimeSessionAuthority.unauthorized();
        }
    }

    /** Requires snapshot access to one service. */
    AuthorizeSnapshot(session, serviceId)
    {
        if (this.#GetServiceScope(session, serviceId).snapshots !== true)
        {
            throw CjsRealtimeSessionAuthority.unauthorized();
        }
    }

    /** Requires content access to one service. */
    AuthorizeContent(session, serviceId)
    {
        if (this.#GetServiceScope(session, serviceId).content !== true)
        {
            throw CjsRealtimeSessionAuthority.unauthorized();
        }
    }

    /** Requires command access to one service action. */
    AuthorizeCommand(session, serviceId, action)
    {
        const scope = this.#GetServiceScope(session, serviceId);

        if (!scope.commands.includes(action))
        {
            throw CjsRealtimeSessionAuthority.unauthorized();
        }
    }

    #GetServiceScope(session, serviceId)
    {
        this.ValidateSession(session);
        const services = session?.scopes?.services;
        const scope = services && Object.hasOwn(services, serviceId)
            ? services[serviceId]
            : null;

        if (!scope)
        {
            throw CjsRealtimeSessionAuthority.unauthorized();
        }

        return scope;
    }

    /** Generates a capability suitable for trusted launcher injection. */
    static createCapability()
    {
        return crypto.randomBytes(32).toString("base64url");
    }

    /** Returns a one-way digest used as the authority lookup key. */
    static digestCapability(capability)
    {
        return crypto.createHash("sha256").update(String(capability)).digest("hex");
    }

    /** Validates and canonicalizes an exact browser origin. */
    static normalizeOrigin(origin)
    {
        if (typeof origin !== "string" || origin === "null")
        {
            throw new TypeError("Realtime origin must be an absolute origin string");
        }

        const url = new URL(origin);

        if (url.origin === "null" || url.username || url.password || url.pathname !== "/"
            || url.search || url.hash)
        {
            throw new TypeError("Realtime origin must not contain credentials, path, query, or hash");
        }

        return url.origin;
    }

    /** Validates and freezes server-side capability scopes. */
    static normalizeScopes(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Realtime capability scopes must be an object");
        }

        const serviceValues = value.services ?? {};

        if (!CjsRealtimeProtocol.isRecord(serviceValues))
        {
            throw new TypeError("Realtime capability service scopes must be an object");
        }

        const services = Object.create(null);

        for (const [ serviceId, source ] of Object.entries(serviceValues))
        {
            CjsRealtimeProtocol.assertServiceId(serviceId);

            if (!CjsRealtimeProtocol.isRecord(source))
            {
                throw new TypeError("Realtime service scope must be an object");
            }

            const topics = CjsRealtimeSessionAuthority.normalizeNameArray(
                source.topics ?? [],
                "topic",
            );
            const commands = CjsRealtimeSessionAuthority.normalizeNameArray(
                source.commands ?? [],
                "command",
            );

            services[serviceId] = Object.freeze({
                topics,
                commands,
                snapshots: source.snapshots === true,
                content: source.content === true,
            });
        }

        return Object.freeze({
            discover: value.discover === true,
            services: Object.freeze(services),
        });
    }

    /** Normalizes one exact-name permission list. */
    static normalizeNameArray(value, label)
    {
        if (!Array.isArray(value))
        {
            throw new TypeError(`Realtime ${label} scopes must be an array`);
        }

        const names = value.map(name =>
        {
            CjsRealtimeProtocol.assertName(name, label);

            return name;
        });

        if (new Set(names).size !== names.length)
        {
            throw new TypeError(`Realtime ${label} scopes must be unique`);
        }

        return Object.freeze(names);
    }

    /** Creates a deliberately indistinguishable authentication failure. */
    static unauthorized()
    {
        return new CjsRealtimeError("unauthorized", "Realtime capability is not authorized", {
            connectionUsable: false,
            statusCode: 401,
            closeCode: 1008,
        });
    }

}
