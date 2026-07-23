/**
 * Supplies indexed audio-library paths to the generic prefetch executor.
 */
export class CjsToolAudioPrefetch
{

    #audio;

    constructor({ audio } = {})
    {
        if (!audio || typeof audio.OpenTarget !== "function")
        {
            throw new TypeError(
                "CjsToolAudioPrefetch audio must open target libraries",
            );
        }

        this.#audio = audio;
        this.name = "audio";
        Object.freeze(this);
    }

    /** Resolves all indexed loose-media and bank paths for one exact build. */
    async Resolve({ target, build })
    {
        const source = await this.#audio.OpenTarget(target, build);

        if (typeof source?.ListSourcePaths !== "function")
        {
            throw new TypeError(
                "Audio source must provide ListSourcePaths() for prefetch",
            );
        }

        const paths = source.ListSourcePaths().filter(
            path => /^(?:app|res):\//iu.test(path),
        );

        if (!paths.length)
        {
            throw new Error(
                `Audio library has no indexed source paths for ${target} build ${build}`,
            );
        }

        return paths;
    }

}
