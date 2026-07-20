import * as utils from "../utils.js";

const NUMBER_LIST_PATTERN = /^[\s\[\]\(\),+\-.0-9eE]+$/u;
const PRESENTATION_GROUPS = new Set([ "backgrounds", "cameras", "characters", "lights", "positions", "posts" ]);

/** Stateless normalization of Carbon character authoring profiles. */
export class CjsToolCharacterNormalizer
{

    static normalizePresentationProfile(value, context = {})
    {
        const group = String(context.group || "");
        const id = String(context.id || "");
        if (!PRESENTATION_GROUPS.has(group))
        {
            throw new Error(`Unsupported character presentation group "${group}"`);
        }
        if (!id) throw new Error("Character presentation profile requires context.id");
        return NormalizePresentationValue(value, `presentation.${group}.${id}`);
    }

    static normalizeUniqueBlendshapeWeightsProfile(value)
    {
        const source = utils.requireObject(value, "Unique-character blendshape weights profile");
        return Object.fromEntries(Object.entries(source)
            .sort(CompareEntries)
            .map(([ name, weight ]) => [ name, ToNumber(weight) ]));
    }

    static normalizeUniqueAnimationOffsetsProfile(value)
    {
        const source = utils.requireObject(value, "Unique-character animation offsets profile");
        return Object.fromEntries(Object.entries(source)
            .sort(CompareEntries)
            .map(([ name, offset ]) => [ name, NormalizeVector(offset, 3, `animationOffsets.${name}`) ]));
    }

    static normalizeModifierNamesProfile(value)
    {
        const values = Array.isArray(value)
            ? value
            : String(value ?? "").trim().split(/\s+/u).filter(Boolean);
        return values.map((name, index) =>
        {
            const result = String(name);
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(result))
            {
                throw new Error(`Modifier name ${index} contains unsupported characters`);
            }
            return result;
        });
    }

    static normalizeFaceAnimationProfile(value)
    {
        const source = utils.requireObject(value, "Face animation profile");
        return Object.fromEntries(Object.entries(source).sort(CompareEntries).map(([ ancestry, settings ]) =>
        {
            const record = utils.requireObject(settings, `Face animation ancestry ${ancestry}`);
            return [ ancestry, Object.fromEntries([ "female", "male" ].map(sex =>
            {
                const setting = utils.requireObject(record[sex], `Face animation ancestry ${ancestry}.${sex}`);
                return [ sex, { blinkMultiplier: ToNumber(setting.BlinkMult ?? setting.blinkMultiplier) } ];
            })) ];
        }));
    }

    static normalizeFaceControlsProfile(value)
    {
        const source = utils.requireObject(value, "Face controls profile");
        return Object.fromEntries(Object.entries(source).sort(CompareEntries).map(([ name, tuple ]) =>
        {
            if (!Array.isArray(tuple) || (tuple.length !== 4 && tuple.length !== 7))
            {
                throw new TypeError(`Face control ${name} must contain 4 or 7 values`);
            }
            return [ name, tuple.map((item, index) =>
            {
                if (typeof item === "string") return item;
                if (typeof item === "number") return ToNumber(item);
                throw new TypeError(`Face control ${name}[${index}] must be a string or finite number`);
            }) ];
        }));
    }

    static normalizeFaceTweakSettingsProfile(value)
    {
        const source = utils.requireObject(value, "Face tweak settings profile");
        const gammaCurves = utils.requireObject(source.gammaCurves, "Face tweak gamma curves");
        return {
            gammaCurves: Object.fromEntries(Object.entries(gammaCurves).sort(CompareEntries)
                .map(([ name, gamma ]) => [ name, ToNumber(gamma) ])),
            wrinkleMultiplier: ToNumber(source.wrinkleMultiplier),
            correctionMultiplier: ToNumber(source.correctionMultiplier)
        };
    }

    static normalizeMaterialInfoProfile(value)
    {
        const source = utils.requireObject(value, "Character material info profile");
        const materials = utils.requireObject(source.Materials ?? source.materials, "Character material info Materials");
        return {
            materials: Object.fromEntries(Object.entries(materials).sort(CompareEntries).map(([ name, material ]) =>
            {
                const record = utils.requireObject(material, `Character material info ${name}`);
                const attributes = utils.requireObject(record.Attributes ?? record.attributes ?? {}, `Character material info ${name}.Attributes`);
                const textures = utils.requireObject(record.Textures ?? record.textures ?? {}, `Character material info ${name}.Textures`);
                return [ name, {
                    attributes: Object.fromEntries(Object.entries(attributes).sort(CompareEntries).map(([ attribute, authored ]) =>
                    {
                        const value = Array.isArray(authored) && authored.length === 1 && Array.isArray(authored[0])
                            ? authored[0]
                            : authored;
                        return [ attribute, NormalizeVector(value, 3, `materialInfo.${name}.${attribute}`) ];
                    })),
                    textures: NormalizePresentationValue(textures, `materialInfo.${name}.textures`)
                } ];
            }))
        };
    }

    static normalizeRecipeProfile(value, context = {})
    {
        if (!Array.isArray(value) || !value.length)
        {
            throw new TypeError("Character recipe profile must be a non-empty array");
        }

        const authoredSex = typeof value[0] === "string" ? value[0] : "";
        const inferredSex = String(context.id || "").split("/")[0];
        const sex = String(authoredSex || context.sex
            || ([ "female", "male" ].includes(inferredSex.toLowerCase()) ? inferredSex : ""));
        if (!sex) throw new Error("Character recipe profile is missing sex");

        return {
            id: RequireIdentity(context, "recipe"),
            name: String(context.name || context.id || ""),
            sex,
            entries: value.slice(1).map((entry, index) => NormalizeRecipeEntry(entry, index))
        };
    }

    static normalizePoseProfile(value, context = {})
    {
        const source = utils.requireObject(value, "Character pose profile");
        return {
            id: RequireIdentity(context, "pose"),
            name: String(context.name || context.id || ""),
            bones: Object.entries(source).map(([ name, pose ]) =>
            {
                const record = utils.requireObject(pose, `Character pose bone ${name}`);
                return {
                    name,
                    orientation: NormalizeVector(record.orientation, 3, `${name}.orientation`),
                    rotation: NormalizeVector(record.rotation, 3, `${name}.rotation`),
                    translation: NormalizeVector(record.translation, 3, `${name}.translation`)
                };
            })
        };
    }

    static normalizeProjectionProfile(value, context = {})
    {
        const source = utils.requireObject(value, "Character projection profile");
        return {
            id: RequireIdentity(context, "projection"),
            label: utils.optionalString(source.label ?? context.name),
            mode: ToNumber(source.mode),
            angleRotation: ToNumber(source.angleRotation),
            aspectRatio: source.aspectRatio === undefined ? 1 : ToNumber(source.aspectRatio),
            azimuth: ToNumber(source.azimuth),
            texturePath: utils.optionalString(source.texturePath),
            maskPath: utils.optionalString(source.maskPath),
            headEnabled: Boolean(source.headEnabled),
            bodyEnabled: Boolean(source.bodyEnabled),
            flipX: Boolean(source.flipx ?? source.flipX),
            flipY: Boolean(source.flipy ?? source.flipY),
            height: ToNumber(source.height),
            incline: ToNumber(source.incline),
            layer: ToInteger(source.layer),
            maskPathEnabled: Boolean(source.maskPathEnabled),
            offset: [ ToNumber(source.offsetx), ToNumber(source.offsety) ],
            pitch: ToNumber(source.pitch),
            planarBeta: ToNumber(source.planarBeta),
            planarScale: ToNumber(source.planarScale),
            position: [ ToNumber(source.posx), ToNumber(source.posy), ToNumber(source.posz) ],
            radius: ToNumber(source.radius),
            roll: ToNumber(source.roll),
            scale: ToNumber(source.scale),
            yaw: ToNumber(source.yaw)
        };
    }

    static normalizeTypeProfile(value, context = {})
    {
        if (!Array.isArray(value) || !value.length)
        {
            throw new TypeError("Character type profile must be a non-empty tuple/array");
        }

        const path = String(value[0] || "");
        if (!path) throw new Error("Character type profile is missing its part path");
        const sex = String(context.sex || InferSex(context.sourcePath) || "");
        const category = String(context.category || path.split("/")[0] || "");
        const id = String(context.id || [ sex, path ].filter(Boolean).join("/"));

        return {
            id,
            name: String(context.name || path.split("/").at(-1) || ""),
            sex,
            category,
            path,
            resourceVersion: utils.optionalString(value[1]),
            colorVariant: utils.optionalString(value[2]),
            metadataId: null,
            resourcePaths: [],
            colorIds: [],
            projectionId: null
        };
    }

    static normalizePartMetadataProfile(value, context = {})
    {
        const source = utils.requireObject(value, "Character part metadata profile");
        return {
            id: RequireIdentity(context, "metadata"),
            alternativeTextureSourcePath: utils.optionalString(source.alternativeTextureSourcePath),
            forcesLooseTop: OptionalBoolean(source.forcesLooseTop),
            hidesBootShin: OptionalBoolean(source.hidesBootShin),
            lod1Replacement: utils.optionalString(source.lod1Replacement),
            lod2Replacement: utils.optionalString(source.lod2Replacement),
            numColorAreas: OptionalInteger(source.numColorAreas),
            dependentModifiers: AsArray(source.dependantModifiers ?? source.dependentModifiers).map(String),
            occludesModifiers: AsArray(source.occludesModifiers).map(String),
            soundTag: OptionalInteger(source.soundTag),
            swapTops: OptionalBoolean(source.swapTops),
            swapBottom: OptionalBoolean(source.swapBottom),
            swapSocks: OptionalBoolean(source.swapSocks),
            wap: OptionalBoolean(source.wap)
        };
    }

    static normalizeColorProfile(value, context = {})
    {
        const source = utils.requireObject(value, "Character color profile");
        const pattern = AsArray(source.patternColors);
        if (pattern.length !== 0 && pattern.length !== 7)
        {
            throw new Error(`Character color profile expected 7 pattern values, received ${pattern.length}`);
        }

        return {
            id: RequireIdentity(context, "color"),
            slot: String(context.slot || context.partId || ""),
            colors: NormalizeColorList(source.colors, "colors"),
            pattern: utils.optionalString(source.pattern),
            patternColors: pattern.slice(0, 5).map((item, index) => NormalizeColor(item, `patternColors[${index}]`)),
            patternTransform: pattern.length ? NormalizeVector(pattern[5], 4, "patternTransform") : [ 0, 0, 1, 1 ],
            patternRotation: pattern.length ? ToNumber(pattern[6]) : 0,
            specularColors: NormalizeColorList(source.specularColors, "specularColors"),
            parameters: {},
            resourcePaths: []
        };
    }

    static normalizeBlendshapeLimitsProfile(value, context = {})
    {
        const source = utils.requireObject(value, "Character blendshape limits profile");
        const limits = utils.requireObject(source.limits, "Character blendshape limits");
        return {
            id: String(context.id || `${source.head || ""}_${source.gender || context.sex || ""}`),
            sex: String(source.gender || context.sex || ""),
            head: String(source.head || ""),
            limits: Object.fromEntries(Object.entries(limits).map(([ name, range ]) => [
                name,
                NormalizeVector(range, 2, `limits.${name}`)
            ]))
        };
    }

    static normalizeSculptFieldsProfile(value, context = {})
    {
        const source = utils.requireObject(value, "Character sculpt fields profile");
        const fields = utils.requireObject(source.Fields ?? source.fields, "Character sculpt fields");
        return Object.entries(fields).map(([ name, field ]) => NormalizeSculptField(name, field, context));
    }

}

function NormalizeRecipeEntry(value, index)
{
    const source = utils.requireObject(value, `Character recipe entry ${index}`);
    const category = String(source.category || "");
    const path = String(source.path || "");
    if (!category || !path) throw new Error(`Character recipe entry ${index} requires category and path`);

    const sourceColors = NormalizeColorValues(source.colors, `entries[${index}].colors`);
    const packedPattern = sourceColors.length === 7;
    const patternValues = packedPattern
        ? sourceColors
        : NormalizeColorValues(source.patterncolors ?? source.patternColors, `entries[${index}].patternColors`);
    if (patternValues.length !== 0 && patternValues.length !== 5 && patternValues.length !== 7)
    {
        throw new Error(`Character recipe entry ${index} expected 5 or 7 pattern values, received ${patternValues.length}`);
    }

    return {
        category,
        path,
        weight: source.weight === undefined ? 1 : ToNumber(source.weight),
        colorVariation: utils.optionalString(source.colorvariation ?? source.colorVariation),
        colors: packedPattern ? [] : sourceColors.map((item, colorIndex) => NormalizeColor(item, `entries[${index}].colors[${colorIndex}]`)),
        specularColors: NormalizeColorList(source.specularcolors ?? source.specularColors, `entries[${index}].specularColors`),
        pattern: utils.optionalString(source.pattern),
        patternColors: patternValues.slice(0, 5).map((item, colorIndex) => NormalizeColor(item, `entries[${index}].patternColors[${colorIndex}]`)),
        patternTransform: patternValues.length === 7
            ? NormalizeVector(patternValues[5], 4, `entries[${index}].patternTransform`)
            : [ 0, 0, 1, 1 ],
        patternRotation: patternValues.length === 7 ? ToNumber(patternValues[6]) : 0
    };
}

function NormalizeSculptField(name, value, context)
{
    const source = utils.requireObject(value, `Character sculpt field ${name}`);
    const positions = source.VertPositions ?? source.vertPositions ?? {};
    const weights = source.VertData ?? source.vertData ?? {};
    const coordinates = CollectCoordinates(source.Tris ?? source.tris ?? []);
    const indices = new Set([
        ...Object.keys(positions),
        ...coordinates.keys()
    ].map(Number));

    return {
        id: String(context.idPrefix || "") + name,
        name,
        attributes: AsArray(source.Attributes ?? source.attributes).map(String),
        markerPosition: NormalizeVector(source.MarkerPosition ?? source.markerPosition, 3, `${name}.markerPosition`),
        vertices: Array.from(indices).sort((a, b) => a - b).map(index => ({
            index,
            position: NormalizeVector(positions[index] ?? positions[String(index)], 3, `${name}.vertices[${index}].position`),
            coordinates: NormalizeVector(coordinates.get(index), 2, `${name}.vertices[${index}].coordinates`),
            weights: Object.fromEntries(AsArray(weights[index] ?? weights[String(index)]).map(pair =>
            {
                if (!Array.isArray(pair) || pair.length < 2)
                {
                    throw new TypeError(`${name}.vertices[${index}] contains an invalid weight pair`);
                }
                return [ String(pair[0]), ToNumber(pair[1]) ];
            }))
        })),
        triangles: Object.entries(source.Triangles ?? source.triangles ?? {})
            .sort(([ a ], [ b ]) => Number(a) - Number(b))
            .map(([, triangle ], index) => ({
                indices: NormalizeVector(triangle, 3, `${name}.triangles[${index}]`).map(ToInteger)
            }))
    };
}

function CollectCoordinates(triangles)
{
    const result = new Map();
    for (const triangle of AsArray(triangles))
    {
        for (const vertex of AsArray(triangle))
        {
            if (!Array.isArray(vertex) || vertex.length < 2) continue;
            const index = ToInteger(vertex[0]);
            const coordinates = NormalizeVector(vertex[1], 2, `Tris vertex ${index}`);
            const previous = result.get(index);
            if (previous && (previous[0] !== coordinates[0] || previous[1] !== coordinates[1]))
            {
                throw new Error(`Character sculpt vertex ${index} has conflicting coordinates`);
            }
            result.set(index, coordinates);
        }
    }
    return result;
}

function NormalizeColorList(value, label)
{
    return NormalizeColorValues(value, label)
        .map((item, index) => NormalizeColor(item, `${label}[${index}]`));
}

function NormalizeColorValues(value, label)
{
    if (value === undefined || value === null || value === "") return [];
    const parsed = typeof value === "string" ? ParseNumericTupleList(value, label) : value;
    return AsArray(parsed);
}

function ParseNumericTupleList(value, label)
{
    if (!NUMBER_LIST_PATTERN.test(value))
    {
        throw new Error(`${label} contains unsupported non-numeric tuple syntax`);
    }
    try
    {
        return JSON.parse(value.replaceAll("(", "[").replaceAll(")", "]"));
    }
    catch (error)
    {
        throw new Error(`${label} contains invalid numeric tuple syntax: ${error.message}`);
    }
}

function NormalizeColor(value, label)
{
    const result = NormalizeVector(value, [ 3, 4 ], label);
    return result.length === 3 ? [ ...result, 1 ] : result;
}

function NormalizeVector(value, lengths, label)
{
    const expected = Array.isArray(lengths) ? lengths : [ lengths ];
    if (!Array.isArray(value) || !expected.includes(value.length))
    {
        throw new TypeError(`${label} must contain ${expected.join(" or ")} numeric values`);
    }
    return value.map(ToNumber);
}

function NormalizePresentationValue(value, label)
{
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number")
    {
        if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
        return value;
    }
    if (Array.isArray(value))
    {
        return value.map((item, index) => NormalizePresentationValue(item, `${label}[${index}]`));
    }
    if (value && typeof value === "object")
    {
        return Object.fromEntries(Object.entries(value)
            .sort(([ a ], [ b ]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([ key, item ]) => [ key, NormalizePresentationValue(item, `${label}.${key}`) ]));
    }
    throw new TypeError(`${label} contains unsupported ${typeof value} data`);
}

function RequireIdentity(context, profile)
{
    const id = String(context.id || "");
    if (!id) throw new Error(`Character ${profile} profile requires context.id`);
    return id;
}

function AsArray(value)
{
    return Array.isArray(value) ? value : value === undefined || value === null ? [] : [ value ];
}

function OptionalBoolean(value)
{
    return value === undefined || value === null ? null : Boolean(value);
}

function OptionalInteger(value)
{
    return value === undefined || value === null || value === "" ? null : ToInteger(value);
}

function InferSex(sourcePath)
{
    return String(sourcePath || "").match(/\/character\/(female|male)\//iu)?.[1]?.toLowerCase() || "";
}

function ToNumber(value)
{
    const result = Number(value ?? 0);
    if (!Number.isFinite(result)) throw new TypeError(`Expected a finite number, received ${value}`);
    return result;
}

function ToInteger(value)
{
    const result = ToNumber(value);
    if (!Number.isInteger(result)) throw new TypeError(`Expected an integer, received ${value}`);
    return result;
}

function CompareEntries([ a ], [ b ])
{
    return a < b ? -1 : a > b ? 1 : 0;
}
