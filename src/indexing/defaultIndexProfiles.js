/** Remote acquisition profiles keyed only by public target identity. */
export const DefaultIndexProfileData = Object.freeze([
    Object.freeze({
        target: "eve",
        game: "Eve",
        provider: "ccp",
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
    // Serenity and Infinity are distinct acquisition/output identities even
    // though NetEase publishes both. The target selects one client, build
    // stream, cache tree, and SDE profile; provider is provenance metadata only.
    // Their remote blocks remain explicit because an endpoint may diverge later
    // without changing either target's public identity.
    Object.freeze({
        target: "serenity",
        game: "Eve",
        provider: "netease",
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
        target: "infinity",
        game: "Eve",
        provider: "netease",
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
        target: "frontier",
        game: "Frontier",
        provider: "ccp",
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
