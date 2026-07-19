export const DefaultProviderData = Object.freeze([
    Object.freeze({
        game: "Eve",
        id: "ccp",
        label: "CCP EVE Online resources",
        defaultBuildRef: "latest",
        remote: Object.freeze({
            metadataBaseUrl: "https://binaries.eveonline.com",
            indexBaseUrl: "https://binaries.eveonline.com",
            appBaseUrl: "https://binaries.eveonline.com",
            resBaseUrl: "https://resources.eveonline.com",
        }),
        clients: Object.freeze({
            tranquility: Object.freeze({ metadataToken: "TQ", aliases: Object.freeze([ "tq" ]) }),
            singularity: Object.freeze({ metadataToken: "SISI", aliases: Object.freeze([ "sisi" ]) }),
            thunderdome: Object.freeze({ metadataToken: "THUNDERDOME", aliases: Object.freeze([]) }),
            chaos: Object.freeze({ metadataToken: "CHAOS", aliases: Object.freeze([]) }),
        }),
    }),
    Object.freeze({
        game: "Eve",
        id: "netease",
        label: "NetEase EVE China resources",
        defaultBuildRef: "latest",
        remote: Object.freeze({
            metadataBaseUrl: "https://eve-china-version-files.oss-cn-hangzhou.aliyuncs.com",
            indexBaseUrl: "https://eve-china-version-files.oss-cn-hangzhou.aliyuncs.com",
            appBaseUrl: "https://ma79.gdl.netease.com/eve/binaries",
            resBaseUrl: "https://ma79.gdl.netease.com/eve/resources",
        }),
        clients: Object.freeze({
            serenity: Object.freeze({ metadataToken: "SERENITY", aliases: Object.freeze([]) }),
            infinity: Object.freeze({ metadataToken: "INFINITY", aliases: Object.freeze([]) }),
        }),
    }),
    Object.freeze({
        game: "Frontier",
        id: "ccp",
        label: "CCP EVE Frontier resources",
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
                aliases: Object.freeze([]),
            }),
        }),
    }),
]);
