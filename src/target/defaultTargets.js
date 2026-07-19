export const DefaultTargetData = Object.freeze([
    Object.freeze({
        id: "eve",
        game: "Eve",
        provider: "ccp",
        client: null,
        libraries: Object.freeze([ "audio", "character" ]),
        topics: Object.freeze([ "app", "res", "sde" ]),
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
