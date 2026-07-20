export const DefaultTargetData = Object.freeze([
    Object.freeze({
        id: "eve",
        game: "Eve",
        provider: "ccp",
        client: "tranquility",
        libraries: Object.freeze([ "audio", "character", "shader", "skin", "skinr", "weapons" ]),
        topics: Object.freeze([ "app", "res", "sde", "skin", "skinr", "weapons" ]),
    }),
    Object.freeze({
        id: "frontier",
        game: "Frontier",
        provider: "ccp",
        client: "stillness",
        libraries: Object.freeze([ "audio", "shader" ]),
        topics: Object.freeze([ "app", "res" ]),
    }),
    Object.freeze({
        id: "netease",
        game: "Eve",
        provider: "netease",
        client: null,
        libraries: Object.freeze([]),
        topics: Object.freeze([ "app", "res" ]),
    }),
]);
