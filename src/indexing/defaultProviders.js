export const DefaultProviderData = Object.freeze([
    Object.freeze({
        game: "Eve",
        id: "ccp",
        label: "EVE Online resources",
        defaultBuildRef: "latest",
        remote: Object.freeze({
            metadataBaseUrl: "https://binaries.eveonline.com",
            indexBaseUrl: "https://binaries.eveonline.com",
            appBaseUrl: "https://binaries.eveonline.com",
            resBaseUrl: "https://resources.eveonline.com",
        }),
        // `metadataToken` is the only thing recorded per client, and it is not
        // derivable from the client's name: tranquility's is TQ, singularity's
        // is SISI. The daily metadata file is `eveclient_<TOKEN>.json` and it is
        // case sensitive, so `eveclient_tq.json` is a 404.
        //
        // The install folder is the same string in lower case —
        // `<clientRoot>/tq/`, where that client's own `resfileindex.txt` lives —
        // so it is derived rather than listed. It used to be listed, as
        // `aliases: ["tq"]`, which read as extra spellings of the name and was
        // inert: the lookup already derived `tq` from the token, so the entry
        // restated a fact nothing was missing. `localFolder` overrides the
        // derivation for a client that breaks the convention.
        clients: Object.freeze({
            tranquility: Object.freeze({ metadataToken: "TQ" }),
            singularity: Object.freeze({ metadataToken: "SISI" }),
            thunderdome: Object.freeze({ metadataToken: "THUNDERDOME" }),
            chaos: Object.freeze({ metadataToken: "CHAOS" }),
        }),
    }),
    // Serenity and Infinity are separate providers rather than one provider
    // with two clients. They are not two shards of one service: Infinity has a
    // different map and different game mechanics from Serenity, and each of the
    // two carries SKINs the other does not.
    //
    // Two reasons it has to be the provider and not just the client:
    //
    //   - `latest` on a provider resolves to the highest build across its
    //     clients. Under one provider that was a race between two different
    //     games, won by whichever had moved most recently.
    //   - a prepared SDE is cached by game and provider. Theirs are *generated*
    //     per client rather than acquired, so under one provider the second one
    //     built would overwrite the first.
    //
    // Their remote blocks are identical today and are still written out twice.
    // A provider owns everything about itself; two of them agreeing on a URL is
    // a fact about this moment, not a relationship, and factoring it out would
    // make one provider moving its CDN look like a change to the other.
    //
    // Splitting them costs no downloads. Resource files are stored under one
    // flat `ResFiles/` root addressed by their own fnv+md5, with no game,
    // provider or build in the path, so identical bytes are fetched once
    // however many providers name them, and these two share 130,209 of about
    // 131,000 files. Only *generated* artifacts are namespaced by game and
    // provider, and they have to be: they are built rather than downloaded, so
    // there is no content hash to make them agree, and two of them under one
    // provider id would overwrite each other.
    Object.freeze({
        game: "Eve",
        id: "serenity",
        label: "Serenity resources",
        defaultBuildRef: "latest",
        remote: Object.freeze({
            metadataBaseUrl: "https://eve-china-version-files.oss-cn-hangzhou.aliyuncs.com",
            indexBaseUrl: "https://eve-china-version-files.oss-cn-hangzhou.aliyuncs.com",
            appBaseUrl: "https://ma79.gdl.netease.com/eve/binaries",
            resBaseUrl: "https://ma79.gdl.netease.com/eve/resources",
        }),
        clients: Object.freeze({
            serenity: Object.freeze({ metadataToken: "SERENITY" }),
        }),
    }),
    Object.freeze({
        game: "Eve",
        id: "infinity",
        label: "Infinity resources",
        defaultBuildRef: "latest",
        remote: Object.freeze({
            metadataBaseUrl: "https://eve-china-version-files.oss-cn-hangzhou.aliyuncs.com",
            indexBaseUrl: "https://eve-china-version-files.oss-cn-hangzhou.aliyuncs.com",
            appBaseUrl: "https://ma79.gdl.netease.com/eve/binaries",
            resBaseUrl: "https://ma79.gdl.netease.com/eve/resources",
        }),
        clients: Object.freeze({
            infinity: Object.freeze({ metadataToken: "INFINITY" }),
        }),
    }),
    Object.freeze({
        game: "Frontier",
        id: "ccp",
        label: "EVE Frontier resources",
        defaultBuildRef: "latest",
        remote: Object.freeze({
            metadataBaseUrl: "https://binaries.shared.reitnorf.com",
            indexBaseUrl: "https://binaries.shared.reitnorf.com",
            appBaseUrl: "https://binaries.shared.reitnorf.com",
            resBaseUrl: "https://resources.shared.reitnorf.com",
        }),
        clients: Object.freeze({
            stillness: Object.freeze({
                metadataToken: "STILLNESS",
            }),
        }),
    }),
]);
