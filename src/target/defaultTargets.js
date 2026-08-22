export const DefaultTargetData = Object.freeze([
    Object.freeze({
        id: "eve",
        game: "Eve",
        provider: "ccp",
        client: "tranquility",
        libraries: Object.freeze([ "audio", "character", "shader", "skin", "skinr", "weapons" ]),
        topics: Object.freeze([ "app", "res", "sde", "icons", "map", "types", "skin", "skinr", "weapons" ]),
    }),
    Object.freeze({
        id: "frontier",
        game: "Frontier",
        provider: "ccp",
        client: "stillness",
        libraries: Object.freeze([ "audio", "shader" ]),
        topics: Object.freeze([ "app", "res" ]),
    }),
    // Serenity and Infinity are separate targets rather than the single entry
    // that used to stand in for both. That entry named neither, and because it
    // declared `client: null` the `latest` answer resolved to whichever of the
    // two happened to carry the higher build without saying which one it had
    // picked. Two different worlds cannot share one name.
    //
    // Neither takes its game data from `eve` any more. It did, and it was
    // wrong: borrowing showed the `eve` catalogue under another target's name
    // and hid whatever is genuinely that target's own.
    //
    // They keep the topics and lose only the sources. The two are different
    // claims: `topics` is what a target may serve, `topicSources` is whose data
    // answers when it has none of its own. Dropping the topic as well would
    // stop them serving a manually generated SDE, which is the thing that makes
    // them targets at all. So the topic stands and, until such an SDE is
    // supplied, the request fails rather than answering out of another target's
    // data. An honest failure beats a wrong answer.
    //
    // The `legacy-gles` overlay stays. That is engine shader content rather than
    // game data, resource files are content-hashed, and the two genuinely share
    // it.
    Object.freeze({
        id: "serenity",
        game: "Eve",
        provider: "netease",
        client: "serenity",
        // Every table the three libraries below read is present in this
        // target's own SDE, and all three builders were run to completion on
        // one reference build: skin (7,019 skins, 11,846 licences), skinr (487
        // components, 473 type elements, the ship-tree family) and weapons (787
        // types, 842 ammunition). That is what this list gates, so they are
        // enabled. Buildable is not the same as verified, because there is no
        // second source for this target to compare the numbers against.
        //
        // audio, character and shader are deliberately absent: they are not
        // SDE-backed and none has been run against this target at all. The
        // character readers in particular pin one reference build's contents.
        libraries: Object.freeze([ "skin", "skinr", "weapons" ]),
        topics: Object.freeze([ "app", "res", "sde", "icons", "map", "types", "skin", "skinr", "weapons" ]),
        overlaySources: Object.freeze([ Object.freeze({
            target: "eve",
            names: Object.freeze([ "legacy-gles" ]),
        }) ]),
    }),
    Object.freeze({
        id: "infinity",
        game: "Eve",
        provider: "netease",
        client: "infinity",
        // Every table the three libraries below read is present in this
        // target's own SDE, and all three builders were run to completion on
        // one reference build: skin (7,019 skins, 11,846 licences), skinr (487
        // components, 473 type elements, the ship-tree family) and weapons (787
        // types, 842 ammunition). That is what this list gates, so they are
        // enabled. Buildable is not the same as verified, because there is no
        // second source for this target to compare the numbers against.
        //
        // audio, character and shader are deliberately absent: they are not
        // SDE-backed and none has been run against this target at all. The
        // character readers in particular pin one reference build's contents.
        libraries: Object.freeze([ "skin", "skinr", "weapons" ]),
        topics: Object.freeze([ "app", "res", "sde", "icons", "map", "types", "skin", "skinr", "weapons" ]),
        overlaySources: Object.freeze([ Object.freeze({
            target: "eve",
            names: Object.freeze([ "legacy-gles" ]),
        }) ]),
    }),
]);
