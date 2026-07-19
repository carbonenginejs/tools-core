import { CjsIndexReader } from "./CjsIndexReader.js";
import { CjsIndexProviderRegistry } from "./CjsIndexProviderRegistry.js";
import { CjsIndexOverlaySource } from "./CjsIndexOverlaySource.js";
import { CjsIndexOverlayStore } from "./CjsIndexOverlayStore.js";
import { CjsIndexSource } from "./CjsIndexSource.js";
import { CjsIndexCache } from "./CjsIndexCache.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";

/** Facade for complete indexes and cached remote app/res file retrieval. */
export class CjsToolIndex
{

    #fetch;

    #cache;

    #indexes;

    #overlays;

    #targets;

    /** Creates the standalone source service with a local cache by default. */
    constructor({
        providers = new CjsIndexProviderRegistry(),
        targets = new CjsToolTargetRegistry(),
        fetch = globalThis.fetch,
        cache = new CjsIndexCache(),
        overlays = null,
    } = {})
    {
        if (typeof fetch !== "function")
        {
            throw new TypeError("CjsToolIndex requires fetch");
        }

        if (cache !== null && !(cache instanceof CjsIndexCache))
        {
            throw new TypeError("CjsToolIndex cache must be a CjsIndexCache or null");
        }

        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsToolIndex targets must be a CjsToolTargetRegistry");
        }

        if (overlays !== null && !(overlays instanceof CjsIndexOverlayStore))
        {
            throw new TypeError(
                "CjsToolIndex overlays must be a CjsIndexOverlayStore or null",
            );
        }

        this.#fetch = fetch;
        this.#cache = cache;
        this.#targets = targets;
        this.#overlays = overlays;
        this.#indexes = new CjsIndexReader({ providers, fetch, cache });
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
        return this.#targets.List();
    }

    /** Resolves a short public target and build without opening file indexes. */
    async ResolveTargetBuild(targetValue, build = "latest", options = {})
    {
        const target = this.#targets.Get(targetValue);

        return this.ResolveBuild(target.CreateIndexOptions({
            build,
            client: options.client ?? target.client,
        }));
    }

    /** Reads the complete provider/build app/res index graph. */
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

    /** Opens a complete provider/build index as a cached byte source. */
    async Open(options = {})
    {
        const indexes = await this.ReadIndexes(options);

        return new CjsIndexSource({ indexes, fetch: this.#fetch, cache: this.#cache });
    }

    /** Opens cached resource access through a short public target alias. */
    async OpenTarget(targetValue, build = "latest", options = {})
    {
        const indexes = await this.ReadTargetIndexes(targetValue, build, options);
        const source = new CjsIndexSource({
            indexes,
            fetch: this.#fetch,
            cache: this.#cache,
        });

        if (!this.#overlays)
        {
            return source;
        }

        const overlays = await this.#overlays.OpenTarget(source.target, source.build, {
            game: source.game,
            provider: source.provider,
            buildRef: source.buildRef,
            client: source.client,
        });

        return overlays.length
            ? new CjsIndexOverlaySource({ source, overlays })
            : source;
    }

    #NormalizeSourceOptions(options)
    {
        if (options.target === undefined || options.target === null)
        {
            return options;
        }

        const target = this.#targets.Resolve({
            target: options.target,
            game: options.game,
            provider: options.provider,
        });

        return {
            ...options,
            target: target.id,
            game: target.game,
            provider: target.provider,
            client: options.client ?? target.client,
        };
    }

}
