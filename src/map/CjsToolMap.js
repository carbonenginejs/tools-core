/**
 * The map topic: New Eden as addressable documents.
 *
 * ## Why this is not built like `skin` or `weapons`
 *
 * Those topics build one library object per build and serve slices of it out of
 * memory. That works because they are thousands of rows. The map is 481000
 * celestials — 344457 moons alone — and a library of it would be a hundred
 * megabytes resident per open build, to answer requests that never want more
 * than one system.
 *
 * So the map is query-backed. The small, navigational half — 114 regions, 1184
 * constellations, 8490 systems, and the computed `mapIndex` — is held in
 * memory, because navigation touches all of it and it is a few megabytes. The
 * large half stays in SQLite behind the locality indexes from
 * `CjsToolSdeQueryIndexes`, and a system's contents are fetched when a system is
 * asked for.
 *
 * ## Addressing
 *
 * Every entity is addressable directly by its own id — `/map/systems/30000142`
 * — and nesting is offered for navigation, not required for access. EVE ids are
 * globally unique, so requiring `/regions/{r}/constellations/{c}/systems/{s}`
 * would force every caller to look up two ids it does not have in order to ask
 * about one it does.
 *
 * That matters for a second reason. Celestial ids are NOT separated by range:
 * `mapStars`, `mapPlanets`, `mapMoons` and `mapAsteroidBelts` all live in the
 * 40000000s and interleave — 40000002 is a planet, 40000003 a belt, 40000004 a
 * moon. Anything deciding a celestial's kind from its id is guessing, which is
 * why `/celestials/{id}` probes the tables by primary key instead.
 */

import { ReadDerivation } from "../sde/CjsToolSdeDerivations.js";
import { BuildMapIndex, MAP_INDEX_TABLES } from "./CjsToolMapIndex.js";
import { BlackbodyColor, SunIntensity } from "./CjsToolMapGeometry.js";
import {
    AsteroidBeltName,
    MoonName,
    PlanetName,
    ReadName,
    RomanNumeral,
    StarName
} from "./CjsToolMapNames.js";

/**
 * Tables held in memory for navigation. Small, and touched by every query.
 *
 * The last two are here for station names rather than navigation: 283
 * corporations and 69 station operations, both carrying localised name
 * dictionaries that a station's name is composed from.
 */
const SKELETON_TABLES = Object.freeze([
    "mapRegions",
    "mapConstellations",
    "mapSolarSystems",
    "npcCorporations",
    "stationOperations"
]);

/**
 * The language a name is reported in when the caller does not choose one.
 *
 * English, because it is the only language in which a *composed* celestial name
 * can be produced at all - see `#CelestialName`.
 */
export const DEFAULT_LANGUAGE = "en";

/**
 * The eight languages the SDE carries, from its own `translationLanguages`.
 *
 * Listed rather than read at runtime because it is a property of the SDE
 * format and a caller needs it to validate `?lang=` before making a request.
 */
export const LANGUAGES = Object.freeze([ "de", "en", "es", "fr", "ja", "ko", "ru", "zh" ]);

/**
 * What the two halves of every entity mean.
 *
 * Published fields sit at the top level exactly as the SDE holds them.
 * Everything this package computed sits under `derived`. The split is
 * structural because it is otherwise invisible: in a flat response a composed
 * celestial name and a published system name are both `name`, a rewritten
 * `.black` path and a published `.dds` path are both strings, and a consumer
 * has no way to tell which of them the data source is responsible for.
 *
 * The case that makes it worth the nesting: `name` is published for regions,
 * constellations and systems, and invented by us for every celestial. Same
 * field, same API, different provenance by level.
 */
export const MAP_PROVENANCE = Object.freeze({
    published: "top-level fields are the SDE row, verbatim",
    derived: "everything under `derived` is computed by tools-core, and is opt-in",
    languages: LANGUAGES
});

/**
 * What `?expand=` can ask for, and what each group costs.
 *
 * **Nothing is expanded by default.** The default answer is the SDE and only
 * the SDE - the same ids, in the same shape, that `/sde/{table}/{id}` would
 * give. That is the honest baseline: a caller that wants the source data gets
 * exactly the source data, and every field we invented has to be asked for by
 * name.
 *
 * It is also the smaller answer. Measured on Jita's 67 celestials, resolved
 * graphics alone are 25% of the response, and a caller drawing a route overlay
 * wants none of it.
 *
 * The groups are drawn by what a consumer needs together rather than by how
 * they are computed:
 *
 * - `name`      composed names and their published parts. Nothing else gives a
 *               celestial a name at all; the SDE has no name field for one.
 * - `transform` `orbit`, `localPosition` and a stargate's orientation - what a
 *               scene graph is built from, and the float32-safe positions.
 * - `graphics`  graphic ids resolved to loadable `.black` paths.
 * - `scene`     a system's nebula, star and derived key light.
 *
 * `all` takes every group, and is what a renderer wants.
 */
export const EXPAND_GROUPS = Object.freeze([ "name", "transform", "graphics", "scene" ]);

/** Shared empty set, so the unexpanded path allocates nothing per celestial. */
const EMPTY_EXPAND = new Set();

/**
 * The celestial tables, and the kind each one produces.
 *
 * Order is the order `/celestials/{id}` probes them and the order a system's
 * contents are listed in: outward from the star. `mapStars` is first because a
 * system has exactly one and it is the thing everything else orbits.
 */
export const CELESTIAL_TABLES = Object.freeze([
    Object.freeze({ kind: "star", table: "mapStars" }),
    Object.freeze({ kind: "planet", table: "mapPlanets" }),
    Object.freeze({ kind: "moon", table: "mapMoons" }),
    Object.freeze({ kind: "asteroidBelt", table: "mapAsteroidBelts" }),
    Object.freeze({ kind: "station", table: "npcStations" }),
    Object.freeze({ kind: "stargate", table: "mapStargates" })
]);

const MAX_SYSTEM_ROWS = 1000;

/**
 * What the numbers in a map answer mean, and where they stop being usable.
 *
 * EVE positions are float64 metres. A renderer is float32. That is not a
 * rounding detail, it is the difference between a scene that works and one
 * where objects sit in the wrong place, so the answer states it rather than
 * leaving each consumer to discover it.
 *
 * Measured against one reference build, the float32 quantum — the gap between
 * representable neighbours at that magnitude — against the size of the thing
 * being positioned:
 *
 *   frame              median error   objects smaller than their own error
 *   galactic           3.4e10 m       everything (115 light-seconds)
 *   system, moons      2.6e5 m        none: 0 of 344457 land inside their planet
 *   system, stations   6.6e4 m        91.2% (a station is ~10 km)
 *   system, stargates  2.6e5 m        99.8% (a gate is ~2.5 km)
 *   parent-relative    1.3e-1 m       0.02% of stations
 *
 * Three conclusions, and they are why the answer carries what it carries:
 *
 * **Galactic coordinates must never reach a renderer.** A system's own
 * `position` is for map layout and for the stargate rule, not for placing
 * anything. At 1e17 m the float32 quantum is two light-minutes.
 *
 * **System-relative is fine for placing bodies against each other.** The moon
 * inside its planet is the failure people expect here, and it does not happen —
 * every one of the cluster's 344457 moons clears its planet, worst case by a
 * factor of sixty.
 *
 * **System-relative is not fine for the small, built things.** A stargate is
 * 2.5 km across and its position carries a quarter-megametre of error. This is
 * where the precision actually bites, and `localPosition` is the answer for
 * everything that orbits something: relative to its parent, a station's error
 * falls from 65 km to 12 cm.
 *
 * Stargates have no `orbitID` — not one of the 13978 — so they cannot be made
 * parent-relative and a consumer that flies to one must re-origin on the camera
 * itself. Saying so is the most this layer can do about it.
 */
export const MAP_FRAME = Object.freeze({
    units: "m",
    origin: "solarSystem",
    axis: "eve",
    // Vectors are arrays, not `{x, y, z}` objects, so a consumer can hand them
    // straight to gl-matrix or a typed array without a conversion pass. The
    // component order is declared here, once, rather than carried as key names
    // on every one of a system's hundred-odd vectors - which is what makes the
    // array form self-describing enough to be worth its compactness.
    vector: "xyz",
    // Rotations are quaternions in the same spirit, identity `[0, 0, 0, 1]`.
    // `direction` is the same rotation as a plain unit vector, for a consumer
    // whose forward axis differs from the one below.
    quaternion: "xyzw",
    forward: "+z",
    up: "+y",
    handedness: "right",
    precision: Object.freeze({
        published: "float64",
        // The single most important sentence here: nothing has been rounded on
        // the way out, so a consumer that needs the exact value has it, and one
        // that truncates to float32 is making that choice knowingly.
        rounded: false,
        float32SafeForPlacement: true,
        float32SafeForDetail: false,
        preferLocalPosition: true,
        unparented: [ "stargate" ]
    })
});

/** Composes map documents for one open SDE source. */
export class CjsToolMap
{

    #source;

    #skeleton;

    #index;

    #graphics;

    // The resolved skeleton, once it exists. Held separately from the promise
    // so the summary builders can stay synchronous: every path that reaches one
    // has already awaited #Skeleton(), so by then this is populated.
    #loaded;

    /**
     * Initializes lazy navigation, graphic, and derived-index caches over one
     * exact-build source.
     */
    constructor(source)
    {
        this.#source = source;
        this.#skeleton = null;
        this.#index = null;
        this.#graphics = new Map();
        this.#loaded = null;
    }

    /** Counts and provenance, so a caller can see what it is talking to. */
    async Describe()
    {
        const skeleton = await this.#Skeleton();
        const index = await this.#Index();

        return {
            target: this.#source.target,
            game: this.#source.game,
            provider: this.#source.provider,
            build: this.#source.build,
            counts: {
                regions: skeleton.regions.size,
                constellations: skeleton.constellations.size,
                systems: skeleton.systems.size
            },
            index: {
                // Said outright, because every symptom of a missing index looks
                // like missing data rather than a missing derivation: gates
                // without rotation, and a name search that finds systems but no
                // planets or stations.
                present: index.present,
                degraded: index.degraded,
                rules: index.rules ?? null,
                counts: index.counts ?? null
            }
        };
    }

    /** Every region, ordered by name. Small enough to answer whole. */
    async Regions(options = {})
    {
        const { regions } = await this.#Skeleton();
        const language = NormalizeLanguage(options.language);
        const expand = NormalizeExpand(options.expand);

        return [ ...regions.values() ]
            .map(region => this.#RegionSummary(region, language, expand))
            .sort(ByName);
    }

    /** One region, with the nebula its systems inherit. */
    async Region(id, options = {})
    {
        const { regions } = await this.#Skeleton();
        const region = regions.get(Number(id));

        if (!region) return null;

        const language = NormalizeLanguage(options.language);

        return {
            ...this.#RegionSummary(region, language, NormalizeExpand(options.expand)),
            factionID: region.factionID ?? null,
            description: ReadName(region, "description", language),
            position: ToVector(region.position),
            constellationIDs: region.constellationIDs ?? []
        };
    }

    /** The constellations of one region. */
    async RegionConstellations(id, options = {})
    {
        const { constellations } = await this.#Skeleton();
        const regionID = Number(id);
        const language = NormalizeLanguage(options.language);
        const expand = NormalizeExpand(options.expand);

        return [ ...constellations.values() ]
            .filter(entry => Number(entry.regionID) === regionID)
            .map(entry => this.#ConstellationSummary(entry, language, expand))
            .sort(ByName);
    }

    /** One constellation. */
    async Constellation(id, options = {})
    {
        const { constellations } = await this.#Skeleton();
        const constellation = constellations.get(Number(id));

        if (!constellation) return null;

        return {
            ...this.#ConstellationSummary(
                constellation,
                NormalizeLanguage(options.language),
                NormalizeExpand(options.expand)
            ),
            factionID: constellation.factionID ?? null,
            position: ToVector(constellation.position),
            wormholeClassID: constellation.wormholeClassID ?? null,
            solarSystemIDs: constellation.solarSystemIDs ?? []
        };
    }

    /** The systems of one constellation. */
    async ConstellationSystems(id, options = {})
    {
        const { systems } = await this.#Skeleton();
        const constellationID = Number(id);
        const language = NormalizeLanguage(options.language);
        const expand = NormalizeExpand(options.expand);

        return [ ...systems.values() ]
            .filter(entry => Number(entry.constellationID) === constellationID)
            .map(entry => this.#SystemSummary(entry, language, expand))
            .sort(ByName);
    }

    /**
     * One system, with its star resolved and its scene derived.
     *
     * The scene is the point of the whole topic for a renderer: the nebula it
     * inherits from its region, and a key light whose colour and intensity come
     * from the star's own temperature and luminosity.
     */
    async System(id, options = {})
    {
        const skeleton = await this.#Skeleton();
        const system = skeleton.systems.get(Number(id));

        if (!system) return null;

        const language = NormalizeLanguage(options.language);
        const expand = NormalizeExpand(options.expand);
        const constellation = skeleton.constellations.get(Number(system.constellationID));
        const region = skeleton.regions.get(Number(system.regionID));
        const summary = this.#SystemSummary(system, language, expand);

        const published = {
            ...summary,
            constellation: constellation
                ? this.#ConstellationSummary(constellation, language, expand)
                : null,
            region: region ? this.#RegionSummary(region, language, expand) : null,
            position: ToVector(system.position),
            radius: system.radius ?? null,
            factionID: system.factionID ?? null,
            securityStatus: system.securityStatus ?? null,
            securityClass: system.securityClass ?? null,
            starID: system.starID ?? null,
            // The frame describes the numbers that are always here - `position`
            // is published and galactic - so it is not behind `?expand=`. A
            // caller reading coordinates needs to know what they mean whether or
            // not it asked for anything derived.
            frame: MAP_FRAME
        };

        if (!expand.has("scene")) return published;

        const star = await this.#Star(system, language);

        return {
            ...published,
            derived: {
                ...summary.derived,
                star,
                scene: {
                    nebula: this.#NebulaFor(system.regionID),
                    // Null rather than a guess. Nothing in the SDE or in any
                    // nebula scene names a post process for a location; it comes
                    // from environment volumes placed in space, which the SDE
                    // does not describe at all. A consumer reads
                    // null as "choose one", and could not tell an invented
                    // default from a published one.
                    postProcess: null,
                    sun: star?.light ?? null
                }
            }
        };
    }

    /**
     * Everything in one system, grouped by kind.
     *
     * One call rather than six, because a map UI showing a system wants all of
     * it and six round trips of a few milliseconds each is worse than one.
     */
    async SystemCelestials(id, options = {})
    {
        const systemID = Number(id);
        const skeleton = await this.#Skeleton();
        const system = skeleton.systems.get(systemID);

        if (!system) return null;

        const kinds = NormalizeKinds(options.kinds);
        const language = NormalizeLanguage(options.language);
        const expand = NormalizeExpand(options.expand);
        const systemName = ReadName(system, "name", language) ?? String(systemID);
        const result = {};

        for (const entry of CELESTIAL_TABLES)
        {
            if (kinds && !kinds.has(entry.kind)) continue;

            result[entry.kind] = await this.#FindBySystem(entry, systemID);
        }

        // Planets before anything that names itself through a planet. A moon's
        // name needs its planet's numeral, so the planets have to be resolved
        // first whatever order the caller asked the kinds in.
        const planets = expand.has("name") || expand.has("transform")
            ? result.planet ?? (kinds ? await this.#FindBySystem(CELESTIAL_TABLES[1], systemID) : [])
            : [];
        const planetsById = new Map(planets.map(row => [ String(row.id), row.record ]));

        // Every body in the system by id, so an orbit parent is resolved from
        // what is already loaded. A station orbits a moon, which is not among
        // the planets, so the planet map alone is not enough to re-base one.
        const byId = new Map();

        for (const [ kind, rows ] of Object.entries(result))
        {
            for (const row of rows) byId.set(String(row.id), { id: Number(row.id), kind, record: row.record });
        }

        for (const row of planets)
        {
            if (!byId.has(String(row.id))) byId.set(String(row.id), { id: Number(row.id), kind: "planet", record: row.record });
        }

        // Moons carry the stations. When the caller filtered them out the
        // stations would otherwise lose their parent and their float32-safe
        // position with it, so they are fetched for re-basing even though they
        // are not returned.
        if (expand.has("transform") && result.station && !result.moon)
        {
            for (const row of await this.#FindBySystem(CELESTIAL_TABLES[2], systemID))
            {
                if (!byId.has(String(row.id))) byId.set(String(row.id), { id: Number(row.id), kind: "moon", record: row.record });
            }
        }

        const documents = {};

        for (const [ kind, rows ] of Object.entries(result))
        {
            documents[kind] = await Promise.all(rows.map(row => this.#Celestial(
                kind,
                row.id,
                row.record,
                this.#NameContext(system, language, expand, { systemName, planetsById, byId })
            )));
        }

        return {
            solarSystemID: systemID,
            name: systemName,
            // Carried here too, so a renderer that asks only for the contents
            // of a system has the backdrop to draw them against without a
            // second request to the system and a third to its region.
            ...(expand.has("scene")
                ? { derived: { nebula: this.#NebulaFor(system.regionID) } }
                : {}),
            frame: MAP_FRAME,
            celestials: documents
        };
    }

    /**
     * One celestial of any kind, by its own id.
     *
     * Probes each table by primary key rather than deciding the kind from the
     * id, because the id ranges genuinely overlap — see this file's header.
     * Six indexed lookups cost less than one wrong guess.
     */
    async Celestial(id, options = {})
    {
        const key = String(id);

        for (const entry of CELESTIAL_TABLES)
        {
            const row = await this.#source.Table(entry.table).Get(key);

            if (!row) continue;

            const record = row.payload ?? row;
            const language = NormalizeLanguage(options.language);
            const expand = NormalizeExpand(options.expand);
            const skeleton = await this.#Skeleton();
            const system = skeleton.systems.get(Number(record.solarSystemID));
            const systemName = system
                ? ReadName(system, "name", language) ?? String(record.solarSystemID)
                : null;

            const document = await this.#Celestial(
                entry.kind,
                key,
                record,
                this.#NameContext(system, language, expand, { systemName, planetsById: null })
            );

            return { ...document, frame: MAP_FRAME };
        }

        return null;
    }

    /**
     * Name search across regions, constellations, systems and the named
     * celestials the `mapIndex` carries.
     *
     * Moons and belts are not searchable and that is deliberate, not a gap —
     * `CjsToolMapIndex` explains the trade. A search that silently omitted them
     * would be a defect; one that says so in `kinds` is a contract.
     */
    async Search(query, options = {})
    {
        const text = String(query ?? "").trim().toLocaleLowerCase("en-US");

        if (!text) throw new TypeError("Map search requires a query");

        const limit = NormalizeLimit(options.limit, 25);
        const kinds = NormalizeKinds(options.kinds);
        const language = NormalizeLanguage(options.language);
        const expand = NormalizeExpand(options.expand);
        const skeleton = await this.#Skeleton();
        const index = await this.#Index();
        const matches = [];

        const Consider = (kind, id, name, extra) =>
        {
            if (kinds && !kinds.has(kind)) return;
            if (!name) return;

            const lower = name.toLocaleLowerCase("en-US");
            const at = lower.indexOf(text);

            if (at < 0) return;

            // Rank by where the match falls and how much of the name it is, so
            // "Jita" puts the system above "Jita IV - Moon 4". Exact first,
            // then prefix, then length.
            matches.push({
                kind,
                id: Number(id),
                name,
                ...extra,
                _rank: [ lower === text ? 0 : 1, at === 0 ? 0 : 1, name.length ]
            });
        };

        // The three navigational kinds carry their nebula, so picking a result
        // is enough to start drawing. The named celestials do not: they are
        // reached through a system, which has one.
        for (const region of skeleton.regions.values())
        {
            Consider("region", region._key, ReadName(region, "name", language), {
                ...(expand.has("scene") ? { derived: { nebula: this.#NebulaOf(region._key) } } : {})
            });
        }

        for (const constellation of skeleton.constellations.values())
        {
            Consider("constellation", constellation._key, ReadName(constellation, "name", language), {
                regionID: constellation.regionID ?? null,
                ...(expand.has("scene") ? { derived: { nebula: this.#NebulaFor(constellation.regionID) } } : {})
            });
        }

        for (const system of skeleton.systems.values())
        {
            Consider("system", system._key, ReadName(system, "name", language), {
                constellationID: system.constellationID ?? null,
                regionID: system.regionID ?? null,
                ...(expand.has("scene") ? { derived: { nebula: this.#NebulaFor(system.regionID) } } : {})
            });
        }

        for (const [ id, entry ] of Object.entries(index.names ?? {}))
        {
            const [ kind, solarSystemID, name ] = entry;

            Consider(kind, id, name, { solarSystemID });
        }

        matches.sort(CompareRank);

        return {
            query: String(query),
            searchable: [ "region", "constellation", "system", ...(index.present ? index.namedKinds : []) ],
            total: matches.length,
            items: matches.slice(0, limit).map(({ _rank, ...rest }) => rest)
        };
    }

    // -- internals ---------------------------------------------------------

    /**
     * The nebula every level carries.
     *
     * It is a property of the region and of nothing else, so it is stamped with
     * `fromRegionID` wherever it appears below the region. That is not
     * decoration: a consumer looking at two systems with the same backdrop
     * should be able to see that they share it because they share a region, not
     * conclude that a system authored one. Picking a different system in the
     * same region changes nothing about the picture, and the field is what says
     * so before someone builds a "change the nebula" control that cannot work.
     */
    #NebulaFor(regionID)
    {
        const nebula = this.#NebulaOf(regionID);

        return nebula ? { ...nebula, fromRegionID: Number(regionID) } : null;
    }

    /**
     * `name` on these three is PUBLISHED, unlike a celestial's.
     *
     * Which is the whole reason for the `derived` split: this `name` is the
     * source's own localised string in the language asked for, and a celestial's
     * is a
     * sentence we assembled. A consumer treating them alike will translate one
     * of them and be wrong.
     */
    #RegionSummary(region, language, expand)
    {
        return WithDerived({
            kind: "region",
            id: region._key,
            name: ReadName(region, "name", language),
            nebulaID: region.nebulaID ?? null
        }, expand?.has("scene") ? { nebula: this.#NebulaOf(region._key) } : {});
    }

    /**
     * Projects a localized constellation summary with an optional inherited
     * nebula.
     */
    #ConstellationSummary(constellation, language, expand)
    {
        return WithDerived({
            kind: "constellation",
            id: constellation._key,
            name: ReadName(constellation, "name", language),
            regionID: constellation.regionID ?? null
        }, expand?.has("scene") ? { nebula: this.#NebulaFor(constellation.regionID) } : {});
    }

    /**
     * Projects localized system identity, hierarchy, security, and requested
     * scene details.
     */
    #SystemSummary(system, language, expand)
    {
        return WithDerived({
            kind: "system",
            id: system._key,
            name: ReadName(system, "name", language),
            constellationID: system.constellationID ?? null,
            regionID: system.regionID ?? null,
            securityStatus: system.securityStatus ?? null
        }, expand?.has("scene") ? { nebula: this.#NebulaFor(system.regionID) } : {});
    }

    /**
     * The region's background, resolved to a loadable path.
     *
     * Shaped like every other graphic in the answer: `graphicID` is the
     * provenance pointer and `graphics` maps a role to a loadable path. The
     * nebula's role is `scene` where a celestial's is `model`, but the rule is
     * the same one - which it was not before, when the nebula carried a
     * verbatim `graphicFile` beside a `scenePath`, the star carried a bare
     * `graphicFile`, and celestials carried a `graphics` object. Three shapes
     * for one idea is three things to learn and two of them to get wrong.
     *
     * The verbatim source string is gone rather than duplicated: `graphicID`
     * already points at it, and `/sde/graphics/{id}` returns it unmodified for
     * anyone who needs to see what was rewritten.
     *
     * Two graphic lookups per region at most, and they are cached, because 114
     * regions share far fewer nebulae than they have ids.
     */
    async #ResolveNebula(region)
    {
        if (region?.nebulaID == null) return null;

        const graphic = await this.#Graphic(region.nebulaID);

        return {
            graphicID: region.nebulaID,
            graphics: { scene: ToResourcePath(graphic?.graphicFile ?? null) }
        };
    }

    /** The system's star, with the derived light a renderer actually wants. */
    async #Star(system, language)
    {
        if (system?.starID == null) return null;

        const row = await this.#source.Table("mapStars").Get(String(system.starID));

        if (!row) return null;

        const record = row.payload ?? row;
        const statistics = record.statistics ?? {};
        const graphic = await this.#TypeGraphic(record.typeID);

        return {
            id: Number(system.starID),
            typeID: record.typeID ?? null,
            radius: record.radius ?? null,
            // Always the origin, and stated rather than omitted - see
            // CelestialPosition. Everything in the system is positioned
            // relative to this point.
            position: SYSTEM_ORIGIN,
            name: {
                text: StarName(ReadName(system, "name", language) ?? String(system._key)),
                language,
                connectives: "en",
                parts: { system: system.name ?? null }
            },
            // `graphics.model`, the same shape every other celestial uses. The
            // star reached through `/celestials/{id}` already answered that way,
            // so a bare `graphicFile` here meant one value under two names
            // depending on which route you arrived by.
            graphics: { model: graphic },
            spectralClass: statistics.spectralClass ?? null,
            temperature: statistics.temperature ?? null,
            luminosity: statistics.luminosity ?? null,
            light: {
                color: BlackbodyColor(statistics.temperature),
                intensity: SunIntensity(statistics.luminosity),
                // Named so nobody mistakes the pair for a measurement. The
                // colour is physics; the intensity is a presentation curve over
                // a quantity that is not an intensity, and `SunIntensity` says
                // exactly what it does.
                derivedFrom: { temperature: "blackbody", intensity: "luminosity-curve" }
            }
        };
    }

    /** One celestial as a document, whatever kind it is. */
    async #Celestial(kind, id, record, context)
    {
        const orbit = await this.#Orbit(record, context);
        const position = CelestialPosition(kind, record);

        // Published, verbatim. Anything under `derived` below is ours, and the
        // division is structural rather than documented because the two are
        // otherwise indistinguishable in the response - see MAP_PROVENANCE.
        const published = {
            kind,
            id: Number(id),
            solarSystemID: record.solarSystemID ?? null,
            typeID: record.typeID ?? null,
            position,
            radius: record.radius ?? null,
            orbitID: record.orbitID ?? null,
            ...(kind === "stargate" ? { destination: record.destination ?? null } : {}),
            ...(kind === "station"
                ? {
                    ownerID: record.ownerID ?? null,
                    operationID: record.operationID ?? null,
                    reprocessingEfficiency: record.reprocessingEfficiency ?? null
                }
                : {}),
            ...(kind === "planet" || kind === "moon" || kind === "asteroidBelt" || kind === "star"
                ? {
                    celestialIndex: record.celestialIndex ?? null,
                    orbitIndex: record.orbitIndex ?? null,
                    statistics: record.statistics ?? null
                }
                : {}),
            ...(kind === "planet"
                ? { moonIDs: record.moonIDs ?? [], asteroidBeltIDs: record.asteroidBeltIDs ?? [] }
                : {})
        };

        const expand = context?.expand ?? EMPTY_EXPAND;
        const derived = {};

        if (expand.has("name"))
        {
            derived.name = await this.#CelestialName(kind, id, record, context);
        }

        if (expand.has("transform"))
        {
            // What the parent is, not just its id. A consumer building a scene
            // graph needs to know whether to hang this off a planet or a moon,
            // and the id alone does not say - the ranges overlap.
            derived.orbit = orbit ? { id: orbit.id, kind: orbit.kind } : null;
            // The float32-safe form. See MAP_FRAME: for a station this is the
            // difference between 12cm and 65km of error.
            derived.localPosition = Subtract(position, ParentOrigin(orbit));

            if (kind === "stargate")
            {
                const index = await this.#Index();
                const gate = index.stargates?.[String(id)] ?? null;

                derived.orientation = {
                    // Both, always. `direction` is convention-free and is the
                    // honest answer; `rotation` is a convenience under the
                    // frame's stated convention, which a consumer may not share.
                    direction: gate?.direction ?? null,
                    rotation: gate?.rotation ?? null,
                    rule: gate ? "faces-destination-system" : null
                };
            }
        }

        if (expand.has("graphics"))
        {
            derived.graphics = await this.#CelestialGraphics(record);
        }

        return WithDerived(published, derived);
    }

    /**
     * A celestial's name, from the index when it has one and composed when it
     * does not.
     *
     * Moons and belts always take the composed path, since the index does not
     * carry them. Inside a system listing their planet is already loaded, so
     * this costs nothing; asked for individually, the planet is fetched.
     */
    async #CelestialName(kind, id, record, context)
    {
        const index = await this.#Index();
        const named = index.names?.[String(id)];
        const systemName = context?.systemName ?? null;

        let text = named ? named[2] : null;

        if (text === null && systemName !== null)
        {
            if (kind === "moon" || kind === "asteroidBelt")
            {
                const planet = context.planetsById?.get(String(record.orbitID))
                    ?? await this.#PlanetRecord(record.orbitID);

                text = kind === "moon"
                    ? MoonName(systemName, planet, record)
                    : AsteroidBeltName(systemName, planet, record);
            }
            else if (kind === "planet") text = PlanetName(systemName, record);
            else if (kind === "star") text = StarName(systemName);
        }

        if (text === null) return null;

        return {
            text,
            // The composed string is English and only English, and `connectives`
            // says which part of it we invented.
            //
            // Every *component* is published in all eight languages the SDE
            // carries - the system's name, an owning corporation's name, a
            // station operation's name. The words that join them are not:
            // "Moon", "Asteroid Belt", "Star", "Stargate", the roman numeral
            // and the " - " ordering live in the game's own localisation data,
            // which the SDE does not carry at all.
            //
            // So `text` cannot be localised here without inventing eight
            // languages of connective, and half-localising it - the parts
            // translated, the joins not - would be worse than leaving it
            // English, because it would look translated. `parts` carries the
            // components in the language asked for, so a consumer holding the
            // game's label strings can compose any language properly, and one
            // without can see exactly which words are ours.
            language: context?.language ?? DEFAULT_LANGUAGE,
            connectives: "en",
            parts: this.#NameParts(kind, record, context)
        };
    }

    /**
     * Everything `#CelestialName` needs to name and localise one body.
     *
     * Built once per request rather than per celestial: a system with 344
     * moons would otherwise look up the same corporation table 344 times.
     */
    #NameContext(system, language, expand, extra)
    {
        return {
            ...extra,
            expand,
            language,
            // The system's name as a full localised dictionary, not collapsed.
            // A consumer composing its own celestial names needs the language it
            // is composing in, and that is not necessarily the one it asked the
            // rest of the answer in.
            systemNameParts: system ? system.name ?? null : null,
            corporations: this.#loaded?.corporations ?? {},
            operations: this.#loaded?.operations ?? {}
        };
    }

    /** The published components a celestial's name is built from. */
    #NameParts(kind, record, context)
    {
        const language = context?.language ?? DEFAULT_LANGUAGE;
        const parts = { system: context?.systemNameParts ?? null };

        if (kind === "planet" || kind === "moon" || kind === "asteroidBelt")
        {
            const planet = kind === "planet"
                ? record
                : context?.planetsById?.get(String(record.orbitID)) ?? null;

            parts.planetNumeral = RomanNumeral(planet?.celestialIndex ?? record.celestialIndex);
        }

        if (kind === "moon" || kind === "asteroidBelt") parts.orbitIndex = record.orbitIndex ?? null;

        if (kind === "station")
        {
            // Both are localised dictionaries in the SDE, and both were
            // being collapsed to English before they ever reached a consumer.
            parts.corporation = ReadName(context?.corporations?.[record.ownerID], "name", language);
            parts.operation = ReadName(
                context?.operations?.[record.operationID], "operationName", language
            );
        }

        return parts;
    }

    /**
     * The body a celestial orbits, resolved to a kind and a record.
     *
     * Inside a system listing the parent is already in hand, which is why
     * `context.byId` exists: without it, naming and re-basing 344457 moons
     * would each cost a lookup. Asked for individually, the parent is probed
     * the same way `Celestial` probes - by primary key across the tables,
     * because an orbit id does not say what kind of thing it points at.
     */
    async #Orbit(record, context)
    {
        if (record?.orbitID == null) return null;

        const key = String(record.orbitID);
        const known = context?.byId?.get(key);

        if (known) return known;

        for (const entry of CELESTIAL_TABLES)
        {
            const row = await this.#source.Table(entry.table).Get(key);

            if (row) return { id: Number(record.orbitID), kind: entry.kind, record: row.payload ?? row };
        }

        return null;
    }

    /**
     * Reads the planet payload for an orbit identifier, returning null when it
     * is absent.
     */
    async #PlanetRecord(orbitID)
    {
        if (orbitID == null) return null;

        const row = await this.#source.Table("mapPlanets").Get(String(orbitID));

        return row ? row.payload ?? row : null;
    }

    /**
     * Flattened graphic paths for a celestial.
     *
     * The SDE gives graphic *ids* in two places and they mean different
     * things: `typeID` points at the model through `types.graphicID`, while a
     * planet's or moon's `attributes` name a shader preset and two height maps
     * directly. A consumer that wants to draw the body needs all of them
     * resolved to resource paths, and resolving them one id at a time over HTTP
     * is four extra round trips per celestial.
     */
    async #CelestialGraphics(record)
    {
        const attributes = record.attributes ?? {};
        const graphics = { model: await this.#TypeGraphic(record.typeID) };

        for (const [ key, field ] of [
            [ "shaderPreset", "shaderPreset" ],
            [ "heightMap1", "heightMap1" ],
            [ "heightMap2", "heightMap2" ]
        ])
        {
            if (attributes[field] == null) continue;

            const graphic = await this.#Graphic(attributes[field]);

            if (graphic?.graphicFile) graphics[key] = ToResourcePath(graphic.graphicFile);
        }

        return graphics;
    }

    /** `types.graphicID` -> `graphics.graphicFile`, cached. */
    async #TypeGraphic(typeID)
    {
        if (typeID == null) return null;

        const cacheKey = `type:${typeID}`;

        if (this.#graphics.has(cacheKey)) return this.#graphics.get(cacheKey);

        const row = await this.#source.Table("types").Get(String(typeID));
        const graphicID = (row?.payload ?? row)?.graphicID ?? null;
        const graphic = graphicID == null ? null : await this.#Graphic(graphicID);
        const file = ToResourcePath(graphic?.graphicFile ?? null);

        this.#graphics.set(cacheKey, file);

        return file;
    }

    /** Reads and memoizes one graphics-table payload by identifier. */
    async #Graphic(graphicID)
    {
        const cacheKey = `graphic:${graphicID}`;

        if (this.#graphics.has(cacheKey)) return this.#graphics.get(cacheKey);

        const row = await this.#source.Table("graphics").Get(String(graphicID));
        const record = row ? row.payload ?? row : null;

        this.#graphics.set(cacheKey, record);

        return record;
    }

    /** Rows of one celestial table belonging to one system. */
    async #FindBySystem(entry, systemID)
    {
        const rows = await this.#source
            .Table(entry.table)
            .Find("solarSystemID", String(systemID), { limit: MAX_SYSTEM_ROWS });

        return rows.map(row => ({ id: row.id, record: row.payload ?? row }));
    }

    /** The navigational tables, loaded once per open source. */
    async #Skeleton()
    {
        this.#skeleton ??= this.#Load();

        return this.#skeleton;
    }

    /**
     * The navigational tables, plus every region's nebula resolved up front.
     *
     * Resolving the nebulae here rather than per request is what lets every
     * level of the answer carry one. The background belongs to the region, but
     * a consumer asking for a system should not have to walk up two levels and
     * make two more requests to find out what it is standing in — that is three
     * round trips to draw one backdrop.
     *
     * It is affordable because there are only 114 regions, and they share far
     * fewer nebulae than they have ids, so this is a few dozen graphic lookups
     * once per open source. Doing it lazily per summary would be the same work
     * spread over every list request and would make the summaries async for no
     * gain.
     */
    async #Load()
    {
        const tables = await this.#source.LoadTables(SKELETON_TABLES);
        const regions = ToKeyedMap(tables.mapRegions);
        const nebulae = new Map();

        for (const region of regions.values())
        {
            nebulae.set(region._key, await this.#ResolveNebula(region));
        }

        this.#loaded = {
            regions,
            constellations: ToKeyedMap(tables.mapConstellations),
            systems: ToKeyedMap(tables.mapSolarSystems),
            corporations: tables.npcCorporations ?? {},
            operations: tables.stationOperations ?? {},
            nebulae
        };

        return this.#loaded;
    }

    /** The resolved nebula for a region id, inherited by everything inside it. */
    #NebulaOf(regionID)
    {
        return this.#loaded?.nebulae.get(Number(regionID)) ?? null;
    }

    /**
     * The computed index, from disk when the import wrote one.
     *
     * The fallback rebuilds it in memory without `mapMoons`, which is honest
     * but not identical: stations orbiting moons get their planet's name rather
     * than their moon's. `degraded` says so, and `Describe` reports it, because
     * a station quietly named one level too coarse is exactly the kind of wrong
     * answer that survives a spot check.
     */
    async #Index()
    {
        this.#index ??= this.#LoadIndex();

        return this.#index;
    }

    /**
     * Loads the stored map derivation or builds an explicitly degraded in-memory
     * fallback.
     */
    async #LoadIndex()
    {
        const file = this.#source.DatabaseFile?.();
        const stored = file ? await ReadDerivation(file, "mapIndex") : null;

        if (stored)
        {
            return { ...stored, present: true, degraded: false, namedKinds: NamedKindsOf(stored) };
        }

        try
        {
            const tables = await this.#source.LoadTables(MAP_INDEX_TABLES);
            const built = BuildMapIndex(tables);

            return { ...built, present: true, degraded: true, namedKinds: NamedKindsOf(built) };
        }
        catch
        {
            return { present: false, degraded: true, stargates: {}, names: {}, namedKinds: [] };
        }
    }

}

function NamedKindsOf(index)
{
    const kinds = new Set();

    for (const entry of Object.values(index.names ?? {})) kinds.add(entry[0]);

    return [ ...kinds ];
}

/**
 * The form a resource path is emitted in: lower case.
 *
 * The SDE is not consistent about case — `res:/dx9/scene/Universe/c02_cube.red`
 * and `res:/dx9/model/WorldObject/Planet/Template_HI/...` sit beside entries
 * that are entirely lower case. The resource layer resolves either, so nothing
 * breaks at load time; what breaks is every consumer that compares two paths as
 * strings, caches by path, or deduplicates a texture list, because the same
 * asset arrives under two spellings.
 *
 * Normalising once here is cheaper than each consumer discovering it. The
 * unmodified string stays available wherever provenance matters.
 */
/**
 * `a - b`, or null when either is missing.
 *
 * Stays in float64 and does not round: this is the value a consumer converts to
 * float32 *after* it is small, which is the entire point of computing it.
 */
/** The system origin, which is where the star is. */
const SYSTEM_ORIGIN = Object.freeze([ 0, 0, 0 ]);

/**
 * `{x, y, z}` as `[x, y, z]`.
 *
 * The SDE writes vectors as objects and this answer writes them as arrays,
 * which is a deliberate break from the source shape for two reasons.
 *
 * Every consumer of this data feeds a math library, and gl-matrix, the typed
 * arrays behind it, and the engine's own vec3 all take three numbers in order.
 * An object means every reader writes the same six-line conversion, and the
 * reader that gets it wrong gets it wrong silently.
 *
 * It is also smaller by about eighteen bytes per vector, and a system with
 * sixty celestials carries a hundred and twenty of them.
 *
 * The cost is that `[a, b, c]` does not say what its components are, where
 * `{x, y, z}` does. That is paid once, in `MAP_FRAME`, which declares the order
 * for the whole answer - a better place for it than repeated on every vector in
 * the response.
 */
function ToVector(value)
{
    if (Array.isArray(value)) return value;
    if (!value) return null;

    return [ Number(value.x), Number(value.y), Number(value.z) ];
}

/**
 * A celestial's position, with the star's supplied.
 *
 * The SDE gives no `position` to any of the 8089 stars, because the star is
 * the system origin and the origin needs no coordinate. Reporting that as null
 * pushes the same special case onto every consumer, and the one that forgets it
 * puts the sun wherever its vector defaults to.
 *
 * The origin claim is measured, not assumed: across all 68023 planets the
 * distance from the origin matches the planet's own published `orbitRadius` to
 * within 0.0001%, which it could not do if the star were anywhere else.
 */
function CelestialPosition(kind, record)
{
    if (record?.position) return ToVector(record.position);

    return kind === "star" ? SYSTEM_ORIGIN : null;
}

/**
 * Where a celestial's parent sits, in system coordinates.
 *
 * A planet's parent is the star, so without the origin above it would be the
 * one class of body with no float32-safe `localPosition` at all - the class
 * that happens to need the correction least, which is exactly why the gap was
 * easy to miss.
 */
function ParentOrigin(orbit)
{
    if (!orbit) return null;

    return CelestialPosition(orbit.kind, orbit.record);
}

function Subtract(a, b)
{
    const left = ToVector(a);
    const right = ToVector(b);

    if (!left || !right) return null;

    return [ left[0] - right[0], left[1] - right[1], left[2] - right[2] ];
}

/**
 * A graphic path in the form that can actually be fetched.
 *
 * Two rewrites, and both are corrections rather than conveniences.
 *
 * **`.red` becomes `.black`.** The SDE names the legacy container; `.black`
 * is what this organization reads and what the resource route serves. Emitting
 * the SDE's own string means handing a consumer an address that 404s, which
 * is worse than emitting nothing - it looks like a resource problem rather than
 * a naming one. Verified across all twelve planet families: every template
 * fetches as `.black` and none as `.red`.
 *
 * **Case is normalised.** The SDE mixes it freely, so the same asset arrives
 * as `res:/dx9/scene/Universe/...` in one row and lower case in another. The
 * resource layer resolves either, but every consumer that compares paths as
 * strings, caches by path, or deduplicates a texture list sees two assets.
 *
 * Only the container extension is touched. A `.dds` or `.gr2` is already the
 * served form and is left alone.
 */
export function ToResourcePath(value)
{
    if (typeof value !== "string") return value;

    return value.replace(/\.red$/iu, ".black").toLocaleLowerCase("en-US");
}

function ToKeyedMap(table)
{
    const map = new Map();

    for (const [ id, record ] of Object.entries(table ?? {}))
    {
        map.set(Number(id), { ...record, _key: record?._key ?? Number(id) });
    }

    return map;
}

/**
 * The language to report published names in.
 *
 * Falls back rather than throwing on an unknown code, because a language the
 * SDE does not carry is a caller mistake that should still return the map.
 * `ReadName` falls back to English per field anyway, so an unlisted code and a
 * listed one with a missing entry behave the same way.
 */
/**
 * The `?expand=` groups a request asked for.
 *
 * Empty by default, which is the whole point: no argument means no derived
 * data. An unknown group is ignored rather than rejected, so a caller written
 * against a later version that adds a group still gets an answer from this one.
 */
function NormalizeExpand(value)
{
    if (value === true || value === "all") return new Set(EXPAND_GROUPS);

    const list = Array.isArray(value) ? value : String(value ?? "").split(",");
    const asked = list.map(entry => String(entry).trim().toLowerCase()).filter(Boolean);

    if (asked.includes("all")) return new Set(EXPAND_GROUPS);

    return new Set(EXPAND_GROUPS.filter(group => asked.includes(group.toLowerCase())));
}

/** Drops an empty `derived`, so an unexpanded answer carries no empty shell. */
function WithDerived(published, derived)
{
    return Object.keys(derived).length ? { ...published, derived } : published;
}

function NormalizeLanguage(value)
{
    const language = String(value ?? "").trim().toLowerCase();

    return LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
}

function NormalizeKinds(value)
{
    if (!value) return null;

    const list = Array.isArray(value) ? value : String(value).split(",");
    const kinds = new Set(list.map(entry => String(entry).trim()).filter(Boolean));

    return kinds.size ? kinds : null;
}

function NormalizeLimit(value, fallback)
{
    const limit = Number(value ?? fallback);

    if (!Number.isFinite(limit)) return fallback;

    return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

function ByName(left, right)
{
    return String(left.name ?? "").localeCompare(String(right.name ?? ""), "en");
}

function CompareRank(left, right)
{
    for (let i = 0; i < left._rank.length; i++)
    {
        if (left._rank[i] !== right._rank[i]) return left._rank[i] - right._rank[i];
    }

    return ByName(left, right);
}
