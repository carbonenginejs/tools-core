import { CjsToolIndexReader } from "./CjsToolIndexReader.js";
import { CjsToolIndexTargetProfileRegistry } from "./CjsToolIndexTargetProfileRegistry.js";
import { CjsToolIndexOverlaySource } from "./CjsToolIndexOverlaySource.js";
import { CjsToolIndexOverlayStore } from "./CjsToolIndexOverlayStore.js";
import { CjsToolIndexGeneratedStore } from "./CjsToolIndexGeneratedStore.js";
import { CjsToolIndexSource } from "./CjsToolIndexSource.js";
import { CjsToolIndexCache } from "./CjsToolIndexCache.js";
import { CjsToolBoundedFetch } from "../internal/CjsToolBoundedFetch.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import { CjsToolBuildPolicy } from "../build/CjsToolBuildPolicy.js";
import { CjsToolBuildObservations } from "../build/CjsToolBuildObservations.js";
import { resolveDataRoot } from "../cache/resolveDataRoot.js";
import * as utils from "../utils.js";

/** Facade for complete indexes and cached remote app/res file retrieval. */
export class CjsToolIndex
{

    #fetch;

    #cache;

    #indexes;

    #generated;

    #maxPayloadBytes;

    #overlays;

    #requestTimeoutMs;

    #profiles;

    #targets;

    // Private fields are not affected by Object.freeze, so this can be filled
    // lazily on a frozen instance.
    #policy;

    /** Creates the standalone source service with a local cache by default. */
    constructor({
        profiles = new CjsToolIndexTargetProfileRegistry(),
        targets = new CjsToolTargetRegistry(),
        fetch = globalThis.fetch,
        cache = new CjsToolIndexCache(),
        overlays = null,
        requestTimeoutMs = 30000,
        maxMetadataBytes = 64 * 1024,
        maxIndexBytes = 64 * 1024 * 1024,
        maxPayloadBytes = 256 * 1024 * 1024,
    } = {})
    {
        if (typeof fetch !== "function")
        {
            throw new TypeError("CjsToolIndex requires fetch");
        }

        if (cache !== null && !(cache instanceof CjsToolIndexCache))
        {
            throw new TypeError("CjsToolIndex cache must be a CjsToolIndexCache or null");
        }

        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsToolIndex targets must be a CjsToolTargetRegistry");
        }

        if (!(profiles instanceof CjsToolIndexTargetProfileRegistry))
        {
            throw new TypeError("CjsToolIndex profiles must be a CjsToolIndexTargetProfileRegistry");
        }

        if (overlays !== null && !(overlays instanceof CjsToolIndexOverlayStore))
        {
            throw new TypeError(
                "CjsToolIndex overlays must be a CjsToolIndexOverlayStore or null",
            );
        }

        CjsToolBoundedFetch.normalizeLimit(maxPayloadBytes, "maxPayloadBytes");

        this.#fetch = fetch;
        this.#cache = cache;
        this.#profiles = profiles;
        this.#targets = targets;
        this.#overlays = overlays;
        this.#generated = cache
            ? new CjsToolIndexGeneratedStore({ cache })
            : null;
        this.#requestTimeoutMs = requestTimeoutMs;
        this.#maxPayloadBytes = maxPayloadBytes;
        this.#indexes = new CjsToolIndexReader({
            profiles,
            fetch,
            cache,
            requestTimeoutMs,
            maxMetadataBytes,
            maxIndexBytes,
        });
        Object.freeze(this);
    }

    /** Resolves a friendly or exact build without opening its file indexes. */
    async ResolveBuild(options = {})
    {
        const normalized = this.#NormalizeSourceOptions(options);
        const resolution = await this.#indexes.ResolveBuild(normalized);

        return normalized.target
            ? utils.freezeData({ target: normalized.target, ...resolution })
            : resolution;
    }

    /** Lists public target aliases and their audited library capabilities. */
    ListTargets()
    {
        return this.#targets.List().map(target =>
        {
            // Each target names one default client but a profile may publish
            // several, and a consumer offering a choice has no other way to
            // learn what they are — the alternative is a hardcoded list that
            // silently drifts from this registry.
            //
            // The token rides along because it is not derivable: tranquility's
            // is TQ and singularity's is SISI, and the daily metadata file is
            // `eveclient_<TOKEN>.json`, case sensitive, so `eveclient_tq.json`
            // is a 404. Anything fetching that file needs the token, not the
            // name it was listed under.
            const profile = this.#profiles.Has(target.id)
                ? this.#profiles.Get(target.id)
                : null;

            return utils.freezeData({
                ...target,
                clients: Object.entries(profile?.clients ?? {}).map(([ id, client ]) => ({
                    id,
                    token: client.metadataToken ?? null,
                })),
            });
        });
    }

    /**
     * Lists a target's clients and the build each is currently on.
     *
     * A client name and `latest` exist to answer "which build" — that is all
     * they are for, and this is the route that asks. Everything downstream
     * should carry the resolved number instead, because a client name means
     * something different tomorrow and an SDE labelled with one cannot be
     * matched to the resources it was built from.
     *
     * **Always an array, whatever the count.** Most targets here have exactly
     * one client — `serenity`, `infinity`, and `ccp` under Frontier — and a
     * shape that collapses to a bare object for those forces every caller to
     * handle two shapes, which is how the single-client case ends up untested.
     *
     * One client failing to resolve does not fail the request. Each entry
     * carries its own `error` instead, because a target is often asked about
     * precisely when one of its clients is unreachable, and an all-or-nothing
     * answer hides the ones that are fine.
     *
     * @param {object} [options] Lookup options.
     * @param {string} [options.target] Target id; defaults to the registry's.
     * @returns {Promise<object>} Target, game/provider metadata, and clients.
     */
    /**
     * Everything a target is, addressed by the one key that identifies it.
     *
     * `target` is the identity; `provider` says who controls the data, `game`
     * groups related sources, and a client exists only to produce a build
     * number. Answering by target rather than by `game + provider` removes a
     * pair that is unique today only because it was made so by hand — nothing
     * in the registry enforces it, while a duplicate target id throws.
     *
     * @param {String} target
     * @returns {Promise<Object>} `{ target, provider, game, clients }`
     */
    async DescribeTarget(target)
    {
        const entry = this.#targets.List().find(candidate => candidate.id === String(target).toLowerCase());

        if (!entry)
        {
            const error = new TypeError(`Unknown target "${target}"`);

            error.code = "CJS_TOOL_TARGET_UNKNOWN";
            throw error;
        }

        const { clients } = await this.ListClients({ target: entry.id });

        return utils.freezeData({
            target: entry.id,
            provider: entry.provider,
            game: entry.game,
            clients,
        });
    }

    /** Returns the built-in client profiles available for index acquisition. */
    async ListClients(options = {})
    {
        const profile = this.#profiles.Get(options.target);
        const clients = await Promise.all(
            Object.entries(profile.clients ?? {}).map(async ([ id, client ]) =>
            {
                try
                {
                    const resolved = await this.ResolveBuild({
                        target: profile.target,
                        build: "latest",
                        client: id,
                    });

                    return {
                        id,
                        // Not derivable from the name: tranquility's is TQ and
                        // the metadata file is case sensitive.
                        token: client.metadataToken ?? null,
                        build: resolved?.build ?? null,
                        error: null,
                    };
                }
                catch (error)
                {
                    return { id, token: client.metadataToken ?? null, build: null, error: error.message };
                }
            }),
        );

        return utils.freezeData({
            target: profile.target,
            game: profile.game,
            provider: profile.provider,
            clients,
        });
    }

    /**
     * Resolves a short public target and build without opening file indexes.
     *
     * The answer carries **why** it is that build. An exact build is its own
     * reason and policy is not consulted: the caller named it, and a pin that
     * overrode an explicit request would make an exact build mean "probably".
     * An alias is a question, and the policy answers it.
     */
    async ResolveTargetBuild(targetValue, build = "latest", options = {})
    {
        const target = this.#targets.Get(targetValue);
        const resolution = await this.ResolveBuild(target.CreateIndexOptions({
            build,
            client: options.client ?? target.client,
        }));

        if (utils.isExactBuild(build)) return resolution;

        // Observed before policy is applied: the log records what upstream had,
        // never what we chose to serve. A pin must not be able to rewrite
        // history, or "is that build missing, or refused?" stops being
        // answerable from the record.
        //
        // Best effort. A read-only data root or a full disk should not fail a
        // resolution that has already succeeded.
        try
        {
            const observations = await CjsToolBuildObservations.read(resolveDataRoot());

            await observations.Record({
                target: target.id,
                facet: "resources",
                build: resolution.build,
                source: resolution.source ?? null,
                url: resolution.metadataUrl ?? null,
            });
        }
        catch
        {
            // Recording is not the caller's business.
        }

        const policy = await this.#GetPolicy();
        const decided = policy.Decide({
            target: target.id,
            facet: "resources",
            observedLatest: resolution.build,
        });

        return utils.freezeData({
            ...resolution,
            build: decided.build ?? resolution.build,
            reason: decided.reason,
            observedLatest: decided.observedLatest,
            ...(decided.note ? { policyNote: decided.note, policySince: decided.since } : {}),
        });
    }

    /**
     * The operator's pins and holds, read once per process.
     *
     * Cached because a policy file is edited by a person between runs, not
     * during one, and re-reading it per resolution would put a file read in
     * front of every request to save an operator a restart.
     */
    async #GetPolicy()
    {
        this.#policy ??= CjsToolBuildPolicy.read(resolveDataRoot());

        return this.#policy;
    }

    /** Reads the complete target/build app/res index graph. */
    async ReadIndexes(options = {})
    {
        return this.#indexes.Read(this.#NormalizeSourceOptions(options));
    }

    /** Reads complete indexes through a short public target alias. */
    async ReadTargetIndexes(targetValue, build = "latest", options = {})
    {
        const target = this.#targets.Get(targetValue);

        return this.ReadIndexes({
            ...options,
            ...target.CreateIndexOptions({
                build,
                client: options.client ?? target.client,
            }),
        });
    }

    /** Opens a complete target/build index as a cached byte source. */
    async Open(options = {})
    {
        const indexes = await this.ReadIndexes(options);

        return new CjsToolIndexSource({
            indexes,
            fetch: this.#fetch,
            cache: this.#cache,
            requestTimeoutMs: this.#requestTimeoutMs,
            maxPayloadBytes: this.#maxPayloadBytes,
        });
    }

    /** Opens cached resource access through a short public target alias. */
    async OpenTarget(targetValue, build = "latest", options = {})
    {
        const target = this.#targets.Get(targetValue);
        const indexes = await this.ReadTargetIndexes(target.id, build, options);
        const source = new CjsToolIndexSource({
            indexes,
            fetch: this.#fetch,
            cache: this.#cache,
            requestTimeoutMs: this.#requestTimeoutMs,
            maxPayloadBytes: this.#maxPayloadBytes,
        });
        const generated = this.#generated
            ? await this.#generated.OpenTarget(source.target, source.build, {
                game: source.game,
                provider: source.provider,
                buildRef: source.buildRef,
                client: source.client,
            })
            : [];

        if (!this.#overlays && generated.length === 0)
        {
            return source;
        }

        const inherited = [];

        for (const overlaySource of this.#overlays
            ? target.overlaySources
            : [])
        {
            const candidates = await this.#overlays.OpenTarget(
                overlaySource.target,
                source.build,
                {
                    game: source.game,
                    buildRef: source.buildRef,
                    client: source.client,
                    names: overlaySource.names,
                },
            );
            const names = new Set(overlaySource.names);

            inherited.push(...candidates.filter(overlay => names.has(overlay.name)));
        }

        const native = this.#overlays
            ? await this.#overlays.OpenTarget(source.target, source.build, {
                game: source.game,
                provider: source.provider,
                buildRef: source.buildRef,
                client: source.client,
            })
            : [];
        const overlaysByName = new Map();

        // Explicit inherited fallbacks are composed first. A target-local
        // overlay of the same name remains authoritative.
        for (const overlay of [ ...generated, ...inherited, ...native ])
        {
            overlaysByName.set(overlay.name, overlay);
        }
        const overlays = [ ...overlaysByName.values() ];

        return overlays.length
            ? new CjsToolIndexOverlaySource({ source, overlays })
            : source;
    }

    /** Installs one hash-safe generated index group for an exact target build. */
    async InstallGeneratedIndex(options = {})
    {
        if (!this.#generated)
        {
            throw new Error(
                "Generated indexes require a configured shared cache",
            );
        }

        const target = this.#targets.Get(options.target);

        return this.#generated.Install({
            ...options,
            target: target.id,
            game: target.game,
            provider: target.provider,
        });
    }

    /**
     * Coordinates exact-build index normalize source options behavior against
     * current immutable source evidence.
     */
    #NormalizeSourceOptions(options)
    {
        if (options.target === undefined || options.target === null)
        {
            throw new TypeError("Index operations require target; game and provider are metadata only");
        }

        const profile = this.#profiles.Get(options.target);
        const publicTarget = this.#targets.List()
            .find(candidate => candidate.id === profile.target) ?? null;

        if (options.game !== undefined
            && String(options.game).trim().toLowerCase() !== profile.game.toLowerCase())
        {
            throw new Error(`Target ${profile.target} does not use game ${options.game}`);
        }
        if (options.provider !== undefined
            && String(options.provider).trim().toLowerCase() !== profile.provider)
        {
            throw new Error(`Target ${profile.target} does not use provider ${options.provider}`);
        }

        return {
            ...options,
            target: profile.target,
            game: profile.game,
            provider: profile.provider,
            client: options.client ?? publicTarget?.client,
        };
    }

}
