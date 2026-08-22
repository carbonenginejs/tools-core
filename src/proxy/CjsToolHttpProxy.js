import fs from "node:fs/promises";
import http from "node:http";

import { ESI_COMPATIBILITY_DATE } from "../auth/CjsToolEsiCompatibilityDate.js";
import { CjsToolEveSso } from "../auth/CjsToolEveSso.js";
import { CjsToolBlack } from "../black/CjsToolBlack.js";
import { CjsToolIndexAnswerCatalog } from "../indexing/CjsToolIndexAnswerCatalog.js";
import { CjsToolSkin } from "../skin/CjsToolSkin.js";
import { CjsToolSkinrPattern } from "../skin/CjsToolSkinrPattern.js";
import { CjsToolWeapon } from "../weapon/CjsToolWeapon.js";
import { CjsToolMap } from "../map/CjsToolMap.js";
import { CjsToolDogma, DOGMA_SECTIONS, NormalizeTypeID } from "../dogma/CjsToolDogma.js";
import { CjsToolDogmaProfile } from "../dogma/CjsToolDogmaProfile.js";
import { CjsToolIndustry } from "../industry/CjsToolIndustry.js";
import { CjsToolIcons } from "../icons/CjsToolIcons.js";
import { CjsToolTypes } from "../types/CjsToolTypes.js";
import { CjsToolFitting } from "../fitting/CjsToolFitting.js";
import { CjsToolSkills } from "../skills/CjsToolSkills.js";
import { FITTING_SLOTS } from "../fitting/CjsToolFittingCodec.js";
import { CjsToolLocalisation, ReadGuessedNames, ReadManualNames } from "../localisation/CjsToolLocalisation.js";
import { ReadDerivation } from "../sde/CjsToolSdeDerivations.js";
import * as utils from "../utils.js";

export const TOOLS_SERVICE_PROTOCOL = "carbon.tools";
export const TOOLS_SERVICE_PROTOCOL_VERSION = 1;
/**
 * Who may read these answers from a browser.
 *
 * `*` is the right default for what this normally is: a tool on a developer's
 * own machine, answering a page served from a different port, where every
 * request is cross-origin by construction and there is nothing to protect.
 *
 * It is the wrong answer for the one place this is also deployed — a public
 * droplet behind a public site, where `*` invites any page anywhere to pull
 * EVE resources through it, on its bandwidth and its warmed cache. There the
 * origin is set to the site's own, and the site's own pages do not need it at
 * all, since they are same-origin and never consult CORS.
 *
 * `CJS_TOOL_ALLOW_ORIGIN=none` omits the headers entirely. Worth saying
 * plainly: none of this is access control. It governs what a *browser* lets a
 * page read and stops nothing that is not a browser, so it is an
 * advertisement, not a lock — rate limiting is the part that protects the
 * service.
 */
const ALLOW_ORIGIN = process.env.CJS_TOOL_ALLOW_ORIGIN ?? "*";

/**
 * The longest a browser or CDN may hold a market answer, in seconds.
 *
 * Not the same as how long this service holds one, which is ESI's window and is
 * often much longer — price history expires when CCP recomputes it, which
 * measured at nine and a half hours away. Passing that through as `max-age`
 * meant a reader could not refresh a page and get anything different for most
 * of a day.
 *
 * A minute costs nothing upstream, because a client re-asking is answered from
 * the copy this service is already holding. CCP sees the same number of
 * requests either way.
 */
const MARKET_MAX_PUBLIC_AGE_SECONDS = 60;

// Spread into three responses, so an empty object is how "send none" is said —
// there is no branch at the call sites to keep in step.
const CORS_HEADERS = ALLOW_ORIGIN === "none" ? Object.freeze({}) : Object.freeze({
    "access-control-allow-origin": ALLOW_ORIGIN,
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": [
        "Accept",
        "Accept-Language",
        "Content-Type",
        "If-None-Match",
        "Range",
    ].join(", "),
    "access-control-allow-private-network": "true",
    "access-control-expose-headers": [
        "Accept-Ranges",
        "Content-Language",
        "Content-Range",
        "X-Carbon-Answer",
        "X-Carbon-Target",
        "X-Carbon-Game",
        "X-Carbon-Provider",
        "X-Carbon-Build",
        "X-Carbon-Client",
        "X-Carbon-Logical-Path",
        "X-Carbon-Artifact-Kind",
        "X-Carbon-Overlay",
        "X-Carbon-Storage-Kind",
        "X-Carbon-SOF-Hull",
        "X-Carbon-Respath-Insert",
        "X-Carbon-Audio-Media-ID",
        "X-Carbon-Audio-Path",
        "X-Carbon-Music-Playlist",
        "X-Carbon-Music-Song",
        "ETag",
    ].join(", "),
});

/** Minimal optional HTTP adapter over exact-build tool services. */
export class CjsToolHttpProxy
{

    #answerCatalogs;

    #targetSources;

    #sofCatalogs;

    #skinLibraries;

    #weaponLibraries;

    #maps;

    #dogmas;

    #types;

    #icons;

    #industries;

    #localisations;

    #fittings;

    #skills;

    /** Creates a versioned loopback adapter over optional resource and SOF services. */
    constructor({
        indexes = null,
        sof = null,
        sde = null,
        skinrStore = null,
        plexRate = null,
        market = null,
        identity = null,
        characters = null,
        audio = null,
        auth = null,
        maxRequestBytes = 1024 * 1024,
    } = {})
    {
        if (indexes !== null && typeof indexes.Open !== "function")
        {
            throw new TypeError("CjsToolHttpProxy indexes must provide Open(options)");
        }

        if (sof !== null && typeof sof.OpenSource !== "function")
        {
            throw new TypeError(
                "CjsToolHttpProxy SOF service must provide OpenSource(source)",
            );
        }

        if (sof !== null && (indexes === null
            || typeof indexes.OpenTarget !== "function"))
        {
            throw new TypeError(
                "CjsToolHttpProxy SOF service requires target index acquisition",
            );
        }

        if (sde !== null && typeof sde.OpenTarget !== "function")
        {
            throw new TypeError("CjsToolHttpProxy SDE service must provide OpenTarget(target, build)");
        }

        if (characters !== null && typeof characters.OpenTarget !== "function")
        {
            throw new TypeError("CjsToolHttpProxy character service must provide OpenTarget(target, build)");
        }

        if (audio !== null && typeof audio.OpenTarget !== "function")
        {
            throw new TypeError("CjsToolHttpProxy audio service must provide OpenTarget(target, build)");
        }

        if (skinrStore !== null && typeof skinrStore.ListCards !== "function")
        {
            throw new TypeError("CjsToolHttpProxy SKINR store must provide ListCards()");
        }

        if (plexRate !== null && typeof plexRate.Read !== "function")
        {
            throw new TypeError("CjsToolHttpProxy PLEX rate must provide Read()");
        }

        if (market !== null && typeof market.Orders !== "function")
        {
            throw new TypeError("CjsToolHttpProxy market service must provide Orders()");
        }

        if (identity !== null && typeof identity.Character !== "function")
        {
            throw new TypeError("CjsToolHttpProxy identity service must provide Character()");
        }

        if (auth !== null
            && (typeof auth.sso?.BeginLogin !== "function"
                || typeof auth.sso?.CompleteLogin !== "function"
                || typeof auth.tokens?.Write !== "function"))
        {
            throw new TypeError(
                "CjsToolHttpProxy auth requires { sso: CjsToolEveSso, tokens: CjsToolTokenFile }",
            );
        }

        if (indexes === null && sof === null && sde === null
            && characters === null && audio === null)
        {
            throw new TypeError(
                "CjsToolHttpProxy requires an index, SOF, SDE, character, or audio service"
            );
        }

        if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1)
        {
            throw new TypeError("CjsToolHttpProxy maxRequestBytes must be a positive integer");
        }

        this.indexes = indexes;
        this.sof = sof;
        this.sde = sde;
        // A harvested store, injected rather than opened here: this class does no
        // file discovery, and a service without a harvest simply answers 501.
        this.skinrStore = skinrStore;
        // A live market reading, injected like every other service here.
        this.plexRate = plexRate;
        // Regional order books and price history.
        this.market = market;
        // Public character identity: names and affiliation, no scope needed.
        this.identity = identity;
        this.characters = characters;
        this.audio = audio;
        this.auth = auth;
        this.maxRequestBytes = maxRequestBytes;
        this.#answerCatalogs = new Map();
        this.#targetSources = new Map();
        this.#sofCatalogs = new Map();
        this.#skinLibraries = new Map();
        this.#weaponLibraries = new Map();
        this.#maps = new Map();
        this.#dogmas = new Map();
        this.#types = new Map();
        this.#icons = new Map();
        this.#industries = new Map();
        this.#localisations = new Map();
        this.#fittings = new Map();
        this.#skills = new Map();
        this.capabilities = Object.freeze({
            resources: indexes !== null,
            audio: audio !== null,
            character: characters !== null,
            sde: sde !== null,
            dna: sde !== null,
            skin: sde !== null,
            skinr: sde !== null,
            skinrStore: skinrStore !== null,
            plexRate: plexRate !== null,
            market: market !== null,
            identity: identity !== null,
            weapons: sde !== null,
            icons: sde !== null,
            map: sde !== null,
            dogma: sde !== null,
            industry: sde !== null,
            fitting: sde !== null,
            skills: sde !== null,
            sofCatalog: sof !== null,
            auth: auth !== null,
        });
        Object.freeze(this);
    }

    /** Creates, but does not start, a Node HTTP server for this adapter. */
    CreateServer()
    {
        return http.createServer((request, response) =>
        {
            this.Handle(request, response).catch(error =>
            {
                WriteError(response, error);
            });
        });
    }

    /** Handles one local tools-core HTTP request. */
    async Handle(request, response)
    {
        const url = new URL(request.url || "/", "http://tools-core.local");

        if (!IsLoopback(request.socket?.remoteAddress))
        {
            WriteJson(response, 403, { error: "Loopback connections only" });

            return;
        }

        if (request.method === "OPTIONS")
        {
            WriteEmpty(response, 204, {
                "access-control-max-age": "600",
            });

            return;
        }

        if (request.method === "GET" && url.pathname === "/v1/health")
        {
            WriteJson(response, 200, {
                ok: true,
                service: "@carbonenginejs/tools-core",
                protocol: TOOLS_SERVICE_PROTOCOL,
                protocolVersion: TOOLS_SERVICE_PROTOCOL_VERSION,
                capabilities: this.capabilities,
                // The ESI pin this service talks to CCP with.
                //
                // Reported so a consumer that also calls ESI can agree with us
                // rather than declaring its own: the failure it prevents is
                // silent and total - a date in the FUTURE is rejected on every
                // route, and this package shipped one for weeks without
                // resolving a single name.
                esiCompatibilityDate: ESI_COMPATIBILITY_DATE,
            });

            return;
        }

        if (request.method === "GET" && url.pathname.startsWith("/v1/auth/esi/"))
        {
            await this.#HandleEsiAuthRoute(url, response);

            return;
        }

        // Harvested SKINR designs and listings.
        //
        // Under `/v1/` rather than a target route because neither is
        // build-scoped: a design exists independently of any client build, and a
        // listing is an observation with its own timestamp. And deliberately
        // UNAUTHENTICATED - the harvest already spent this service's own token,
        // which is the whole point of harvesting rather than proxying. If a
        // public read here ever demands a visitor's token, the layering has gone
        // wrong.
        if (request.method === "GET" && url.pathname.startsWith("/v1/skinr"))
        {
            await this.#HandleSkinrStoreRoute(url, response);

            return;
        }

        // Who somebody is, from what a reader typed.
        //
        // The route beneath this one answers when you already have an id. This
        // one answers when what you have is a NAME, which is the question every
        // "who am I flying for" field actually asks - and the reason it belongs
        // here rather than in each consumer is that the two hard parts are not
        // obvious: `/universe/ids` matches case-sensitively, and an id is just a
        // number so only its category says what kind of thing it is.
        if (request.method === "GET" && url.pathname === "/v1/identity/resolve")
        {
            if (!this.identity)
            {
                WriteJson(response, 501, { error: "No identity service configured" });

                return;
            }

            const term = url.searchParams.get("q") ?? "";
            const kind = url.searchParams.get("kind") ?? "";

            let answer = null;

            try
            {
                answer = await this.identity.Resolve({ term, kind });
            }
            catch (error)
            {
                // An unknown kind is the caller's mistake, and saying so is more
                // use than a 502 that blames CCP.
                if (error instanceof TypeError)
                {
                    WriteJson(response, 400, { error: error.message });

                    return;
                }

                throw error;
            }

            if (!answer)
            {
                // Nothing of that kind is called that. A 404 rather than an empty
                // record, so a consumer cannot mistake "no such pilot" for "a
                // pilot with no name".
                WriteJson(response, 404, { error: `No ${kind} matches`, kind, term });

                return;
            }

            WriteJson(response, 200, answer);

            return;
        }

        // Public character identity. Under `/v1/` for the same reason as the
        // SKINR store: who somebody is has nothing to do with a client build.
        if (request.method === "GET" && url.pathname.startsWith("/v1/identity/characters/"))
        {
            if (!this.identity)
            {
                WriteJson(response, 501, { error: "No identity service configured" });

                return;
            }

            const id = url.pathname.slice("/v1/identity/characters/".length);

            if (!/^\d+$/u.test(id))
            {
                throw new TypeError(`Malformed character id: ${id.slice(0, 32)}`);
            }

            const answer = await this.identity.Character(id);

            if (!answer)
            {
                // The id resolved to something that is not a character. Not an
                // outage, and not an empty character - a different thing entirely.
                WriteJson(response, 404, { error: `Not a character: ${id}` });

                return;
            }

            WriteJson(response, 200, answer);

            return;
        }

        // The regional order book, and what a type has been trading at.
        //
        // Under `/v1/` for the same reason as the PLEX price: a live market
        // figure is not an attribute of a client build. What a type costs today
        // has nothing to do with which files the client shipped with.
        if (request.method === "GET"
            && (url.pathname === "/v1/market/orders" || url.pathname === "/v1/market/history"))
        {
            if (!this.market)
            {
                WriteJson(response, 501, { error: "No market service configured" });

                return;
            }

            const asking = {
                regionID: url.searchParams.get("region"),
                typeID: url.searchParams.get("type"),
            };

            let answer = null;

            try
            {
                answer = url.pathname.endsWith("history")
                    ? await this.market.History(asking)
                    : await this.market.Orders(asking);
            }
            catch (error)
            {
                // A missing or malformed region or type is the caller's
                // mistake, and saying so beats a 502 that blames CCP.
                if (error instanceof TypeError)
                {
                    WriteJson(response, 400, { error: error.message });

                    return;
                }

                throw error;
            }

            // Two different questions, deliberately given two different answers.
            //
            // How long THIS SERVICE holds an answer is ESI's to decide, and it
            // is held for the full window: asking CCP again before their expiry
            // cannot produce anything newer, because the same cached document
            // comes back.
            //
            // How long a BROWSER OR CDN may hold it is ours, and it is capped
            // low. Passing ESI's window straight through looked right on the
            // order book, where it is minutes, and was wrong on history, where
            // it is most of a day - measured at `max-age=34708`, which is nine
            // and a half hours of a reader being unable to refresh a page and
            // get anything different (operator, 2026-08-22).
            //
            // The cap costs nothing upstream. A client re-asking every minute
            // is answered from the copy this service is already holding, so
            // CCP sees exactly as many requests either way; all that changes is
            // how quickly a reader can see a new answer once there is one.
            const remaining = Math.max(0, Math.floor((Date.parse(answer.expiresAt) - Date.now()) / 1000));
            const age = Math.min(MARKET_MAX_PUBLIC_AGE_SECONDS, remaining);

            WriteJson(response, 200, answer, { "cache-control": `public, max-age=${age}` });

            return;
        }

        // The PLEX reference price. Under `/v1/` because a live market figure is
        // not an attribute of a client build - putting it on a build route would
        // make it cacheable-forever alongside resources that genuinely are.
        if (request.method === "GET" && url.pathname === "/v1/market/plex")
        {
            if (!this.plexRate)
            {
                WriteJson(response, 501, { error: "No market rate service configured" });

                return;
            }

            const rate = await this.plexRate.Read();

            if (!rate)
            {
                // Never read, and the refresh failed. Not zero, and not a
                // guessed rate: a consumer must be able to tell "we do not know"
                // from "it is worth this much".
                WriteJson(response, 503, { error: "PLEX price is not available yet" });

                return;
            }

            // Cacheable for what is left of the reading's life.
            //
            // The service already refreshes hourly and hands every caller the
            // same reading, but each page load still asked for it — so a busy
            // hour was thousands of requests for one number that changed once.
            // Told how long it stays true, a browser and the CDN in front of it
            // stop asking, and the figure they hold is the same one the service
            // would have answered with.
            //
            // The REMAINING life, not the full hour: a reading taken 59 minutes
            // ago is nearly stale, and caching it for another hour would show a
            // two-hour-old rate as current. `observedAt` is on the answer either
            // way, so a consumer can always see how old it is.
            const age = Math.max(0, Math.floor((Date.now() - Date.parse(rate.observedAt)) / 1000));
            const remaining = Math.max(60, (rate.ttlSeconds ?? 3600) - age);

            WriteJson(response, 200, rate, { "cache-control": `public, max-age=${remaining}` });

            return;
        }

        if (request.method === "GET" && url.pathname === "/targets")
        {
            if (!this.indexes || typeof this.indexes.ListTargets !== "function")
            {
                WriteJson(response, 501, { error: "Target service is not configured" });

                return;
            }

            WriteJson(response, 200, { targets: this.indexes.ListTargets() });

            return;
        }

        // `/{target}/metadata` — the target-shaped form of the clients route.
        //
        // A target is the identity; provider, game and client are things it has.
        // Addressing by `game + provider` needed two keys to reach one answer,
        // and separated the four targets only by accident: Eve+ccp,
        // Frontier+ccp, Eve+serenity and Eve+infinity happen to be distinct
        // pairs, and nothing enforced that they would stay so.
        const metadataRoute = MatchMetadataRoute(url.pathname);

        if (request.method === "GET" && metadataRoute)
        {
            if (!this.indexes || typeof this.indexes.DescribeTarget !== "function")
            {
                WriteJson(response, 501, { error: "Target service is not configured" });

                return;
            }

            try
            {
                WriteJson(response, 200, await this.indexes.DescribeTarget(metadataRoute.target));
            }
            catch (error)
            {
                WriteJson(response, error.code === "CJS_TOOL_TARGET_UNKNOWN" ? 404 : 500, {
                    error: error.message,
                });
            }

            return;
        }

        let targetRoute = AppendSofDnaSearch(
            MatchTargetRoute(url.pathname),
            url.search,
        );

        if ([ "GET", "HEAD" ].includes(request.method)
            && targetRoute?.topic === "audio")
        {
            await this.#HandleAudioRoute(request, targetRoute, response);

            return;
        }

        if (request.method === "GET" && targetRoute)
        {
            if (targetRoute.topic === "resources")
            {
                const catalog = await this.#GetIndexAnswerCatalog(
                    targetRoute.target,
                    targetRoute.build,
                );
                const resource = catalog.DescribeResourcePath(targetRoute.path ?? "");

                if (resource.type === "directory")
                {
                    WriteJson(
                        response,
                        200,
                        resource,
                        CreateAnswerHeaders(catalog, "resource"),
                    );

                    return;
                }

                targetRoute = Object.freeze({ ...targetRoute, topic: "res" });
            }

            if (targetRoute.topic === "sof")
            {
                await this.#HandleSofIndexAnswerRoute(request, targetRoute, response);

                return;
            }

            if ([ "billboards", "cubes", "nebulas", "resfiles" ]
                .includes(targetRoute.topic))
            {
                await this.#HandleIndexAnswerRoute(targetRoute, response);

                return;
            }

            if (targetRoute.topic === "sde")
            {
                await this.#HandleSdeRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "dna")
            {
                await this.#HandleDnaRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "map")
            {
                await this.#HandleMapRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "types")
            {
                await this.#HandleTypesRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "icons")
            {
                await this.#HandleIconsRoute(targetRoute, response);

                return;
            }

            if (targetRoute.topic === "dogma")
            {
                await this.#HandleDogmaRoute(targetRoute, url, null, response);

                return;
            }

            if (targetRoute.topic === "industry")
            {
                await this.#HandleIndustryRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "fitting")
            {
                await this.#HandleFittingRoute(targetRoute, url, null, response);

                return;
            }

            if (targetRoute.topic === "skills")
            {
                await this.#HandleSkillsRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "character")
            {
                await this.#HandleCharacterRoute(targetRoute, url, response);

                return;
            }

            // Before the generic library lookup: `skinr/pattern/<id>` generates
            // rather than reading a record, and would otherwise be reported as
            // a missing skinr record named "pattern/<id>".
            if (targetRoute.topic === "skinr"
                && String(targetRoute.path ?? "").toLowerCase().startsWith("pattern/"))
            {
                await this.#HandleSkinrPatternByIdRoute(targetRoute, response);

                return;
            }

            if ([ "skin", "skinr" ].includes(targetRoute.topic))
            {
                await this.#HandleSkinRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "weapons")
            {
                await this.#HandleWeaponRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "resource")
            {
                const catalog = await this.#GetIndexAnswerCatalog(
                    targetRoute.target,
                    targetRoute.build,
                );

                WriteJson(
                    response,
                    200,
                    catalog.DescribeResourcePath(targetRoute.path ?? ""),
                    CreateAnswerHeaders(catalog, "resource"),
                );

                return;
            }

            if (targetRoute.topic === "res"
                && String(targetRoute.path ?? "").toLowerCase() === "resfiles")
            {
                await this.#HandleIndexAnswerRoute({
                    ...targetRoute,
                    topic: "resfiles",
                    path: null,
                }, response);

                return;
            }

            if (!this.indexes || typeof this.indexes.ResolveTargetBuild !== "function")
            {
                WriteJson(response, 501, { error: "Target service is not configured" });

                return;
            }

            if (targetRoute.topic === null || targetRoute.topic === "build")
            {
                // `?client=` picks between the clients a provider publishes —
                // tranquility or singularity on the `eve` target, serenity or
                // infinity on theirs. Without passing it through, this
                // route answered every client with the target's default and
                // said so in the response, which is worse than refusing: a
                // caller asking for singularity was told it had singularity
                // and handed tranquility's build.
                WriteJson(response, 200, await this.#ResolveBuilds(
                    targetRoute.target,
                    targetRoute.build,
                    url.searchParams.get("client") ?? undefined,
                ));

                return;
            }

            if ([ "app", "res" ].includes(targetRoute.topic))
            {
                if (!targetRoute.path)
                {
                    const build = await this.indexes.ResolveTargetBuild(
                        targetRoute.target,
                        targetRoute.build,
                    );

                    WriteJson(response, 200, {
                        ...build,
                        topic: targetRoute.topic,
                        logicalRoot: `${targetRoute.topic}:/`,
                        resourcePathTemplate:
                            `/${targetRoute.target}/${build.build}/${targetRoute.topic}/{path}`,
                    });

                    return;
                }

                if (typeof this.indexes.OpenTarget !== "function")
                {
                    WriteJson(response, 501, { error: "Target resource service is not configured" });

                    return;
                }

                const source = await this.#OpenTargetSource(
                    targetRoute.target,
                    targetRoute.build,
                );
                const refresh = url.searchParams.get("refresh") === "true";
                const file = await source.Fetch(`${targetRoute.topic}:/${targetRoute.path}`, {
                    indexName: url.searchParams.get("index") ?? undefined,
                    refresh,
                });
                const format = url.searchParams.get("format");
                const headers = {
                    "x-carbon-target": targetRoute.target,
                    "x-carbon-game": file.resolution.game,
                    "x-carbon-provider": file.resolution.provider,
                    "x-carbon-build": file.resolution.build,
                    "x-carbon-logical-path": file.resolution.logicalPath,
                    ...(file.resolution.artifactKind ? {
                        "x-carbon-artifact-kind": file.resolution.artifactKind,
                    } : {}),
                    ...(file.resolution.overlay ? {
                        "x-carbon-overlay": file.resolution.overlay,
                        "x-carbon-storage-kind": file.resolution.storageKind,
                    } : {}),
                    ...(format === null
                        ? CreateResourceCacheHeaders(targetRoute.build, file.resolution, refresh)
                        : {}),
                };

                if (format === "json")
                {
                    WriteJson(response, 200, ReadFormatJson(targetRoute.path, file.bytes), headers);

                    return;
                }

                if (format !== null)
                {
                    WriteJson(response, 400, { error: `Unsupported format: ${format}` });

                    return;
                }

                if (IsNotModified(request, headers.etag))
                {
                    WriteEmpty(response, 304, headers);

                    return;
                }

                WriteBytes(response, 200, file.bytes, headers);

                return;
            }

            // An unknown topic on an unknown target is not an unconfigured
            // topic, it is a path that means nothing. Reported as 404 so a
            // leftover URL from a removed route family — which parses as
            // target "games", topic "providers" — reads as gone rather than as
            // a service this build happens not to have.
            const known = typeof this.indexes?.ListTargets === "function"
                ? this.indexes.ListTargets().some(entry => entry.id === targetRoute.target)
                : true;

            if (!known)
            {
                WriteJson(response, 404, { error: `Unknown target "${targetRoute.target}"` });

                return;
            }

            WriteJson(response, 501, {
                error: `Target topic is not configured: ${targetRoute.topic}`,
                target: targetRoute.target,
                build: targetRoute.build,
                topic: targetRoute.topic,
            });

            return;
        }

        if (request.method === "POST"
            && targetRoute?.topic === "skinr"
            && String(targetRoute.path ?? "").toLowerCase() === "pattern")
        {
            await this.#HandleSkinrPatternRoute(request, targetRoute, response);

            return;
        }

        // Evaluation is a POST because a complete skill map is thousands of
        // characters and does not belong in a query string. It mutates nothing:
        // the same body always answers the same way for a given build.
        if (request.method === "POST" && targetRoute?.topic === "dogma")
        {
            const body = await ReadJson(request, this.maxRequestBytes);

            await this.#HandleDogmaRoute(targetRoute, url, body ?? {}, response);

            return;
        }

        // A fit is pasted, so it arrives as a body: EFT text is multi-line and
        // a chat link carries angle brackets, neither of which belongs in a
        // query string. Nothing is stored - the same text always parses the
        // same way for a given build.
        if (request.method === "POST" && targetRoute?.topic === "fitting")
        {
            const body = await ReadJson(request, this.maxRequestBytes);

            await this.#HandleFittingRoute(targetRoute, url, body ?? {}, response);

            return;
        }

        // A long plan does not fit a query string, and a caller assembling one
        // from a fitting has dozens of ids.
        if (request.method === "POST" && targetRoute?.topic === "skills")
        {
            const body = await ReadJson(request, this.maxRequestBytes);

            await this.#HandleSkillsRoute(targetRoute, url, response, body ?? {});

            return;
        }

        if (request.method === "POST" && targetRoute?.topic === "sof")
        {
            await this.#HandleSofIndexAnswerRoute(request, targetRoute, response);

            return;
        }

        if (request.method === "POST" && url.pathname === "/v1/resources/resolve")
        {
            if (!this.indexes)
            {
                WriteJson(response, 501, { error: "Resource service is not configured" });

                return;
            }

            const body = RequireResourceRequest(await ReadJson(request, this.maxRequestBytes));
            const source = await this.indexes.Open(body.source);
            const resolution = source.Resolve(body.logicalPath, body.options);

            WriteJson(response, 200, resolution);

            return;
        }

        if (request.method === "POST" && url.pathname === "/v1/resources/fetch")
        {
            if (!this.indexes)
            {
                WriteJson(response, 501, { error: "Resource service is not configured" });

                return;
            }

            const body = RequireResourceRequest(await ReadJson(request, this.maxRequestBytes));
            const source = await this.indexes.Open(body.source);
            const file = await source.Fetch(body.logicalPath, body.options);

            WriteJson(response, 200, {
                resolution: file.resolution,
                byteLength: file.byteLength,
                cacheHit: file.cacheHit,
                cachePath: file.cachePath,
            });

            return;
        }

        WriteJson(response, 404, { error: "Not found" });
    }

    /** Serves exact-build audio libraries and selected media bytes. */
    async #HandleAudioRoute(request, route, response)
    {
        if (!this.audio)
        {
            WriteJson(response, 501, { error: "Audio service is not configured" });

            return;
        }

        const audioRequest = ParseAudioRequest(
            route.path,
            route.encodedPath,
        );

        if (audioRequest.kind.startsWith("music"))
        {
            const audio = typeof this.audio.OpenMusicTarget === "function"
                ? await this.audio.OpenMusicTarget(
                    route.target,
                    route.build,
                )
                : await this.audio.OpenTarget(route.target, route.build);

            await this.#HandleMusicRoute(
                request,
                route,
                audioRequest,
                audio,
                response,
            );

            return;
        }

        const audio = await this.audio.OpenTarget(route.target, route.build);

        if (audioRequest.kind === "library")
        {
            const library = audio.library;
            const etag = library?.generatedAt
                ? `W/"audio-library-${route.build}-${library.generatedAt}"`
                : undefined;
            const headers = {
                "cache-control": utils.isExactBuild(route.build)
                    ? "public, max-age=31536000, immutable"
                    : "public, max-age=300, must-revalidate",
                ...(etag === undefined ? {} : { etag }),
            };

            if (IsNotModified(request, etag))
            {
                WriteEmpty(response, 304, headers);

                return;
            }

            if (request.method === "HEAD")
            {
                WriteHead(response, 200, {
                    ...headers,
                    "content-type": "application/json; charset=utf-8",
                });

                return;
            }

            WriteJson(response, 200, library.GetValues(), headers);

            return;
        }

        const mediaTypes = ParseAcceptHeader(request.headers.accept);
        const selection = audioRequest.kind === "id"
            ? audio.ResolveMediaByID(audioRequest.value, {
                mediaTypes,
                languages: ParseAcceptLanguageHeader(
                    request.headers["accept-language"],
                ),
            })
            : audio.ResolveMediaByPath(audioRequest.value, { mediaTypes });
        const range = ParseByteRange(
            request.headers.range,
            selection.totalByteLength,
        );
        let headers = CreateAudioHeaders(
            audio,
            route,
            audioRequest,
            selection,
            range,
        );

        if (IsNotModified(request, selection.etag))
        {
            WriteEmpty(response, 304, headers);

            return;
        }

        const statusCode = range ? 206 : 200;

        if (request.method === "HEAD")
        {
            WriteHead(response, statusCode, headers);

            return;
        }

        const result = await audio.Read(selection, range ?? {});

        if (headers["content-length"] === undefined)
        {
            headers = {
                ...headers,
                "content-length": result.byteLength,
            };
        }

        WriteBytes(response, statusCode, result.bytes, headers);
    }

    /** Serves the optional neutral music catalog and cataloged song bytes. */
    async #HandleMusicRoute(request, route, musicRequest, audio, response)
    {
        const music = audio.music;

        if (!music)
        {
            WriteJson(
                response,
                404,
                { error: "Music library is not configured" },
            );

            return;
        }

        const sourceTarget = String(
            audio.sourceTarget || route.target,
        );
        const sourceBuild = utils.normalizeExactBuild(
            audio.sourceBuild || route.build,
            {
                message:
                    "Music routes require a resolved exact source build",
            },
        );
        const baseUrl = `${GetRequestOrigin(request)}`
            + `/${encodeURIComponent(sourceTarget)}`
            + `/${encodeURIComponent(sourceBuild)}/audio/music`;
        const urlForPlaylist = playlistID =>
            `${baseUrl}/playlists/${encodeURIComponent(playlistID)}`;
        const urlForSong = (playlistID, songID) =>
            `${urlForPlaylist(playlistID)}/songs/${encodeURIComponent(songID)}`;

        if (musicRequest.kind === "music")
        {
            const library = await music.ListPlaylists({ urlForPlaylist });

            if (request.method === "HEAD")
            {
                WriteHead(response, 200, {
                    "content-type": "application/json; charset=utf-8",
                });

                return;
            }

            WriteJson(
                response,
                200,
                library,
            );

            return;
        }

        if (musicRequest.kind === "music-library")
        {
            const library = await music.GetLibrary({ urlForSong });

            if (request.method === "HEAD")
            {
                WriteHead(response, 200, {
                    "content-type": "application/json; charset=utf-8",
                });

                return;
            }

            WriteJson(
                response,
                200,
                library,
            );

            return;
        }

        if (musicRequest.kind === "music-playlist")
        {
            const playlist = await music.GetPlaylist(
                musicRequest.playlistID,
                { urlForSong },
            );

            if (request.method === "HEAD")
            {
                WriteHead(response, 200, {
                    "content-type": "application/json; charset=utf-8",
                });

                return;
            }

            WriteJson(response, 200, playlist);
            return;
        }

        const selection = await music.ResolveSong(
            musicRequest.playlistID,
            musicRequest.songID,
        );
        const range = ParseByteRange(
            request.headers.range,
            selection.totalByteLength,
        );
        const statusCode = range ? 206 : 200;
        const headers = {
            "x-carbon-answer": "music-song",
            "x-carbon-target": audio.sourceTarget || route.target,
            "x-carbon-game": audio.sourceGame || "",
            "x-carbon-provider": audio.sourceProvider || "",
            "x-carbon-build": audio.sourceBuild || route.build,
            "x-carbon-music-playlist": selection.playlistID,
            "x-carbon-music-song": selection.songID,
            "content-type": selection.mediaType,
            "content-length":
                range?.byteLength ?? selection.totalByteLength,
            "accept-ranges": "bytes",
            "cache-control": "no-cache",
            ...(selection.etag ? { etag: selection.etag } : {}),
            ...(range ? {
                "content-range":
                    `bytes ${range.offset}-${range.end}/${selection.totalByteLength}`,
            } : {}),
        };

        if (IsNotModified(request, selection.etag))
        {
            const {
                "content-length": _contentLength,
                "content-range": _contentRange,
                ...notModifiedHeaders
            } = headers;

            WriteEmpty(response, 304, notModifiedHeaders);

            return;
        }

        if (request.method === "HEAD")
        {
            WriteHead(response, statusCode, headers);

            return;
        }

        const result = await music.ReadSong(
            selection,
            range ?? {},
        );

        WriteBytes(response, statusCode, result.bytes, headers);
    }

    /** Serves one derived index-answer catalog route. */
    async #HandleIndexAnswerRoute(route, response)
    {
        if (route.path)
        {
            WriteJson(response, 404, { error: `${route.topic} route not found` });

            return;
        }

        const catalog = await this.#GetIndexAnswerCatalog(route.target, route.build);
        let items;

        switch (route.topic)
        {
            case "billboards":
                items = catalog.ListBillboards();
                break;

            case "cubes":
                items = catalog.ListCubes();
                break;

            case "nebulas":
                items = catalog.ListNebulas();
                break;

            case "resfiles":
                items = catalog.ListResFiles();
                break;

            default:
                throw new Error(`Unsupported index answer: ${route.topic}`);
        }

        WriteJson(response, 200, items, CreateAnswerHeaders(catalog, route.topic));
    }

    /** Serves one SOF-derived index-answer route. */
    async #HandleSofIndexAnswerRoute(request, route, response)
    {
        const segments = String(route.path ?? "").split("/").filter(Boolean);

        if (request.method === "GET"
            && segments.length === 3
            && segments[0].toLowerCase() === "hulls"
            && segments[2].toLowerCase() === "respathinserts")
        {
            const hull = normalizeRouteSegment(segments[1]);
            const catalog = await this.#GetIndexAnswerCatalog(route.target, route.build);

            WriteJson(
                response,
                200,
                catalog.ListHullResPathInserts(hull),
                CreateAnswerHeaders(catalog, "respathinserts", { hull }),
            );

            return;
        }

        if (request.method === "GET"
            && segments.length === 3
            && segments[0].toLowerCase() === "hulls"
            && segments[2].toLowerCase() === "patterns")
        {
            const hull = RequireSofName(segments[1], "SOF hull");
            const catalog = await this.#GetSofCatalog(route.target, route.build);
            const patterns = catalog.ListHullPatterns(hull);
            const headers = CreateAnswerHeaders(catalog, "sof-hull-patterns", { hull });

            if (patterns === null)
            {
                WriteJson(response, 404, {
                    error: `SOF hull not found: ${hull}`,
                }, headers);

                return;
            }

            WriteJson(response, 200, patterns, headers);

            return;
        }

        if (request.method === "POST"
            && segments.length === 5
            && segments[0].toLowerCase() === "hulls"
            && segments[2].toLowerCase() === "respathinserts"
            && segments[4].toLowerCase() === "resolve")
        {
            const hull = normalizeRouteSegment(segments[1]);
            const insert = normalizeRouteSegment(segments[3]);
            const body = await ReadJson(request, this.maxRequestBytes);
            const catalog = await this.#GetIndexAnswerCatalog(route.target, route.build);

            WriteJson(
                response,
                200,
                catalog.ResolveHullResPathInserts(hull, insert, body.paths),
                CreateAnswerHeaders(catalog, "respathinserts-resolve", { hull, insert }),
            );

            return;
        }

        if (request.method !== "GET")
        {
            WriteJson(response, 404, { error: "SOF route not found" });

            return;
        }

        const topic = String(segments[0] ?? "").toLowerCase();

        if (topic === "dna")
        {
            const subTopic = segments.length === 3 ? String(segments[2]).toLowerCase() : "";

            // The selector is a path segment, not `?format=`: a SOF DNA route
            // folds its whole search string back into the DNA (see
            // AppendSofDnaSearch), so a query parameter would be read as part
            // of the DNA and the lookup would 404.
            if (segments.length < 2
                || segments.length > 3
                || (segments.length === 3 && subTopic !== "visibilitygroups"))
            {
                WriteJson(response, 400, { error: "Malformed SOF DNA route" });

                return;
            }

            const dna = RequireSofDna(segments[1]);
            const catalog = await this.#GetSofCatalog(route.target, route.build);
            const inspection = catalog.InspectDna(dna);
            const headers = CreateAnswerHeaders(
                catalog,
                subTopic === "visibilitygroups" ? "sof-dna-visibilitygroups" : "sof-dna",
            );

            if (!inspection?.buildable)
            {
                const statusCode = String(inspection?.error ?? "").startsWith("unknown-")
                    ? 404
                    : 400;

                WriteJson(response, statusCode, {
                    error: statusCode === 404
                        ? "SOF DNA selection was not found"
                        : "Malformed SOF DNA",
                }, headers);

                return;
            }

            if (!inspection.valid)
            {
                WriteJson(response, 400, { error: "Invalid SOF DNA content" }, headers);

                return;
            }

            if (subTopic === "visibilitygroups")
            {
                const groups = catalog.GetDnaVisibilityGroups(dna);

                if (groups === null)
                {
                    WriteJson(response, 404, {
                        error: "SOF DNA selection was not found",
                    }, headers);

                    return;
                }

                WriteJson(response, 200, groups, headers);

                return;
            }

            // Values are the only HTTP boundary: the answer is valid CjsModel
            // input, so a consumer rebuilds with `RootClass.from(values)` and
            // needs no document hydrator.
            const built = await catalog.BuildValuesAsync(dna);

            if (built === null)
            {
                WriteJson(response, 404, {
                    error: "SOF DNA selection could not be built",
                }, headers);

                return;
            }

            WriteJson(response, 200, built, headers);

            return;
        }

        const collectionMethods = {
            hulls: "ListHulls",
            factions: "ListFactions",
            races: "ListRaces",
            materials: "ListMaterials",
            layouts: "ListLayouts",
            patterns: "ListPatterns",
        };
        const detailMethods = {
            hulls: "GetHull",
            factions: "GetFaction",
            races: "GetRace",
            materials: "GetMaterial",
            layouts: "GetLayout",
        };

        // `?detail=true` returns the records rather than just their names.
        //
        // Every consumer that shows a collection needs the records: a browser
        // sorting materials by appearance, a picker grouping them by gloss, a
        // market view drawing a swatch. Without this each of them fetches the
        // name list and then one request per name — 1149 round trips for the
        // materials — to rebuild something this service already holds in memory.
        // The records are small and the answer is per exact build, so it is
        // immutable and cached like any other.
        if (segments.length === 1
            && Object.hasOwn(collectionMethods, topic)
            && Object.hasOwn(detailMethods, topic)
            && new URL(request.url, "http://tools-core.local")
                .searchParams.get("detail") === "true")
        {
            const catalog = await this.#GetSofCatalog(route.target, route.build);
            const records = {};

            for (const name of catalog[collectionMethods[topic]]())
            {
                records[name] = catalog[detailMethods[topic]](name);
            }

            WriteJson(response, 200, records, CreateAnswerHeaders(catalog, `sof-${topic}`));

            return;
        }

        if (segments.length === 1 && Object.hasOwn(collectionMethods, topic))
        {
            const catalog = await this.#GetSofCatalog(route.target, route.build);

            WriteJson(
                response,
                200,
                catalog[collectionMethods[topic]](),
                CreateAnswerHeaders(catalog, `sof-${topic}`),
            );

            return;
        }

        if (segments.length === 2 && Object.hasOwn(detailMethods, topic))
        {
            const name = RequireSofName(segments[1], `SOF ${topic.slice(0, -1)}`);
            const catalog = await this.#GetSofCatalog(route.target, route.build);
            const value = catalog[detailMethods[topic]](name);
            const headers = CreateAnswerHeaders(catalog, `sof-${topic}`, {
                ...(topic === "hulls" ? { hull: name } : {}),
            });

            if (value === null)
            {
                WriteJson(response, 404, {
                    error: `SOF ${topic.slice(0, -1)} not found: ${name}`,
                }, headers);

                return;
            }

            WriteJson(response, 200, value, headers);

            return;
        }

        if (segments.length === 4
            && topic === "patterns"
            && String(segments[2]).toLowerCase() === "hulls")
        {
            const pattern = RequireSofName(segments[1], "SOF pattern");
            const hull = RequireSofName(segments[3], "SOF hull");
            const catalog = await this.#GetSofCatalog(route.target, route.build);
            const value = catalog.GetPatternHull(pattern, hull);
            const headers = CreateAnswerHeaders(catalog, "sof-pattern-hull", { hull });

            if (value === null)
            {
                WriteJson(response, 404, {
                    error: `SOF pattern application not found: ${pattern}/${hull}`,
                }, headers);

                return;
            }

            WriteJson(response, 200, value, headers);

            return;
        }

        if (Object.hasOwn(collectionMethods, topic))
        {
            WriteJson(response, 400, { error: "Malformed SOF catalog route" });

            return;
        }

        WriteJson(response, 404, { error: "SOF index-answer route not found" });
    }

    /**
     * Resolves one build reference into the exact build of every data facet.
     *
     * "latest" is not one answer. This service serves two independently
     * published bodies of data, and they carry different build numbers: the
     * resource build, whose file index addresses every resource, comes from the
     * target's binaries metadata; the SDE, which backs the `sde`, `skin`,
     * `skinr`, and `weapons` topics, moves on a schedule of its own and
     * normally trails the resource build for a window after each patch.
     *
     * Reporting only one of them is what makes this dangerous, because the
     * number is indistinguishable from the other once a caller holds it. Carry
     * an SDE build onto a resource route and this service dutifully acquires a
     * whole second resource build — another file index, another `data.black`,
     * another SOF catalog, cold, beside the warm one. Carry a resource build
     * onto an SDE route and it goes looking for an SDE that may not exist.
     *
     * So the answer names both, and the caller pins each request to the facet
     * that serves it. There is deliberately no alias that collapses the two
     * back into one number: an alias would have to pick a loser, and pinning
     * resources to the SDE's build causes exactly the second-catalog problem it
     * would be trying to avoid. Later facets are added here, not worked around
     * by consumers.
     */
    async #ResolveBuilds(target, build, client = undefined)
    {
        const resources = await this.indexes.ResolveTargetBuild(target, build, { client });

        if (!this.sde || typeof this.sde.ResolveTargetBuild !== "function")
        {
            return {
                ...resources,
                builds: {
                    resources: resources.build,
                    resourcesReason: resources.reason ?? null,
                    observedLatest: resources.observedLatest ?? null,
                    sde: null,
                    // Distinguishable from "unreachable" and from "nothing
                    // prepared", which a bare null made identical.
                    sdeReason: "no-sde-service",
                },
            };
        }

        // The same reference, asked of the other facet — including a pinned
        // build, which is the common case. This does not check that an SDE
        // exists for it and must not: the SDE repository already answers a
        // build with no SDE of its own from the newest available one, and
        // reports the build that actually answered. Second-guessing that here
        // would replace a working fallback with a guess.
        // Every answer says why, including this one. The resolvers already
        // produce a reason - `source` on both, `borrowedFrom` on the SDE - and
        // this method used to discard all of it and `.catch(() => null)` the
        // rest, which made "unreachable", "nothing prepared" and "no SDE
        // service" one indistinguishable null.
        const sde = await this.sde
            // A lookup route reports what it can. If the SDE channel is
            // unreachable and nothing is prepared to fall back to, the resource
            // half of the answer is still true and still useful.
            .ResolveTargetBuild(target, build)
            .then(resolution =>
            {
                const clamped = ClampSdeBuild(resolution.build, resources.build);

                // `source` means two different things depending on who filled
                // it in: a reason token from the index resolver, and the URL it
                // read from in the SDE archive. A URL is not a reason, so it is
                // reported as one — `url` — and the reason names the channel.
                const url = IsUrl(resolution.source) ? resolution.source : null;

                return {
                    build: clamped,
                    url,
                    // Clamping is a decision about the answer, so it is named
                    // rather than left to be inferred from two numbers.
                    //
                    // `?? null` rather than leaving it undefined: an absent key
                    // serialises away, and a field that vanishes when nobody
                    // set it is exactly the silence this is meant to remove.
                    // Null says "no reason given", which is itself an answer.
                    reason: clamped === resolution.build
                        ? (url ? "latest-export-channel" : resolution.source ?? null)
                        : "clamped-to-resources",
                    borrowedFrom: resolution.borrowedFrom ?? null,
                    releaseDate: resolution.releaseDate ?? null,
                };
            })
            .catch(error => ({ build: null, reason: "unavailable", error: error?.message ?? String(error) }));

        return {
            ...resources,
            builds: {
                resources: resources.build,
                // The reason the resource half carries, from the policy layer.
                resourcesReason: resources.reason ?? null,
                observedLatest: resources.observedLatest ?? null,
                sde: sde.build,
                sdeReason: sde.reason,
                ...(sde.url ? { sdeSource: sde.url } : {}),
                ...(sde.borrowedFrom ? { sdeBorrowedFrom: sde.borrowedFrom } : {}),
                ...(sde.releaseDate ? { sdeReleased: sde.releaseDate } : {}),
                ...(sde.error ? { sdeError: sde.error } : {}),
            },
        };
    }

    /** Opens or reuses one exact-build SOF catalog. */
    async #GetSofCatalog(target, build)
    {
        if (!this.sof)
        {
            const error = new Error("SOF service is not configured");

            error.statusCode = 501;
            throw error;
        }

        const source = await this.#OpenTargetSource(target, build);
        const key = [
            source.target,
            source.game,
            source.provider,
            source.build,
            source.client ?? "",
        ].join("\0");
        let loading = this.#sofCatalogs.get(key);

        if (!loading)
        {
            loading = Promise.resolve().then(() => this.sof.OpenSource(source));
            this.#sofCatalogs.set(key, loading);
            RetainNewest(this.#sofCatalogs, 4);
            loading.catch(() =>
            {
                if (this.#sofCatalogs.get(key) === loading)
                {
                    this.#sofCatalogs.delete(key);
                }
            });
        }
        else
        {
            this.#sofCatalogs.delete(key);
            this.#sofCatalogs.set(key, loading);
        }

        return loading;
    }

    /** Opens or reuses one exact-build derived-answer catalog. */
    async #GetIndexAnswerCatalog(target, build)
    {
        if (!this.indexes || typeof this.indexes.OpenTarget !== "function")
        {
            const error = new Error("Target resource service is not configured");

            error.statusCode = 501;
            throw error;
        }

        const source = await this.#OpenTargetSource(target, build);
        const key = [
            source.target,
            source.game,
            source.provider,
            source.build,
        ].join("\0");
        let catalog = this.#answerCatalogs.get(key);

        if (!catalog)
        {
            catalog = new CjsToolIndexAnswerCatalog(source);
            this.#answerCatalogs.set(key, catalog);
        }

        return catalog;
    }

    /** Opens or reuses one resolved exact-build index source. */
    async #OpenTargetSource(target, build)
    {
        if (!this.indexes || typeof this.indexes.OpenTarget !== "function")
        {
            const error = new Error("Target resource service is not configured");

            error.statusCode = 501;
            throw error;
        }

        const resolution = typeof this.indexes.ResolveTargetBuild === "function"
            ? await this.indexes.ResolveTargetBuild(target, build)
            : null;
        const exactBuild = resolution?.build ?? build;
        const key = [
            target,
            resolution?.game ?? "",
            resolution?.provider ?? "",
            exactBuild,
            resolution?.client ?? "",
        ].join("\0");
        let loading = this.#targetSources.get(key);

        if (!loading)
        {
            loading = Promise.resolve().then(() => this.indexes.OpenTarget(
                target,
                exactBuild,
                { client: resolution?.client ?? undefined },
            ));
            this.#targetSources.set(key, loading);
            RetainNewest(this.#targetSources, 4);
            loading.catch(() =>
            {
                if (this.#targetSources.get(key) === loading)
                {
                    this.#targetSources.delete(key);
                }
            });
        }
        else
        {
            this.#targetSources.delete(key);
            this.#targetSources.set(key, loading);
        }

        return loading;
    }

    /** Serves the harvested SKINR store: cards, facets, and one design. */
    async #HandleSkinrStoreRoute(url, response)
    {
        if (!this.skinrStore)
        {
            WriteJson(response, 501, {
                error: "No harvested SKINR store; run: node bin/cjs-skinr-harvest.js",
            });

            return;
        }

        const segments = url.pathname.slice("/v1/skinr".length).split("/").filter(Boolean);
        const leaf = (segments[0] ?? "").toLowerCase();

        if (!segments.length)
        {
            WriteJson(response, 200, this.skinrStore.Describe());

            return;
        }

        if (leaf === "facets" && segments.length === 1)
        {
            WriteJson(response, 200, this.skinrStore.Facets());

            return;
        }

        if (leaf === "cards" && segments.length === 1)
        {
            const read = name => url.searchParams.get(name) ?? undefined;

            WriteJson(response, 200, this.skinrStore.ListCards({
                limit: read("limit"),
                offset: read("offset"),
                shipTypeId: read("shipTypeId"),
                tier: read("tier"),
                currency: read("currency"),
                state: read("state"),
                creatorId: read("creatorId"),
                search: read("search"),
                sort: read("sort"),
                // "asc" or "desc", against the KEY's own order rather than the
                // column's: descending recent is oldest first, descending price
                // is dearest first.
                direction: read("direction"),
                // Only `sort=random` reads it. A paging consumer sends the same
                // seed for every page so it sees one shuffle rather than a fresh
                // one per request, which would repeat and skip listings.
                seed: read("seed"),
            }));

            return;
        }

        if (leaf === "designs" && segments.length === 2)
        {
            // Normalized by default: tagged unions and arrays are the shape a
            // consumer should read. `?form=raw` answers with the design exactly
            // as ESI sent it, which is what the pattern generator takes.
            const raw = String(url.searchParams.get("form") ?? "").toLowerCase() === "raw";
            const answer = raw
                ? this.skinrStore.GetDesignPayload(segments[1])
                : this.skinrStore.GetDesign(segments[1]);

            if (!answer)
            {
                WriteJson(response, 404, { error: `SKINR design not harvested: ${segments[1]}` });

                return;
            }

            WriteJson(response, 200, answer);

            return;
        }

        if (leaf === "listings" && segments.length === 2)
        {
            WriteJson(response, 200, { listingId: segments[1], history: this.skinrStore.ListingHistory(segments[1]) });

            return;
        }

        WriteJson(response, 404, { error: "SKINR store route not found" });
    }

    /**
     * The DNA topic: a selection to the DNA it produces, and the inverse.
     *
     * Neither of these is a table lookup, which is why they are not under
     * `sde`. They read the same tables every other composed topic does, and a
     * consumer asking "what is this ship's DNA" should not have to know that
     * the answer happens to be derived from the SDE.
     */
    async #HandleDnaRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const segments = String(route.path ?? "").split("/").filter(Boolean);
        const verb = segments.length === 1 ? segments[0].toLowerCase() : null;

        if (verb !== "resolve" && verb !== "search")
        {
            WriteJson(response, 404, { error: "DNA route not found" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const headers = CreateSdeHeaders(source);
        const identity = {
            target: source.target,
            game: source.game,
            provider: source.provider,
            build: source.build,
        };

        if (verb === "search")
        {
            // The query travels as a parameter rather than a path segment: it
            // carries colons and semicolons, which a path would force every
            // caller to encode. `resolve` takes its selection the same way for
            // the same reason.
            const query = url.searchParams.get("q") ?? url.searchParams.get("dna") ?? "";

            if (!query.trim())
            {
                throw new TypeError("DNA search requires q");
            }

            WriteJson(response, 200, {
                ...identity,
                ...await source.QueryDna(query, {
                    limit: url.searchParams.get("limit") ?? undefined,
                }),
            }, headers);

            return;
        }

        const selection = Object.fromEntries([
            "name",
            "typeID",
            "graphicID",
            "skinID",
        ].map(name => [ name, url.searchParams.get(name) ]).filter(([, value ]) => value));

        if (!Object.keys(selection).length)
        {
            throw new TypeError(
                "DNA resolve requires name, typeID, graphicID, or skinID",
            );
        }

        WriteJson(response, 200, {
            ...identity,
            ...await source.Resolve(selection),
        }, headers);
    }

    /** Serves one SDE query route. */
    async #HandleSdeRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const headers = CreateSdeHeaders(source);

        if (!route.path)
        {
            WriteJson(response, 200, await source.Describe(), headers);

            return;
        }

        const segments = route.path.split("/").filter(Boolean);

        if (!segments.length || segments.length > 2)
        {
            WriteJson(response, 404, { error: "SDE route not found" });

            return;
        }

        // `resolve` and `dna` used to live here. They were never tables, and
        // they are the questions consumers actually ask, so they moved to the
        // `dna` topic — `sde` is inspection of the SDE itself.
        const table = source.Table(segments[0]);
        const rowCount = await table.Count();

        if (rowCount === null)
        {
            WriteJson(response, 404, {
                error: `SDE table not found: ${segments[0]}`,
                target: route.target,
                build: source.build,
            });

            return;
        }

        if (segments.length === 2)
        {
            const record = await table.Get(segments[1]);

            if (!record)
            {
                WriteJson(response, 404, {
                    error: `SDE record not found: ${segments[0]}/${segments[1]}`,
                    target: route.target,
                    build: source.build,
                });

                return;
            }

            WriteJson(response, 200, {
                target: source.target,
                game: source.game,
                provider: source.provider,
                build: source.build,
                ...record,
            }, headers);

            return;
        }

        const options = {
            limit: url.searchParams.get("limit") ?? undefined,
            offset: url.searchParams.get("offset") ?? undefined,
        };
        const query = url.searchParams.get("query");
        const field = url.searchParams.get("field");
        const value = url.searchParams.get("value");
        const contains = url.searchParams.get("contains");

        if (query && field)
        {
            throw new TypeError("SDE table query and field filters cannot be combined");
        }

        if (field && (value === null) === (contains === null))
        {
            throw new TypeError(
                "SDE field filter requires exactly one value or contains parameter",
            );
        }

        if (!field && (value !== null || contains !== null))
        {
            throw new TypeError("SDE value and contains filters require a field parameter");
        }

        let items;

        if (query)
        {
            items = await table.Search(query, options);
        }
        else if (field)
        {
            items = await table.Find(field, value ?? contains, {
                ...options,
                contains: contains !== null,
            });
        }
        else
        {
            items = await table.List(options);
        }

        WriteJson(response, 200, {
            target: source.target,
            game: source.game,
            provider: source.provider,
            build: source.build,
            table: table.name,
            rowCount,
            limit: Number(options.limit ?? 100),
            offset: Number(options.offset ?? 0),
            ...(field ? {
                filter: {
                    field,
                    operator: contains === null ? "equals" : "contains",
                    value: value ?? contains,
                },
            } : {}),
            items,
        }, headers);
    }

    /** Serves one SKIN or SKINR library route. */
    /**
     * The EVE SSO legs: start a login, receive the redirect, report state.
     *
     * Only reachable over loopback, like every route here. That is the whole
     * access control: there are no sessions and no callers to distinguish, so
     * anyone who can reach this port is already the operator.
     *
     * The token itself is never in a response. `status` reports whether one is
     * stored, which is all a caller needs to decide whether to send someone
     * through a login.
     */
    async #HandleEsiAuthRoute(url, response)
    {
        if (!this.auth)
        {
            WriteJson(response, 501, {
                error: "EVE SSO is not configured; set CJS_ESI_CLIENT_ID",
            });

            return;
        }

        const leg = url.pathname.slice("/v1/auth/esi/".length);

        if (leg === "status")
        {
            const stored = await this.auth.tokens.Read();

            WriteJson(response, 200, {
                authenticated: Boolean(stored?.refreshToken),
                characterId: stored?.characterId ?? null,
                characterName: stored?.characterName ?? null,
            });

            return;
        }

        // The SKINR licences this service's OWN token belongs to.
        //
        // LICENCES, not designs. Verified 2026-08-11: this endpoint lists only
        // skins that have actually been BUILT - its records carry `activated`
        // and `unactivated` counts, which is ownership vocabulary. A design
        // saved in game but not yet built appears nowhere in ESI, under any
        // scope. If you are here looking for "my unpublished skin", stop: the
        // only route to one is POSTing its payload to /skinr/pattern, because
        // the payload exists solely in the hands of whoever exported it.
        //
        // There is deliberately no character_id parameter. tools-core has no
        // session and cannot prove a caller is anybody, so "whose licences?"
        // has exactly one answerable value: the character the stored token was
        // issued for. Accepting an id would turn a route that is safe by
        // construction into one that is safe only while nobody points it at a
        // stranger. It lives under /v1/auth/esi/ rather than the target routes
        // for the same reason - it is a property of this session, not of a
        // game build.
        if (leg === "skinr")
        {
            const stored = await this.auth.tokens.Read();

            // Same guards as every other character-scoped leg. A token stored
            // before identity capture existed still works for everything else,
            // so that case says what to do rather than failing as if the
            // session were broken.
            if (!RequireEsiSession(stored, response)) return;

            const owned = await this.auth.esi.Get(
                `/characters/${stored.characterId}/cosmetics/skinr`,
            );

            WriteJson(response, 200, {
                characterId: stored.characterId,
                characterName: stored.characterName ?? null,
                licenses: owned?.licenses ?? [],
            });

            return;
        }

        if (leg === "fittings")
        {
            const stored = await this.auth.tokens.Read();
            const session = RequireEsiSession(stored, response, FITTINGS_SCOPE);

            if (!session) return;

            let saved;

            try
            {
                saved = await this.auth.esi.Get(`/characters/${stored.characterId}/fittings`);
            }
            catch (error)
            {
                // A 403 here means the grant does not cover fittings - the
                // operator authorized before the scope was configured. That is
                // a different instruction from "upstream is down", so it gets a
                // different status and its own message.
                if (error?.upstreamStatus === 403)
                {
                    WriteJson(response, 403, {
                        error: `Stored session lacks ${FITTINGS_SCOPE}. Sign in again: npm run login:eve`,
                        scope: FITTINGS_SCOPE,
                    });

                    return;
                }

                WriteJson(response, error?.statusCode === 404 ? 404 : 502, {
                    error: `Could not read fittings from ESI (${error?.upstreamStatus ?? "no response"})`,
                });

                return;
            }

            WriteJson(response, 200, {
                characterId: stored.characterId,
                characterName: stored.characterName ?? null,
                // ESI's snake_case is converted at this boundary and nowhere
                // else, so nothing downstream has to know which provider the
                // fitting came from.
                fittings: (Array.isArray(saved) ? saved : []).map(NormalizeEsiFitting),
            });

            return;
        }

        // The trained skills of the character this service's OWN token belongs
        // to. Same shape of guarantee as the other character-scoped legs: no
        // character_id parameter, because tools-core has no session and cannot
        // prove a caller is anybody, so "whose skills?" has exactly one
        // answerable value.
        //
        // ESI returns levels and skill points per skill; the skill itself is a
        // typeID, so a consumer wanting names joins it against `types` rather
        // than being handed text it cannot verify.
        if (leg === "skills")
        {
            const stored = await this.auth.tokens.Read();
            const session = RequireEsiSession(stored, response, SKILLS_SCOPE);

            if (!session) return;

            let trained;

            try
            {
                trained = await this.auth.esi.Get(`/characters/${stored.characterId}/skills`);
            }
            catch (error)
            {
                // A 403 means the grant predates the scope being configured -
                // a different instruction from "upstream is down", so it gets
                // its own status and message.
                if (error?.upstreamStatus === 403)
                {
                    WriteJson(response, 403, {
                        error: `Stored session lacks ${SKILLS_SCOPE}. Sign in again: npm run login:eve`,
                        scope: SKILLS_SCOPE,
                    });

                    return;
                }

                WriteJson(response, error?.statusCode === 404 ? 404 : 502, {
                    error: `Could not read skills from ESI (${error?.upstreamStatus ?? "no response"})`,
                });

                return;
            }

            // ESI's snake_case is converted at this boundary and nowhere else,
            // matching what the fittings leg does with its own payload.
            const skills = Array.isArray(trained?.skills) ? trained.skills : [];

            WriteJson(response, 200, {
                characterId: stored.characterId,
                characterName: stored.characterName ?? null,
                totalSkillPoints: trained?.total_sp ?? null,
                unallocatedSkillPoints: trained?.unallocated_sp ?? null,
                skills: skills.map(skill => ({
                    typeID: Number(skill.skill_id),
                    activeSkillLevel: skill.active_skill_level ?? null,
                    trainedSkillLevel: skill.trained_skill_level ?? null,
                    skillPoints: skill.skillpoints_in_skill ?? null,
                })),
            });

            return;
        }

        if (leg === "login")
        {
            const { url: authorizeUrl } = this.auth.sso.BeginLogin();

            // A redirect rather than a JSON body: the operator opens this in a
            // browser, and the browser has to be the thing that visits EVE so
            // the session cookie and the eventual callback land in one place.
            WriteEmpty(response, 302, { location: authorizeUrl });

            return;
        }

        if (leg === "callback")
        {
            const error = url.searchParams.get("error");

            if (error)
            {
                // EVE's own refusal, e.g. the operator declined. Report the
                // code, never the description, which is attacker-influenced
                // text that would land in a browser page.
                WriteText(response, 400, `EVE SSO refused the login (${SafeCode(error)}).`);

                return;
            }

            const tokens = await this.auth.sso.CompleteLogin({
                code: url.searchParams.get("code"),
                state: url.searchParams.get("state"),
            });

            // The character rides along with the token. It is needed to call
            // character-scoped ESI routes need it, and a login is the only
            // moment it is available - a refresh response carries the same
            // claims, but there is no reason to wait for one.
            await this.auth.tokens.Write({
                refreshToken: tokens.refresh_token,
                accessToken: tokens.access_token,
                expiresAt: Date.now() + (Number(tokens.expires_in) || 0) * 1000,
                ...(CjsToolEveSso.describeToken(tokens.access_token) ?? {}),
            });

            // Plain text, and deliberately says nothing about the token.
            WriteText(response, 200, "Signed in. You can close this tab.");

            return;
        }

        WriteJson(response, 404, { error: "auth route not found" });
    }

    /**
     * Generates the SOF pattern and DNA for a posted SKINR payload.
     *
     * POST rather than a GET on a skinr id, because the payload is the general
     * case: a private or unbaked design exists only in the hands of whoever
     * fetched it, and this service has no session with which to fetch one on a
     * user's behalf. A GET by id can be added for baked, publicly listed skins -
     * it is additive, not a replacement.
     *
     * The hull DNA is resolved here rather than asked of the caller, since the
     * SDE that answers it is already open.
     */
    /**
     * Generates the pattern for a baked SKINR skin, fetched by id.
     *
     * The convenience form of the POST route: a baked skin cannot change, so
     * fetching it by id is safe to cache and needs no payload from the caller.
     * Only works for skins this service's token can read - a private design
     * still has to arrive as a payload, because there is no session here to
     * fetch one on a user's behalf.
     */
    async #HandleSkinrPatternByIdRoute(route, response)
    {
        if (!this.auth?.esi)
        {
            WriteJson(response, 501, {
                error: "EVE SSO is not configured; set CJS_ESI_CLIENT_ID and run: npm run login",
            });

            return;
        }

        const skinrID = String(route.path ?? "").split("/")[1] ?? "";

        // A skinr id is an opaque hex string, NOT a uuid - the uuid in this API
        // is the Paragon Hub listing id, a different identifier entirely.
        if (!/^[a-f0-9]{16,128}$/iu.test(skinrID))
        {
            throw new TypeError(`Malformed SKINR id: ${skinrID.slice(0, 32)}`);
        }

        const skin = await this.auth.esi.Get(`/cosmetics/skinr/${encodeURIComponent(skinrID)}`);

        await this.#WriteSkinrPattern(route, skin, response);
    }

    /** Generates a SOF pattern from one caller-supplied SKINR design. */
    async #HandleSkinrPatternRoute(request, route, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const skin = await ReadJson(request, this.maxRequestBytes);

        await this.#WriteSkinrPattern(route, skin, response);
    }

    /** Shared tail: resolve the hull, generate, answer. */
    async #WriteSkinrPattern(route, skin, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const typeID = skin?.ship_type_id;

        if (typeID === undefined || typeID === null)
        {
            throw new TypeError("SKINR pattern generation requires ship_type_id");
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const resolved = await source.Resolve({ typeID: Number(typeID) });
        const dna = resolved?.dna;

        if (!dna)
        {
            WriteJson(response, 404, { error: `Type ${typeID} has no SOF DNA` });

            return;
        }

        const libraries = await this.#GetSkinLibraries(route.target, route.build);

        let generated;

        try
        {
            generated = CjsToolSkinrPattern.generate({ library: libraries.skinr, skin, dna });
        }
        catch (error)
        {
            // generate() rejects malformed payloads and vocabulary it does not
            // recognise - an unknown blend mode, an unusable projection type.
            // Those are the caller's, so they must not read as 500s.
            const bad = new TypeError(error.message);
            bad.statusCode = 400;
            throw bad;
        }

        WriteJson(
            response,
            200,
            { schema: CjsToolSkinrPattern.schema, ...generated },
            CreateSkinHeaders(libraries.skinr, "skinr"),
        );
    }

    /** Serves one generated SKIN or SKINR library route. */
    async #HandleSkinRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const libraries = await this.#GetSkinLibraries(route.target, route.build);
        const library = libraries[route.topic];
        const segments = String(route.path ?? "").split("/").filter(Boolean);

        if (route.topic === "skin"
            && segments.length === 1
            && [ "lookup", "search" ].includes(segments[0].toLowerCase()))
        {
            const name = url.searchParams.get("name");

            if (!name)
            {
                throw new TypeError(`SKIN ${segments[0]} requires name`);
            }

            const candidates = segments[0].toLowerCase() === "lookup"
                ? LookupSkinName(library, name)
                : SearchSkinName(library, name);

            WriteJson(response, 200, candidates, CreateSkinHeaders(library, route.topic));

            return;
        }

        if (segments.length > 2)
        {
            WriteJson(response, 404, { error: `${route.topic} route not found` });

            return;
        }

        let value = library;

        for (const segment of segments)
        {
            if (!value
                || typeof value !== "object"
                || Array.isArray(value)
                || !Object.hasOwn(value, segment))
            {
                WriteJson(response, 404, {
                    error: `${route.topic} record not found: ${segments.join("/")}`,
                    target: route.target,
                    build: library.sourceBuild,
                });

                return;
            }

            value = value[segment];
        }

        WriteJson(response, 200, value, CreateSkinHeaders(library, route.topic));
    }

    /** Serves one weapon-library route. */
    async #HandleWeaponRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const library = await this.#GetWeaponLibrary(route.target, route.build);
        const headers = CreateWeaponHeaders(library);
        const segments = String(route.path ?? "").split("/").filter(Boolean);

        if (!segments.length)
        {
            WriteJson(response, 200, library, headers);

            return;
        }

        const kind = segments[0].toLowerCase();

        if ([ "lookup", "search" ].includes(kind))
        {
            if (segments.length !== 1)
            {
                WriteJson(response, 404, { error: `Weapons ${kind} route not found` }, headers);

                return;
            }

            const name = url.searchParams.get("name");

            if (!name) throw new TypeError(`Weapons ${kind} requires name`);

            const candidates = kind === "lookup"
                ? LookupWeaponName(library, name)
                : SearchWeaponName(library, name);

            WriteJson(response, 200, candidates, headers);

            return;
        }

        if (kind === "types")
        {
            const weapon = segments.length >= 2 ? library.types[segments[1]] : null;

            if (segments.length === 1)
            {
                WriteJson(response, 200, library.types, headers);

                return;
            }

            if (!weapon)
            {
                WriteJson(response, 404, {
                    error: `Weapon type not found: ${segments[1]}`,
                }, headers);

                return;
            }

            if (segments.length === 2)
            {
                WriteJson(response, 200, weapon, headers);

                return;
            }

            if (segments[2].toLowerCase() === "ammunition")
            {
                if (segments.length === 3)
                {
                    WriteJson(response, 200, weapon.ammunitionTypeIDs.map(
                        typeID => library.ammunition[typeID],
                    ), headers);

                    return;
                }

                const ammunitionTypeID = Number(segments[3]);

                if (segments.length === 4
                    && weapon.ammunitionTypeIDs.includes(ammunitionTypeID))
                {
                    WriteJson(response, 200, library.ammunition[ammunitionTypeID], headers);

                    return;
                }
            }

            WriteJson(response, 404, {
                error: `Weapon type route not found: ${segments.slice(1).join("/")}`,
            }, headers);

            return;
        }

        if (kind === "ammunition")
        {
            WriteWeaponMapRoute(
                response,
                headers,
                segments,
                library.ammunition,
                "Ammunition type",
            );

            return;
        }

        if (kind === "projectiles")
        {
            WriteWeaponMapRoute(
                response,
                headers,
                segments,
                library.projectiles,
                "Projectile graphic",
            );

            return;
        }

        if (kind === "groups")
        {
            WriteWeaponMapRoute(
                response,
                headers,
                segments,
                library.groups,
                "Weapon group",
            );

            return;
        }

        WriteJson(response, 404, { error: "Weapons route not found" }, headers);
    }

    /** Serves one character-library or document route. */
    async #HandleCharacterRoute(route, _url, response)
    {
        if (!this.characters)
        {
            WriteJson(response, 501, { error: "Character service is not configured" });

            return;
        }

        const library = await this.characters.OpenTarget(route.target, route.build);
        const segments = String(route.path ?? "").split("/").filter(Boolean);
        const headers = CreateCharacterHeaders(library, route);

        if (!segments.length
            || (segments.length === 1 && segments[0].toLowerCase() === "library.json"))
        {
            WriteJson(response, 200, library.GetValues({ refs: true }), headers);

            return;
        }

        WriteJson(response, 404, { error: "Character route not found" }, headers);
    }

    /** Opens or reuses exact-build SKIN and SKINR libraries. */
    async #GetSkinLibraries(target, build)
    {
        const source = await this.sde.OpenTarget(target, build);
        const key = [
            source.target,
            source.game,
            source.provider,
            source.build,
        ].join("\0");

        if (!this.#skinLibraries.has(key))
        {
            const loading = CjsToolSkin.buildAllFromSource(source).catch(error =>
            {
                this.#skinLibraries.delete(key);
                throw error;
            });

            this.#skinLibraries.set(key, loading);
        }

        return this.#skinLibraries.get(key);
    }

    /** Opens or reuses one exact-build weapon library. */
    /**
     * Serves one map route.
     *
     * The surface is flat-addressable with nesting offered for navigation:
     *
     *   /map                                     counts and index provenance
     *   /map/search?q=&kind=&limit=              names, ranked
     *   /map/regions                             all 114
     *   /map/regions/{id}                        one, with its nebula
     *   /map/regions/{id}/constellations
     *   /map/constellations/{id}
     *   /map/constellations/{id}/systems
     *   /map/systems/{id}                        with star and derived scene
     *   /map/systems/{id}/celestials?kind=       everything in the system
     *   /map/systems/{id}/{kind}                 one kind of it
     *   /map/celestials/{id}                     any celestial, any kind
     *
     * `/map/systems/{id}/planets` and friends are the same answer as the
     * `celestials` route filtered to one kind, rather than a second code path,
     * so a kind cannot be correct in one form and wrong in the other.
     */
    async #HandleMapRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const map = this.#GetMap(source);
        const headers = CreateSdeHeaders(source);
        const segments = String(route.path ?? "").split("/").filter(Boolean);

        if (!segments.length)
        {
            WriteJson(response, 200, await map.Describe(), headers);

            return;
        }

        const collection = segments[0].toLowerCase();

        if (collection === "search")
        {
            const query = url.searchParams.get("q") ?? url.searchParams.get("query");

            if (!query || !String(query).trim())
            {
                throw new TypeError("Map search requires q");
            }

            WriteJson(response, 200, await map.Search(query, {
                limit: url.searchParams.get("limit") ?? undefined,
                kinds: url.searchParams.get("kind") ?? undefined,
                language: url.searchParams.get("lang") ?? undefined,
                expand: url.searchParams.get("expand") ?? undefined
            }), headers);

            return;
        }

        const answer = await this.#ResolveMapRoute(map, collection, segments, url);

        if (answer === undefined)
        {
            WriteJson(response, 404, { error: `Map route not found: ${segments.join("/")}` }, headers);

            return;
        }

        if (answer === null)
        {
            WriteJson(response, 404, {
                error: `Map record not found: ${segments.join("/")}`,
                target: source.target,
                build: source.build
            }, headers);

            return;
        }

        WriteJson(response, 200, answer, headers);
    }

    /**
     * Maps one parsed route to one map answer.
     *
     * `undefined` means the route does not exist, `null` means it exists and
     * the record does not. Collapsing the two would report a typo in a
     * collection name as a missing system, which sends the reader looking at
     * their data instead of their url.
     */
    async #ResolveMapRoute(map, collection, segments, url)
    {
        const id = segments[1];
        const leaf = segments[2]?.toLowerCase();
        // Published names are localised in the export's eight languages; the
        // words a celestial name is composed FROM are not. See CjsToolMap.
        const options = {
            language: url.searchParams.get("lang") ?? undefined,
            // Nothing derived unless asked for: the default answer is the
            // static data export and only the export. See EXPAND_GROUPS.
            expand: url.searchParams.get("expand") ?? undefined
        };

        if (segments.length > 3) return undefined;

        if (collection === "regions")
        {
            if (segments.length === 1) return map.Regions(options);
            if (segments.length === 2) return map.Region(id, options);
            if (leaf === "constellations") return map.RegionConstellations(id, options);

            return undefined;
        }

        if (collection === "constellations")
        {
            if (segments.length === 2) return map.Constellation(id, options);
            if (leaf === "systems") return map.ConstellationSystems(id, options);

            return undefined;
        }

        if (collection === "systems")
        {
            if (segments.length === 2) return map.System(id, options);

            if (leaf === "celestials")
            {
                return map.SystemCelestials(id, {
                    ...options,
                    kinds: url.searchParams.get("kind") ?? undefined
                });
            }

            const kind = MAP_SYSTEM_COLLECTIONS[leaf];

            if (!kind) return undefined;

            const answer = await map.SystemCelestials(id, { ...options, kinds: [ kind ] });

            return answer === null ? null : answer.celestials[kind] ?? [];
        }

        if (collection === "celestials" && segments.length === 2)
        {
            return map.Celestial(id, options);
        }

        return undefined;
    }

    /**
     * The dogma topic.
     *
     * `body` is null for the GET form and an object for the POST form, which is
     * the only difference between them: a GET evaluates the published values
     * with no skills, a POST evaluates the same type against a supplied profile.
     */
    async #HandleDogmaRoute(route, url, body, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const dogma = await this.#GetDogma(source);
        const headers = CreateSdeHeaders(source);
        const segments = String(route.path ?? "").split("/").filter(Boolean);
        const language = url.searchParams.get("lang") ?? undefined;

        if (!segments.length && !body)
        {
            WriteJson(response, 200, { ...dogma.Identity(), sections: Object.keys(DOGMA_SECTIONS) }, headers);

            return;
        }

        const evaluate = body
            ? { typeID: body.typeID, profile: body.profile ?? {}, sections: body.sections }
            : ReadDogmaPath(segments, url);

        if (!evaluate)
        {
            WriteJson(response, 404, { error: "Dogma route not found" });

            return;
        }

        const result = await dogma.Evaluate(
            NormalizeTypeID(evaluate.typeID),
            CjsToolDogmaProfile.normalize(evaluate.profile ?? {}),
            { sections: evaluate.sections, language }
        );

        if (!result)
        {
            WriteJson(response, 404, { error: "Type not found" });

            return;
        }

        WriteJson(response, 200, result, headers);
    }

    /** The industry topic: the public recipe for one type. */
    async #HandleIndustryRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const industry = await this.#GetIndustry(source);
        const headers = CreateSdeHeaders(source);
        const segments = String(route.path ?? "").split("/").filter(Boolean);

        if (segments.length !== 2 || segments[0].toLowerCase() !== "types")
        {
            WriteJson(response, 404, { error: "Industry route not found" });

            return;
        }

        const result = await industry.Type(
            NormalizeTypeID(segments[1]),
            { language: url.searchParams.get("lang") ?? undefined }
        );

        if (!result)
        {
            WriteJson(response, 404, { error: "Type not found" });

            return;
        }

        WriteJson(response, 200, result, headers);
    }

    /**
     * The fitting topic.
     *
     * `GET /fitting` describes it; `POST /fitting/parse` reads pasted text. The
     * answer is the normalized record plus every wire form, so a caller that
     * pasted EFT can hand back a chat link without a second call.
     */
    async #HandleFittingRoute(route, url, body, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const fitting = this.#GetFitting(source);
        const headers = CreateSdeHeaders(source);
        const segments = String(route.path ?? "").split("/").filter(Boolean);
        const language = url.searchParams.get("lang") ?? undefined;

        if (!segments.length && !body)
        {
            WriteJson(response, 200, {
                ...fitting.Identity(),
                formats: [ "eft", "dna", "chatLink" ],
                slots: FITTING_SLOTS,
            }, headers);

            return;
        }

        if (segments[0]?.toLowerCase() !== "parse" || segments.length !== 1)
        {
            WriteJson(response, 404, { error: "Fitting route not found" });

            return;
        }

        if (!body)
        {
            WriteJson(response, 405, { error: "Parsing a fitting requires POST" });

            return;
        }

        // An ESI fitting arrives as a record rather than as text, and normalizes
        // through the same path so every source produces one shape.
        const parsed = body.fitting
            ? await fitting.FromEsi(body.fitting, { language })
            : await fitting.Parse(body.text ?? body.fit ?? "", { language });

        WriteJson(response, 200, parsed, headers);
    }

    /**
     * The skills topic.
     *
     * `/skills/types/{id}` answers what a thing needs trained;
     * `/skills/{id}` answers what a skill costs and what it unlocks. Both are
     * published data, so neither needs authorization and both work on the
     * NetEase targets, which have no ESI at all.
     */
    async #HandleSkillsRoute(route, url, response, body = null)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const skills = this.#GetSkills(source);
        const headers = CreateSdeHeaders(source);
        const segments = String(route.path ?? "").split("/").filter(Boolean);
        const language = url.searchParams.get("lang") ?? undefined;

        if (!segments.length)
        {
            WriteJson(response, 200, {
                ...skills.Identity(),
                routes: [ "types/{typeID}", "{skillTypeID}", "plan?skills=<id,id>" ],
            }, headers);

            return;
        }

        // Before the single-segment case, which would otherwise read "plan" as
        // a skill identifier and answer 404 for a route that exists.
        if (segments[0].toLowerCase() === "plan" && segments.length === 1)
        {
            const targets = SkillPlanTargets(url.searchParams.get("skills") ?? body?.skills);

            if (!targets.length)
            {
                WriteJson(response, 400, {
                    error: "Skill plan requires one or more skill ids: ?skills=<id,id> or a JSON body",
                });

                return;
            }

            const plan = await skills.Plan(targets, { language });

            if (!plan)
            {
                WriteJson(response, 404, { error: "No requested skill exists in this build" }, headers);

                return;
            }

            WriteJson(response, 200, plan, headers);

            return;
        }

        const answer = segments[0].toLowerCase() === "types" && segments.length === 2
            ? await skills.Requirements(NormalizeTypeID(segments[1]), { language })
            : segments.length === 1
                ? await skills.Skill(NormalizeTypeID(segments[0]), { language })
                : undefined;

        if (answer === undefined)
        {
            WriteJson(response, 404, { error: "Skills route not found" });

            return;
        }

        if (!answer)
        {
            WriteJson(response, 404, { error: "Type not found" });

            return;
        }

        WriteJson(response, 200, answer, headers);
    }

    /** One `CjsToolSkills` per open build, holding its reverse index. */
    #GetSkills(source)
    {
        const key = [ source.target, source.game, source.provider, source.build ].join("\0");

        if (!this.#skills.has(key)) this.#skills.set(key, new CjsToolSkills(source));

        return this.#skills.get(key);
    }

    /** One `CjsToolFitting` per open build, holding its name and slot indexes. */
    #GetFitting(source)
    {
        const key = [ source.target, source.game, source.provider, source.build ].join(" ");

        if (!this.#fittings.has(key)) this.#fittings.set(key, new CjsToolFitting(source));

        return this.#fittings.get(key);
    }

    /** One `CjsToolDogma` per open build, holding its attribute catalog. */
    /**
     * Serves one composed type.
     *
     * `sde/types/{id}` still answers with the published row and goes on meaning
     * exactly that. This route is the composed answer: the same identity plus
     * the fields the published export does not carry, which is where a reading
     * of ours belongs rather than inside a route that claims to be the export.
     */
    async #HandleTypesRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const headers = CreateSdeHeaders(source);
        const segments = String(route.path ?? "").split("/").filter(Boolean);
        const types = await this.#GetTypes(source);

        if (!segments.length)
        {
            WriteJson(response, 200, types.Identity(), headers);

            return;
        }

        const leaf = segments.length === 2 ? segments[1].toLowerCase() : null;
        const composed = { variations: "Variations", traits: "Traits", mastery: "Mastery" };

        if (segments.length > 2 || (leaf !== null && !composed[leaf]))
        {
            WriteJson(response, 404, { error: "Types route not found" });

            return;
        }

        const typeID = NormalizeTypeID(segments[0]);
        const options = { language: url.searchParams.get("lang") ?? undefined };
        const answer = typeID === null
            ? null
            : await types[leaf ? composed[leaf] : "Answer"](typeID, options);

        if (!answer)
        {
            WriteJson(response, 404, { error: `Type not found: ${segments[0]}` }, headers);

            return;
        }

        WriteJson(response, 200, answer, headers);
    }

    /** One `CjsToolTypes` per open build. */
    async #GetTypes(source)
    {
        const key = [ source.target, source.game, source.provider, source.build ].join(" ");

        if (!this.#types.has(key))
        {
            this.#types.set(key, new CjsToolTypes(source, { localisation: await this.#GetLocalisation(source) }));
        }

        return this.#types.get(key);
    }

    /** Serves the composed icon catalog or one exact icon record. */
    async #HandleIconsRoute(route, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);
        const headers = { ...CreateSdeHeaders(source), "x-carbon-answer": "icons" };
        const segments = String(route.path ?? "").split("/").filter(Boolean);
        const icons = this.#GetIcons(source);

        if (!segments.length)
        {
            WriteJson(response, 200, await icons.List(), headers);

            return;
        }

        if (segments.length !== 1)
        {
            WriteJson(response, 404, { error: "Icons route not found" }, headers);

            return;
        }

        let record = null;

        try
        {
            record = await icons.Get(segments[0]);
        }
        catch (error)
        {
            if (!(error instanceof TypeError)) throw error;
        }

        if (!record)
        {
            WriteJson(response, 404, { error: `Icon not found: ${segments[0]}` }, headers);

            return;
        }

        WriteJson(response, 200, record, headers);
    }

    /** Returns one composed icon catalog per open exact-build source. */
    #GetIcons(source)
    {
        const key = [ source.target, source.game, source.provider, source.build ].join("\0");

        if (!this.#icons.has(key)) this.#icons.set(key, new CjsToolIcons(source));

        return this.#icons.get(key);
    }

    /** Returns one dogma composer per open exact-build source. */
    async #GetDogma(source)
    {
        const key = [ source.target, source.game, source.provider, source.build ].join("\0");

        if (!this.#dogmas.has(key))
        {
            this.#dogmas.set(key, new CjsToolDogma(source, { localisation: await this.#GetLocalisation(source) }));
        }

        return this.#dogmas.get(key);
    }

    /** One `CjsToolIndustry` per open build, holding its product index. */
    async #GetIndustry(source)
    {
        const key = [ source.target, source.game, source.provider, source.build ].join("\0");

        if (!this.#industries.has(key))
        {
            this.#industries.set(key, new CjsToolIndustry(source, { localisation: await this.#GetLocalisation(source) }));
        }

        return this.#industries.get(key);
    }

    /**
     * English names for an export that carries none.
     *
     * Only the NetEase targets need this, and only they pay for it: the
     * reference export is opened once per target and skipped entirely when the
     * export already has English of its own. A reference that cannot be opened
     * is not fatal - the topic still answers, in the language it has.
     */
    async #GetLocalisation(source)
    {
        if (source.target === ENGLISH_REFERENCE_TARGET) return null;

        const key = [ source.target, source.build ].join("\0");

        if (this.#localisations.has(key)) return this.#localisations.get(key);

        let localisation = null;

        try
        {
            const reference = await this.sde.OpenTarget(ENGLISH_REFERENCE_TARGET, "latest");
            // Machine-composed names, when the cross-export pass has run for
            // this build. Absent is the normal case and costs only the guesses.
            const file = typeof source.DatabaseFile === "function" ? source.DatabaseFile() : null;
            const guessed = file ? await ReadDerivation(file, "englishNames") : null;

            localisation = new CjsToolLocalisation(source, {
                reference,
                manual: ReadManualNames(await ReadManualNameFile()),
                guesses: ReadGuessedNames(guessed)
            });
        }
        catch
        {
            localisation = null;
        }

        this.#localisations.set(key, localisation);

        return localisation;
    }

    /** One `CjsToolMap` per open build, holding its skeleton and index. */
    #GetMap(source)
    {
        const key = [ source.target, source.game, source.provider, source.build ].join("\0");

        if (!this.#maps.has(key)) this.#maps.set(key, new CjsToolMap(source));

        return this.#maps.get(key);
    }

    /** Opens or reuses one exact-build weapon library. */
    async #GetWeaponLibrary(target, build)
    {
        const source = await this.sde.OpenTarget(target, build);
        const key = [
            source.target,
            source.game,
            source.provider,
            source.build,
        ].join("\0");

        if (!this.#weaponLibraries.has(key))
        {
            const loading = CjsToolWeapon.buildFromSource(source).catch(error =>
            {
                this.#weaponLibraries.delete(key);
                throw error;
            });

            this.#weaponLibraries.set(key, loading);
        }

        return this.#weaponLibraries.get(key);
    }

}

function RequireResourceRequest(value)
{
    if (!value.source || typeof value.source !== "object" || Array.isArray(value.source))
    {
        throw new TypeError("Resource request source must be an object");
    }

    if (typeof value.logicalPath !== "string" || !value.logicalPath.trim())
    {
        throw new TypeError("Resource request logicalPath must be a non-empty string");
    }

    if (value.options !== undefined
        && (!value.options || typeof value.options !== "object" || Array.isArray(value.options)))
    {
        throw new TypeError("Resource request options must be an object");
    }

    const provider = String(value.source.provider ?? "").trim().toLowerCase();
    const build = utils.normalizeExactBuild(value.source.build, {
        message: "Resource request source.build must be an exact numeric build",
    });

    if (!provider)
    {
        throw new TypeError("Resource request source.provider is required");
    }

    return {
        source: {
            ...value.source,
            provider,
            build,
        },
        logicalPath: value.logicalPath,
        options: value.options ?? {},
    };
}

/**
 * Matches the provider-clients route.
 *
 * Sits beside the build route deliberately: a client name exists to resolve a
 * build, so the place that lists clients is the place that reports their
 * builds. Nothing downstream should be carrying the name itself.
 *
 * @param {string} pathname Request path.
 * @returns {object|null} Route parts, or null.
 */
/**
 * `/{target}/metadata`.
 *
 * Matched before the generic target route, which would otherwise read
 * `metadata` as a build reference.
 */
/** Whether a value is a URL rather than a reason token. */
function IsUrl(value)
{
    return typeof value === "string" && /^https?:///u.test(value);
}

function MatchMetadataRoute(pathname)
{
    const match = pathname.match(/^\/([^/]+)\/metadata(?:\.json)?$/iu);

    if (!match) return null;

    try
    {
        return Object.freeze({ target: decodeURIComponent(match[1]).toLowerCase() });
    }
    catch
    {
        throw new TypeError("Metadata route contains invalid URL encoding");
    }
}

function MatchTargetRoute(pathname)
{
    const match = pathname.match(
        /^\/([^/]+)\/([^/]+)(?:\/([^/]+)(?:\/(.*))?)?\/?$/u,
    );

    if (!match)
    {
        return null;
    }

    try
    {
        const requestedTarget = decodeURIComponent(match[1]).toLowerCase();
        const topic = match[3] ? decodeURIComponent(match[3]).toLowerCase() : null;

        return Object.freeze({
            // No `ccp -> eve` alias. A provider is not an address: it says who
            // controls the data, and one provider serves two targets here
            // (Frontier is ccp's as well), so the alias only ever meant "eve"
            // by convention. Removed with the provider-shaped routes.
            target: requestedTarget,
            build: decodeURIComponent(match[2]).toLowerCase(),
            topic,
            path: match[4] ? decodeURIComponent(match[4]) : null,
            encodedPath: match[4] ?? null,
        });
    }
    catch
    {
        throw new TypeError("Target route contains invalid URL encoding");
    }
}

function AppendSofDnaSearch(route, search)
{
    if (!route || route.topic !== "sof"
        || !String(route.path ?? "").toLowerCase().startsWith("dna/")
        || !search)
    {
        return route;
    }

    try
    {
        return Object.freeze({
            ...route,
            path: `${route.path}${decodeURIComponent(search)}`,
        });
    }
    catch
    {
        throw new TypeError("SOF DNA route contains invalid URL encoding");
    }
}

function ParseAudioRequest(value, encodedValue = null)
{
    const path = String(value ?? "");
    const separator = path.indexOf("/");
    const kind = (separator === -1 ? path : path.slice(0, separator)).toLowerCase();
    const requestValue = separator === -1 ? "" : path.slice(separator + 1);

    if (kind === "id")
    {
        if (!requestValue || requestValue.includes("/"))
        {
            throw new TypeError("Audio ID route requires one media ID");
        }

        return Object.freeze({ kind, value: requestValue });
    }

    if (kind === "path")
    {
        if (!requestValue)
        {
            throw new TypeError("Audio path route requires one indexed audio path");
        }

        return Object.freeze({ kind, value: requestValue });
    }

    if (kind === "library" || kind === "library.json")
    {
        if (requestValue)
        {
            const notFound = new Error("Audio route not found");

            notFound.statusCode = 404;
            throw notFound;
        }

        return Object.freeze({ kind: "library" });
    }

    if (kind === "music")
    {
        const encodedPath = String(encodedValue ?? value ?? "");
        const encodedSeparator = encodedPath.indexOf("/");
        const encodedRequestValue = encodedSeparator === -1
            ? ""
            : encodedPath.slice(encodedSeparator + 1);
        let segments;

        try
        {
            segments = encodedRequestValue
                ? encodedRequestValue.split("/").map(decodeURIComponent)
                : [];
        }
        catch
        {
            throw new TypeError(
                "Audio music route contains invalid URL encoding",
            );
        }

        if (!segments.length)
        {
            return Object.freeze({ kind: "music" });
        }
        if (segments.length === 1
            && segments[0].toLowerCase() === "library")
        {
            return Object.freeze({ kind: "music-library" });
        }
        if (segments.length === 2
            && segments[0].toLowerCase() === "playlists"
            && segments[1])
        {
            return Object.freeze({
                kind: "music-playlist",
                playlistID: segments[1],
            });
        }
        if (segments.length === 4
            && segments[0].toLowerCase() === "playlists"
            && segments[1]
            && segments[2].toLowerCase() === "songs"
            && segments[3])
        {
            return Object.freeze({
                kind: "music-song",
                playlistID: segments[1],
                songID: segments[3],
            });
        }

        const notFound = new Error("Audio music route not found");

        notFound.statusCode = 404;
        throw notFound;
    }

    const error = new Error("Audio route not found");

    error.statusCode = 404;
    throw error;
}

function ParseAcceptHeader(value)
{
    return ParseWeightedHeader(value, item =>
    {
        const mediaType = item.toLowerCase();

        if (!/^(?:\*\/\*|[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+))$/u
            .test(mediaType))
        {
            throw new TypeError(`Invalid Accept media type: ${item}`);
        }

        return mediaType;
    });
}

function ParseAcceptLanguageHeader(value)
{
    return ParseWeightedHeader(value, item =>
    {
        const language = item.replaceAll("_", "-").toLowerCase();

        if (language !== "*" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(language))
        {
            throw new TypeError(`Invalid Accept-Language value: ${item}`);
        }

        return language;
    });
}

function ParseWeightedHeader(value, normalize)
{
    if (value === undefined || value === null || value === "")
    {
        return [];
    }

    const values = [];

    for (const [ index, part ] of String(value).split(",").entries())
    {
        const segments = part.split(";").map(segment => segment.trim());
        const item = segments.shift();
        let quality = 1;

        if (!item)
        {
            throw new TypeError("Weighted request header contains an empty value");
        }

        for (const parameter of segments)
        {
            const match = parameter.match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u);

            if (!match)
            {
                throw new TypeError(`Invalid weighted request-header parameter: ${parameter}`);
            }

            quality = Number(match[1]);
        }

        if (quality > 0)
        {
            values.push({
                value: normalize(item),
                quality,
                index,
            });
        }
    }

    return values
        .sort((left, right) =>
            right.quality - left.quality
            || left.index - right.index)
        .map(item => item.value);
}

function ParseByteRange(value, totalByteLength)
{
    if (value === undefined || value === null || value === "")
    {
        return null;
    }

    if (!Number.isSafeInteger(totalByteLength) || totalByteLength < 0)
    {
        throw CreateRangeError(totalByteLength);
    }

    const match = String(value).trim().match(/^bytes=(\d*)-(\d*)$/u);

    if (!match || (!match[1] && !match[2]))
    {
        throw CreateRangeError(totalByteLength);
    }

    let offset;
    let end;

    if (match[1])
    {
        offset = Number(match[1]);
        end = match[2] ? Number(match[2]) : totalByteLength - 1;

        if (!Number.isSafeInteger(offset)
            || !Number.isSafeInteger(end)
            || offset >= totalByteLength
            || end < offset)
        {
            throw CreateRangeError(totalByteLength);
        }

        end = Math.min(end, totalByteLength - 1);
    }
    else
    {
        const suffixLength = Number(match[2]);

        if (!Number.isSafeInteger(suffixLength)
            || suffixLength < 1
            || totalByteLength < 1)
        {
            throw CreateRangeError(totalByteLength);
        }

        offset = Math.max(0, totalByteLength - suffixLength);
        end = totalByteLength - 1;
    }

    return Object.freeze({
        offset,
        byteLength: end - offset + 1,
        end,
    });
}

function CreateRangeError(totalByteLength)
{
    const error = new Error("Requested audio byte range is not satisfiable");

    error.statusCode = 416;
    error.headers = Number.isSafeInteger(totalByteLength) && totalByteLength >= 0
        ? { "content-range": `bytes */${totalByteLength}` }
        : {};

    return error;
}

function CreateAudioHeaders(audio, route, audioRequest, selection, range)
{
    const contentLength = range?.byteLength ?? selection.totalByteLength;
    const headers = {
        "x-carbon-answer": audioRequest.kind === "id" ? "audio-id" : "audio-path",
        "x-carbon-target": audio.sourceTarget || route.target,
        "x-carbon-game": audio.sourceGame || "",
        "x-carbon-provider": audio.sourceProvider || "",
        "x-carbon-build": audio.sourceBuild || route.build,
        "content-type": selection.mediaType,
        ...(selection.language
            ? { "content-language": selection.language }
            : {}),
        "cache-control": utils.isExactBuild(route.build)
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300, must-revalidate",
        vary: audioRequest.kind === "id"
            ? "Accept, Accept-Language"
            : "Accept",
        ...(selection.etag ? { etag: selection.etag } : {}),
        ...(selection.acceptRanges ? { "accept-ranges": "bytes" } : {}),
        ...(contentLength === null
            ? {}
            : { "content-length": contentLength }),
        ...(range ? {
            "content-range":
                `bytes ${range.offset}-${range.end}/${selection.totalByteLength}`,
        } : {}),
        ...(audioRequest.kind === "id"
            ? { "x-carbon-audio-media-id": selection.mediaID }
            : { "x-carbon-audio-path": selection.path }),
    };

    return headers;
}

function IsLoopback(value)
{
    const address = String(value ?? "").toLowerCase();

    return address === "127.0.0.1"
        || address === "::1"
        || address === "::ffff:127.0.0.1";
}

function GetRequestOrigin(request)
{
    const address = String(
        request.socket?.localAddress ?? "",
    ).toLowerCase();
    const normalizedAddress = address === "::ffff:127.0.0.1"
        ? "127.0.0.1"
        : address;
    const port = Number(request.socket?.localPort);

    if (!IsLoopback(normalizedAddress)
        || !Number.isSafeInteger(port)
        || port < 1
        || port > 65535)
    {
        throw new TypeError(
            "Music routes require a valid loopback service socket",
        );
    }

    const host = normalizedAddress.includes(":")
        ? `[${normalizedAddress}]`
        : normalizedAddress;
    const protocol = request.socket?.encrypted ? "https" : "http";

    return new URL(`${protocol}://${host}:${port}`).origin;
}

function CreateAnswerHeaders(catalog, answer, values = {})
{
    return {
        "x-carbon-answer": answer,
        "x-carbon-target": catalog.target,
        "x-carbon-game": catalog.game,
        "x-carbon-provider": catalog.provider,
        "x-carbon-build": catalog.build,
        ...(catalog.client ? { "x-carbon-client": catalog.client } : {}),
        ...(values.hull ? { "x-carbon-sof-hull": values.hull } : {}),
        ...(values.insert ? { "x-carbon-respath-insert": values.insert } : {}),
    };
}

/**
 * The plural route segment for each celestial kind.
 *
 * Written out rather than pluralised by rule, because "asteroidBelt" does not
 * pluralise the way the others do and a rule that gets it wrong produces a
 * route that 404s for one kind only.
 */
const MAP_SYSTEM_COLLECTIONS = Object.freeze({
    stars: "star",
    planets: "planet",
    moons: "moon",
    belts: "asteroidBelt",
    asteroidbelts: "asteroidBelt",
    stations: "station",
    stargates: "stargate",
    // The name a player uses. Kept as an alias rather than the canonical form,
    // since the export, the client and every other tool say stargate.
    jumpgates: "stargate"
});

function CreateSdeHeaders(source)
{
    return {
        "x-carbon-answer": "sde",
        "x-carbon-target": source.target,
        "x-carbon-game": source.game,
        "x-carbon-provider": source.provider,
        "x-carbon-build": source.build,
    };
}

function CreateSkinHeaders(library, topic)
{
    return {
        "x-carbon-answer": topic,
        "x-carbon-target": library.sourceTarget,
        "x-carbon-game": library.sourceGame,
        "x-carbon-provider": library.sourceProvider,
        "x-carbon-build": library.sourceBuild,
    };
}

function CreateWeaponHeaders(library)
{
    return {
        "x-carbon-answer": "weapons",
        "x-carbon-target": library.sourceTarget,
        "x-carbon-game": library.sourceGame,
        "x-carbon-provider": library.sourceProvider,
        "x-carbon-build": library.sourceBuild,
    };
}

function WriteWeaponMapRoute(response, headers, segments, records, label)
{
    if (segments.length === 1)
    {
        WriteJson(response, 200, records, headers);

        return;
    }

    if (segments.length === 2 && Object.hasOwn(records, segments[1]))
    {
        WriteJson(response, 200, records[segments[1]], headers);

        return;
    }

    WriteJson(response, 404, {
        error: segments.length === 2
            ? `${label} not found: ${segments[1]}`
            : `${label} route not found`,
    }, headers);
}

function LookupWeaponName(library, name)
{
    return library.names?.[NormalizeSkinName(name)] ?? [];
}

function SearchWeaponName(library, name)
{
    const expected = NormalizeSkinSearchName(name);
    const candidates = new Map();

    for (const [ candidateName, values ] of Object.entries(library.names ?? {}))
    {
        if (NormalizeSkinSearchName(candidateName) !== expected) continue;

        for (const value of values)
        {
            candidates.set(`${value.kind}:${value.typeID}`, value);
        }
    }

    return [ ...candidates.values() ].sort((left, right) =>
        String(left.kind).localeCompare(String(right.kind), "en")
        || Number(left.typeID) - Number(right.typeID));
}

function LookupSkinName(library, name)
{
    return library.names?.[NormalizeSkinName(name)] ?? [];
}

function SearchSkinName(library, name)
{
    const expected = NormalizeSkinSearchName(name);
    const candidates = new Map();

    for (const [ candidateName, values ] of Object.entries(library.names ?? {}))
    {
        if (NormalizeSkinSearchName(candidateName) !== expected) continue;

        for (const value of values)
        {
            const key = `${value.kind}:${value.typeID}:${value.skinID ?? ""}`;

            candidates.set(key, value);
        }
    }

    return [ ...candidates.values() ].sort((left, right) =>
        String(left.kind).localeCompare(String(right.kind), "en")
        || Number(left.typeID) - Number(right.typeID)
        || Number(left.skinID ?? -1) - Number(right.skinID ?? -1));
}

function NormalizeSkinName(value)
{
    const name = String(value ?? "").trim();

    if (!name)
    {
        throw new TypeError("SKIN name must be non-empty");
    }

    return name.toLocaleLowerCase("en-US");
}

function NormalizeSkinSearchName(value)
{
    return NormalizeSkinName(value)
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/gu, " ");
}

function CreateCharacterHeaders(library, route)
{
    const data = typeof library.GetSourceIdentity === "function"
        ? library.GetSourceIdentity()
        : library;

    return {
        "x-carbon-answer": "character",
        "x-carbon-target": data.sourceTarget || route.target,
        "x-carbon-game": data.sourceGame || "",
        "x-carbon-provider": data.sourceProvider || "",
        "x-carbon-build": data.sourceBuild || route.build,
    };
}

function ReadFormatJson(path, bytes)
{
    if (!CjsToolBlack.isBlackPath(path))
    {
        const error = new Error(`format=json is not supported for this resource: ${path}`);

        error.statusCode = 415;
        throw error;
    }

    return CjsToolBlack.readJson(bytes);
}

function normalizeRouteSegment(value)
{
    return String(value).trim().toLowerCase();
}

function RequireSofName(value, label)
{
    const name = String(value ?? "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name))
    {
        throw new TypeError(`${label} must be one safe path segment`);
    }

    return name;
}

function RequireSofDna(value)
{
    const dna = String(value ?? "").trim();

    if (!dna || dna.includes("/") || dna.includes("\\"))
    {
        throw new TypeError("SOF DNA must be one non-empty URL path segment");
    }

    return dna;
}

/**
 * Holds the pair to its one rule: the SDE is never newer than the resources.
 *
 * The export channel usually trails the client, but it does not have to, and a
 * pair with the export ahead is the broken one — it names types whose resources
 * do not exist yet, so a lookup succeeds and the model behind it 404s. Trailing
 * can only omit.
 *
 * Naming the resource build as the ceiling is also the whole fallback: asking
 * the SDE repository for that build means "the export at or below it", which is
 * exactly what it does — probe that build, and trail to the newest prepared one
 * at or below it when there is no export of its own. Build numbers cannot be
 * enumerated on either side, so walking back through candidates is not an
 * option; handing the ceiling to the side that can probe is.
 */
function ClampSdeBuild(sdeBuild, resourceBuild)
{
    const sde = String(sdeBuild);

    return Number(sde) > Number(resourceBuild) ? String(resourceBuild) : sde;
}

function RetainNewest(cache, limit)
{
    while (cache.size > limit)
    {
        cache.delete(cache.keys().next().value);
    }
}

function CreateResourceCacheHeaders(build, resolution, refresh)
{
    if (refresh)
    {
        return { "cache-control": "no-store" };
    }

    const checksum = resolution?.record?.checksum ?? resolution?.record?.md5 ?? null;

    return {
        "cache-control": utils.isExactBuild(build)
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300, must-revalidate",
        ...(checksum ? { etag: `"${checksum}"` } : {}),
    };
}

function IsNotModified(request, etag)
{
    if (!etag)
    {
        return false;
    }

    const expected = String(etag).replace(/^W\//u, "");
    const candidates = String(request.headers?.["if-none-match"] ?? "")
        .split(",")
        .map(value => value.trim().replace(/^W\//u, ""));

    return candidates.includes("*") || candidates.includes(expected);
}

async function ReadJson(request, maxBytes)
{
    const chunks = [];
    let byteLength = 0;

    for await (const chunk of request)
    {
        byteLength += chunk.byteLength;

        if (byteLength > maxBytes)
        {
            const error = new Error("Request body is too large");

            error.statusCode = 413;
            throw error;
        }

        chunks.push(chunk);
    }

    try
    {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

        if (!value || typeof value !== "object" || Array.isArray(value))
        {
            throw new TypeError("JSON root must be an object");
        }

        return value;
    }
    catch (error)
    {
        if (error.statusCode)
        {
            throw error;
        }

        const wrapped = new Error(`Invalid JSON request: ${error.message}`);

        wrapped.statusCode = 400;
        throw wrapped;
    }
}

/** What ESI requires before it will list a character's saved fittings. */
/**
 * Skill identifiers from a query string or a JSON body.
 *
 * Identifiers only. A level was accepted here once and it was noise: a skill's
 * prerequisites are fixed on the skill and do not vary with the level being
 * trained to, so the parameter could only ever be ignored. Objects carrying one
 * are still read, so a caller that sends `{ typeID }` is not punished for it.
 */
function SkillPlanTargets(value)
{
    const raw = Array.isArray(value)
        ? value
        : String(value ?? "").split(/[\s,]+/u);

    const ids = [];

    for (const entry of raw)
    {
        // "3327:5" is tolerated and the level discarded, because that shape was
        // published briefly and a stale caller should still get an answer.
        const id = Number(typeof entry === "object" && entry !== null
            ? entry.typeID
            : String(entry ?? "").split(":")[0]);

        if (Number.isSafeInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
    }

    return ids;
}

export const FITTINGS_SCOPE = "esi-fittings.read_fittings.v1";
export const SKILLS_SCOPE = "esi-skills.read_skills.v1";

/**
 * The states a character-scoped route has to tell apart before it calls ESI.
 *
 * Writes the response and returns false when the session cannot answer, so each
 * leg reads as one guard rather than four. `scope` is checked only when the
 * stored token recorded what it was granted: tokens written before that was
 * captured have no list, and refusing those would break a working session over
 * missing bookkeeping - so an absent list falls through and ESI decides.
 */
function RequireEsiSession(stored, response, scope = null)
{
    if (!stored?.refreshToken)
    {
        WriteJson(response, 401, { error: "Not signed in to EVE. Run: npm run login:eve" });

        return false;
    }

    if (!stored.characterId)
    {
        WriteJson(response, 409, {
            error: "Stored session has no character. Sign in again: npm run login:eve",
        });

        return false;
    }

    if (scope && Array.isArray(stored.scopes) && stored.scopes.length && !stored.scopes.includes(scope))
    {
        WriteJson(response, 403, {
            error: `Stored session lacks ${scope}. Add it to CJS_ESI_SCOPES and sign in again: npm run login:eve`,
            scope,
        });

        return false;
    }

    return true;
}

/**
 * One ESI fitting, in the shape everything downstream uses.
 *
 * `items` keeps ESI's `flag` because it is the only published statement of
 * where the pilot actually had each module, which neither EFT nor fitting DNA
 * carries.
 */
function NormalizeEsiFitting(fitting)
{
    return {
        fittingID: fitting?.fitting_id ?? null,
        name: fitting?.name ?? null,
        description: fitting?.description ?? "",
        shipTypeID: fitting?.ship_type_id ?? null,
        items: (fitting?.items ?? []).map(item => ({
            typeID: item?.type_id ?? null,
            flag: item?.flag ?? null,
            quantity: item?.quantity ?? null,
        })),
    };
}

/**
 * The export English names are borrowed from when an export has none.
 *
 * CCP's, because it is the only one that publishes English at all, and because
 * the NetEase exports are derived from the same type IDs — which is what makes
 * the crosswalk checkable rather than a guess.
 */
export const ENGLISH_REFERENCE_TARGET = "eve";

/** The hand-written names, read once and reused. */
let manualNameFile;

async function ReadManualNameFile()
{
    if (manualNameFile !== undefined) return manualNameFile;

    try
    {
        const location = new URL("../localisation/en.json", import.meta.url);

        manualNameFile = JSON.parse(await fs.readFile(location, "utf8"));
    }
    catch
    {
        // A missing or unreadable file means no manual names, not a broken
        // service: everything the crosswalk can name is still named.
        manualNameFile = {};
    }

    return manualNameFile;
}

/**
 * The GET form of a dogma request: `/dogma/types/{typeID}`.
 *
 * There is no way to supply skills here, and that is the point - a GET is the
 * published hull, cacheable by URL alone. Returns undefined when the path is
 * not one this topic serves.
 */
function ReadDogmaPath(segments, url)
{
    if (segments.length !== 2 || segments[0].toLowerCase() !== "types") return undefined;

    const sections = url.searchParams.get("sections");

    return {
        typeID: segments[1],
        profile: { mode: "none" },
        sections: sections ? sections.split(",").map(entry => entry.trim()).filter(Boolean) : undefined
    };
}

function WriteError(response, error)
{
    if (response.headersSent || response.writableEnded)
    {
        response.destroy(error);

        return;
    }

    const statusCode = Number.isInteger(error?.statusCode)
        ? error.statusCode
        : error instanceof TypeError
            ? 400
            : 500;

    WriteJson(response, statusCode, {
        error: statusCode === 500 ? "Internal tool error" : error.message
    }, error?.headers ?? {});
}

function WriteJson(response, statusCode, value, headers = {})
{
    const body = `${JSON.stringify(value)}\n`;

    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
        ...headers,
    });
    response.end(body);
}

function WriteBytes(response, statusCode, value, headers = {})
{
    const body = Buffer.from(value);

    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "content-type": "application/octet-stream",
        "content-length": body.byteLength,
        "cache-control": "no-store",
        ...headers,
    });
    response.end(body);
}

/** One line of plain text, for the browser leg of an OAuth callback. */
function WriteText(response, statusCode, text)
{
    const body = `${text}\n`;

    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "content-type": "text/plain; charset=utf-8",
        "content-length": Buffer.byteLength(body),
    });
    response.end(body);
}

/**
 * Reduces a provider-supplied error code to something safe to render.
 *
 * The callback's query is attacker-influenced - anyone can open the callback
 * url with whatever parameters they like - and the response is HTML-adjacent
 * text in a browser. Only a short identifier survives.
 */
function SafeCode(value)
{
    return String(value).replace(/[^a-z0-9_-]/giu, "").slice(0, 40) || "unknown";
}

function WriteEmpty(response, statusCode, headers = {})
{
    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "content-length": 0,
        "cache-control": "no-store",
        ...headers,
    });
    response.end();
}

function WriteHead(response, statusCode, headers = {})
{
    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "cache-control": "no-store",
        ...headers,
    });
    response.end();
}
