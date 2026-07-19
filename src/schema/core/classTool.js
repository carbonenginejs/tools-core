// carbon-class core — schema-driven runtime-class checker/emitter.
//
// Pure ESM module (no process.exit, no console). All functions are deterministic and
// throw Error objects carrying a `.code` for the CLI to map to exit codes:
//   - "schema-doc-missing" / "schema-doc-ambiguous" -> exit 3
//   - "class-file-unparseable"                       -> exit 4
// Everything else (usage) is handled by the CLI layer.
//
// See format-carbon carbon-class SPEC Part B. Mapping tables port from the retired
// testbed (carbonTypes.js inferCarbonTypeFromCpp, seed-space-object-factory-runtime.mjs
// io/type maps, convert.cjs cpp-default parsers).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SCHEMA_ROOT = path.resolve(HERE, "..", "schema");

// Full @type.* kind list from core-types/src/schema/CjsSchema.js (excluding class-level `define`).
export const KNOWN_TYPE_KINDS = new Set([
    "array", "boolean", "color", "expression", "float32", "float64",
    "int8", "int16", "int32", "int64", "list", "mat3", "mat4", "map",
    "model", "objectRef", "path", "quat", "rawStruct", "set", "string", "struct",
    "typedArray", "uint8", "uint16", "uint32", "uint64", "unknown",
    "vec2", "vec3", "vec4"
]);

export const KNOWN_IO_KINDS = new Set([
    "notify", "owned", "persist", "persistOnly", "read", "readwrite",
    "reference", "write"
]);

const IDENTITY_MAT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY_MAT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const TYPE_DEFAULT = {
    boolean: false,
    string: "", path: "", expression: "",
    float32: 0, float64: 0,
    int8: 0, int16: 0, int32: 0, int64: 0,
    uint8: 0, uint16: 0, uint32: 0, uint64: 0,
    vec2: [0, 0], vec3: [0, 0, 0], vec4: [0, 0, 0, 0], color: [0, 0, 0, 0],
    quat: [0, 0, 0, 1], mat3: IDENTITY_MAT3, mat4: IDENTITY_MAT4,
    list: [], array: [], map: { __container: "map" }, set: { __container: "set" },
    model: null, objectRef: null, struct: null, rawStruct: null, typedArray: null, unknown: null
};

// Source-backed named constants used in constructor defaults. Keep this list
// intentionally bounded; it is not a C++ expression evaluator.
const CPP_DEFAULT_VALUE_OVERRIDES = Object.freeze({
    "Tr2LightManager::FLAG_DEFAULT": 1,
    "EveSOFDataHullBuildFilter::DEFAULT_FILTER": 0xffffffff
});

// The current Carbon scan can collapse same-named nested enums into an
// unqualified catalog entry, and it can omit enums that no field references.
// Keep these owner-specific shapes source-backed until the scan preserves them.
function sourceEnum(values)
{
    return Object.freeze(values.map(([name, value]) => Object.freeze({ name, value })));
}

// Shared enum vocabularies which are consumed by class decorators but are not
// reliably present in the current Carbon scan. These mirror the maintained
// runtime-trinity/runtime-const definitions (and Carbon's Topology enum) without
// introducing a package dependency from the schema authority back to a runtime
// consumer. Scanner entries still take precedence whenever they resolve to one
// qualified declaration.
const SOURCE_SHARED_ENUM_OVERRIDES = Object.freeze({
    Tr2CurveExtrapolation: sourceEnum([
        ["CLAMP", 0], ["CYCLE", 1], ["MIRROR", 2], ["LINEAR", 3]
    ]),
    Tr2CurveVector3LerpKeyInterpolation: sourceEnum([
        ["LINEAR", 1], ["HERMITE", 2]
    ]),
    Tr2FollowCurveKeyInterpolation: sourceEnum([
        ["CONSTANT", 0], ["LINEAR", 1], ["HERMITE", 2]
    ]),
    TRIEXTRAPOLATION: sourceEnum([
        ["NONE", 0], ["CONSTANT", 1], ["GRADIENT", 2], ["CYCLE", 3]
    ]),
    TextureFilter: sourceEnum([
        ["TF_NONE", 0], ["TF_POINT", 1], ["TF_LINEAR", 2],
        ["TF_ANISOTROPIC", 3], ["TF_COMPARISON", 0x80]
    ]),
    TextureAddressMode: sourceEnum([
        ["TA_WRAP", 1], ["TA_MIRROR", 2], ["TA_CLAMP", 3],
        ["TA_BORDER", 4], ["TA_MIRROR_ONCE", 5]
    ]),
    SwapEffect: sourceEnum([
        ["SWAP_EFFECT_DISCARD", 0], ["SWAP_EFFECT_SEQUENTIAL", 1]
    ]),
    PresentInterval: sourceEnum([
        ["PRESENT_INTERVAL_IMMEDIATE", 0], ["PRESENT_INTERVAL_ONE", 1]
    ]),
    RenderState: sourceEnum([
        ["RS_ZENABLE", 7], ["RS_FILLMODE", 8], ["RS_SHADEMODE", 9],
        ["RS_ZWRITEENABLE", 14], ["RS_ALPHATESTENABLE", 15], ["RS_LASTPIXEL", 16],
        ["RS_SRCBLEND", 19], ["RS_DESTBLEND", 20], ["RS_CULLMODE", 22],
        ["RS_ZFUNC", 23], ["RS_ALPHAREF", 24], ["RS_ALPHAFUNC", 25],
        ["RS_DITHERENABLE", 26], ["RS_ALPHABLENDENABLE", 27], ["RS_FOGENABLE", 28],
        ["RS_SPECULARENABLE", 29], ["RS_FOGCOLOR", 34], ["RS_FOGTABLEMODE", 35],
        ["RS_FOGSTART", 36], ["RS_FOGEND", 37], ["RS_FOGDENSITY", 38],
        ["RS_ZBIAS", 47], ["RS_RANGEFOGENABLE", 48], ["RS_STENCILENABLE", 52],
        ["RS_STENCILFAIL", 53], ["RS_STENCILZFAIL", 54], ["RS_STENCILPASS", 55],
        ["RS_STENCILFUNC", 56], ["RS_STENCILREF", 57], ["RS_STENCILMASK", 58],
        ["RS_STENCILWRITEMASK", 59], ["RS_TEXTUREFACTOR", 60], ["RS_DEPTH_CLIP_ENABLE", 61],
        ["RS_WRAP0", 128], ["RS_WRAP1", 129], ["RS_WRAP2", 130], ["RS_WRAP3", 131],
        ["RS_WRAP4", 132], ["RS_WRAP5", 133], ["RS_WRAP6", 134], ["RS_WRAP7", 135],
        ["RS_CLIPPING", 136], ["RS_LIGHTING", 137], ["RS_AMBIENT", 139],
        ["RS_FOGVERTEXMODE", 140], ["RS_COLORVERTEX", 141], ["RS_LOCALVIEWER", 142],
        ["RS_NORMALIZENORMALS", 143], ["RS_DIFFUSEMATERIALSOURCE", 145],
        ["RS_SPECULARMATERIALSOURCE", 146], ["RS_AMBIENTMATERIALSOURCE", 147],
        ["RS_EMISSIVEMATERIALSOURCE", 148], ["RS_VERTEXBLEND", 151],
        ["RS_CLIPPLANEENABLE", 152], ["RS_POINTSIZE", 154], ["RS_POINTSIZE_MIN", 155],
        ["RS_POINTSPRITEENABLE", 156], ["RS_POINTSCALEENABLE", 157],
        ["RS_POINTSCALE_A", 158], ["RS_POINTSCALE_B", 159], ["RS_POINTSCALE_C", 160],
        ["RS_MULTISAMPLEANTIALIAS", 161], ["RS_MULTISAMPLEMASK", 162],
        ["RS_PATCHEDGESTYLE", 163], ["RS_DEBUGMONITORTOKEN", 165],
        ["RS_POINTSIZE_MAX", 166], ["RS_INDEXEDVERTEXBLENDENABLE", 167],
        ["RS_COLORWRITEENABLE", 168], ["RS_TWEENFACTOR", 170], ["RS_BLENDOP", 171],
        ["RS_POSITIONDEGREE", 172], ["RS_NORMALDEGREE", 173],
        ["RS_SLOPESCALEDEPTHBIAS", 175], ["RS_ANTIALIASEDLINEENABLE", 176],
        ["RS_MINTESSELLATIONLEVEL", 178], ["RS_MAXTESSELLATIONLEVEL", 179],
        ["RS_ADAPTIVETESS_X", 180], ["RS_ADAPTIVETESS_Y", 181],
        ["RS_ADAPTIVETESS_Z", 182], ["RS_ADAPTIVETESS_W", 183],
        ["RS_ENABLEADAPTIVETESSELLATION", 184], ["RS_TWOSIDEDSTENCILMODE", 185],
        ["RS_CCW_STENCILFAIL", 186], ["RS_CCW_STENCILZFAIL", 187],
        ["RS_CCW_STENCILPASS", 188], ["RS_CCW_STENCILFUNC", 189],
        ["RS_COLORWRITEENABLE1", 190], ["RS_COLORWRITEENABLE2", 191],
        ["RS_COLORWRITEENABLE3", 192], ["RS_BLENDFACTOR", 193],
        ["RS_SRGBWRITEENABLE", 194], ["RS_DEPTHBIAS", 195],
        ["RS_WRAP8", 198], ["RS_WRAP9", 199], ["RS_WRAP10", 200], ["RS_WRAP11", 201],
        ["RS_WRAP12", 202], ["RS_WRAP13", 203], ["RS_WRAP14", 204], ["RS_WRAP15", 205],
        ["RS_SEPARATEALPHABLENDENABLE", 206], ["RS_SRCBLENDALPHA", 207],
        ["RS_DESTBLENDALPHA", 208], ["RS_BLENDOPALPHA", 209],
        ["RS_MAX_STATE", 210], ["RS_FORCE_DWORD", 0]
    ]),
    Tr2CpuUsage: sourceEnum([
        ["NONE", 0], ["READ", 1], ["WRITE", 2], ["READ_OFTEN", 5],
        ["WRITE_OFTEN", 10], ["NON_SYNCRONIZED_WRITE", 16]
    ]),
    Tr2GpuUsage: sourceEnum([
        ["NONE", 0], ["VERTEX_BUFFER", 1], ["INDEX_BUFFER", 2],
        ["RENDER_TARGET", 4], ["DEPTH_STENCIL", 8], ["SHADER_RESOURCE", 16],
        ["UNORDERED_ACCESS", 32], ["COPY_DESTINATION", 64],
        ["DRAW_INDIRECT_ARGS", 128], ["ACCELERATION_STRUCTURE", 256], ["SHARED", 512]
    ]),
    Tr2WindowMode: sourceEnum([
        ["FULL_SCREEN", 0], ["WINDOWED", 1], ["FIXED_WINDOW", 2]
    ]),
    Tr2WindowShowState: sourceEnum([
        ["NORMAL", 0], ["MAXIMIZED", 1], ["MINIMIZED", 2]
    ]),
    Tr2ImeState_MacOS: sourceEnum([
        ["DISABLED", 0], ["READY", 1], ["BLOCKING", 2]
    ]),
    TRIOPERATOR: sourceEnum([
        ["TRIOP_MULTIPLY", 0], ["TRIOP_ADD", 1], ["TRIOP_AVERAGE", 2]
    ]),
    TRITRANSFORMBASE: sourceEnum([
        ["TRITB_OBJECT", 0], ["TRITB_CAMERA_ROTATION", 1],
        ["TRITB_CAMERA_TRANSLATION", 2], ["TRITB_CAMERA", 3],
        ["TRITB_CAMERA_ROTATION_ALIGNED", 4], ["TRITB_FIXED", 5],
        ["TRITB_CAMERA_ROTATION_FALLOFF", 6],
        ["TRITB_CAMERA_ROTATION_ALIGNED_SYMMETRY", 7],
        ["TRITB_CAMERA_ROTATION_FALLOFF_SYMMETRY", 8], ["TRITB_BOOSTER", 9],
        ["TRITB_SIMPLE_HALO", 10], ["TRITB_SIMPLE_HALO_SYMMETRY", 11],
        ["TRITB_BOOSTER_FALLOFF", 12], ["TRITB_WORLD", 13],
        ["TRITB_SIMPLE_HALO_FALLOFF", 14], ["TRITB_SIMPLE_SPRITE", 15],
        ["TRITB_SIMPLE_SPRITE_FALLOFF", 16], ["TRITB_SIMPLE_SPRITE_CONSTANT", 17]
    ]),
    Topology: sourceEnum([
        ["TOP_INVALID", 0], ["TOP_TRIANGLES", 1], ["TOP_TRIANGLE_STRIP", 2],
        ["TOP_TRIANGLE_FAN", 3], ["TOP_LINES", 4], ["TOP_LINE_STRIP", 5],
        ["TOP_POINTS", 6], ["TOP_MAX_TOPOLOGY", 7]
    ])
});

// External-library enums with generic short names are intentionally scoped to
// the consuming Carbon class. A global `Quality` fallback would incorrectly
// bind unrelated PostProcess quality vocabularies.
const SOURCE_REFERENCED_ENUM_OVERRIDES = Object.freeze({
    // imagetools/EnumRegistry_Blue.cpp and NVTT 2.1 nvtt::Quality.
    CompressionOptions: Object.freeze({
        Quality: sourceEnum([
            ["FASTEST", 0], ["NORMAL", 1], ["PRODUCTION", 2], ["HIGHEST", 3]
        ])
    }),
    // OpenVDB v10.0.0 (Carbon's pinned be0e7a7) nanovdb::GridType.
    NanoVDBGridMetadata: Object.freeze({
        GridType: sourceEnum([
            ["Unknown", 0], ["Float", 1], ["Double", 2], ["Int16", 3],
            ["Int32", 4], ["Int64", 5], ["Vec3f", 6], ["Vec3d", 7],
            ["Mask", 8], ["Half", 9], ["UInt32", 10], ["Boolean", 11],
            ["RGBA8", 12], ["Fp4", 13], ["Fp8", 14], ["Fp16", 15],
            ["FpN", 16], ["Vec4f", 17], ["Vec4d", 18], ["End", 19]
        ])
    })
});

const SOURCE_OWNED_ENUM_OVERRIDES = Object.freeze({
    // trinity/trinity/Eve/Turret/EveTurretTarget.h namespace ImpactBehaviour::Type
    EveTurretSet: Object.freeze({
        ImpactBehaviour: Object.freeze([
            Object.freeze({ name: "DAMAGE_LOCATOR", value: 0 }),
            Object.freeze({ name: "SHIELD_ELLIPSOID", value: 1 }),
            Object.freeze({ name: "CENTER", value: 2 })
        ])
    }),
    EveTurretTarget: Object.freeze({
        ImpactBehaviour: Object.freeze([
            Object.freeze({ name: "DAMAGE_LOCATOR", value: 0 }),
            Object.freeze({ name: "SHIELD_ELLIPSOID", value: 1 }),
            Object.freeze({ name: "CENTER", value: 2 })
        ])
    }),
    // trinity/trinity/Curves/Tr2Curve.h enum Tr2CurveExtrapolation
    Tr2CurveScalarDefinition: Object.freeze({
        Tr2CurveExtrapolation: Object.freeze([
            Object.freeze({ name: "CLAMP", value: 0 }),
            Object.freeze({ name: "CYCLE", value: 1 }),
            Object.freeze({ name: "MIRROR", value: 2 }),
            Object.freeze({ name: "LINEAR", value: 3 })
        ])
    }),
    EveChildContainer: Object.freeze({
        DisplayQualityModifier: Object.freeze([
            Object.freeze({ name: "ONLY_REFLECTIONS", value: 6 }),
            Object.freeze({ name: "SHADER_ALL", value: 5 }),
            Object.freeze({ name: "SHADER_HIGHMID", value: 3 }),
            Object.freeze({ name: "SHADER_LOWMID", value: 1 }),
            Object.freeze({ name: "SHADER_HIGH", value: 4 }),
            Object.freeze({ name: "SHADER_MED", value: 2 }),
            Object.freeze({ name: "SHADER_LOW", value: 0 })
        ])
    }),
    EveSOFDataInstancedMesh: Object.freeze({
        DisplayQualityModifier: Object.freeze([
            Object.freeze({ name: "SHADER_ALL", value: 5 }),
            Object.freeze({ name: "SHADER_HIGHMID", value: 3 }),
            Object.freeze({ name: "SHADER_LOWMID", value: 1 }),
            Object.freeze({ name: "SHADER_HIGH", value: 4 }),
            Object.freeze({ name: "SHADER_MED", value: 2 }),
            Object.freeze({ name: "SHADER_LOW", value: 0 })
        ])
    }),
    EveSOFDataHullExtensionPlacementDistributionMapGraphicSettings: Object.freeze({
        DisplayQualityModifier: Object.freeze([
            Object.freeze({ name: "ONLY_REFLECTIONS", value: 6 }),
            Object.freeze({ name: "SHADER_ALL", value: 5 }),
            Object.freeze({ name: "SHADER_HIGHMID", value: 3 }),
            Object.freeze({ name: "SHADER_LOWMID", value: 1 }),
            Object.freeze({ name: "SHADER_HIGH", value: 4 }),
            Object.freeze({ name: "SHADER_MED", value: 2 }),
            Object.freeze({ name: "SHADER_LOW", value: 0 })
        ])
    }),
    EveSOFDataArea: Object.freeze({
        AreaType: sourceEnum([
            ["TYPE_PRIMARY", 0],
            ["TYPE_GLASS", 1],
            ["TYPE_SAILS", 2],
            ["TYPE_REACTOR", 3],
            ["TYPE_DARKHULL", 4],
            ["TYPE_WRECK", 5],
            ["TYPE_ROCK", 6],
            ["TYPE_MONUMENT", 7],
            ["TYPE_ORNAMENT", 8],
            ["TYPE_SIMPLEPRIMARY", 9],
            ["TYPE_TURRET", 10],
            ["TYPE_MAX", 11],
            ["TYPE_NO_OVERWRITE", 11]
        ])
    }),
    EveSOFDataAreaMaterial: Object.freeze({
        MaterialType: sourceEnum([
            ["MATERIAL1", 0],
            ["MATERIAL2", 1],
            ["MATERIAL3", 2],
            ["MATERIAL4", 3],
            ["MATERIAL_MAX", 4]
        ])
    }),
    EveSOFDataFactionColorSet: Object.freeze({
        ColorType: sourceEnum([
            ["TYPE_PRIMARY", 0],
            ["TYPE_SECONDARY", 1],
            ["TYPE_TERTIARY", 2],
            ["TYPE_BLACK", 3],
            ["TYPE_WHITE", 4],
            ["TYPE_YELLOW", 5],
            ["TYPE_ORANGE", 6],
            ["TYPE_RED", 7],
            ["TYPE_BLUE", 8],
            ["TYPE_GREEN", 9],
            ["TYPE_CYAN", 10],
            ["TYPE_FIRE", 11],
            ["TYPE_HULL", 12],
            ["TYPE_GLASS", 13],
            ["TYPE_REACTOR", 14],
            ["TYPE_DARKHULL", 15],
            ["TYPE_BOOSTER", 16],
            ["TYPE_KILLMARK", 17],
            ["TYPE_PRIMARY_LIGHT", 18],
            ["TYPE_SECONDARY_LIGHT", 19],
            ["TYPE_TERTIARY_LIGHT", 20],
            ["TYPE_WHITE_LIGHT", 21],
            ["TYPE_PRIMARY_HOLOGRAM", 22],
            ["TYPE_SECONDARY_HOLOGRAM", 23],
            ["TYPE_TERTIARY_HOLOGRAM", 24],
            ["TYPE_STATE_0", 25],
            ["TYPE_STATE_1", 26],
            ["TYPE_STATE_2", 27],
            ["TYPE_STATE_3", 28],
            ["TYPE_STATE_VULNERABLE", 29],
            ["TYPE_STATE_INVULNERABLE", 30],
            ["TYPE_PRIMARY_FORCEFIELD", 31],
            ["TYPE_SECONDARY_FORCEFIELD", 32],
            ["TYPE_PRIMARY_BANNER", 33],
            ["TYPE_PRIMARY_FX", 34],
            ["TYPE_SECONDARY_FX", 35],
            ["TYPE_PRIMARY_SPOTLIGHT", 36],
            ["TYPE_SECONDARY_SPOTLIGHT", 37],
            ["TYPE_TERTIARY_SPOTLIGHT", 38],
            ["TYPE_PRIMARY_BILLBOARD", 39],
            ["TYPE_PRIMARY_WARP_FX", 40],
            ["TYPE_PRIMARY_ATTACK_FX", 41],
            ["TYPE_PRIMARY_SIEGE_FX", 42],
            ["TYPE_PRIMARY_DOCKED_FX", 43],
            ["TYPE_MAX", 44]
        ])
    }),
    EveSOFDataHull: Object.freeze({
        BuildClass: sourceEnum([
            ["BUILDCLASS_SHIP", 0],
            ["BUILDCLASS_MOBILE", 1],
            ["BUILDCLASS_STATIONARY", 2],
            ["BUILDCLASS_SWARM", 3],
            ["BUILDCLASS_EXTENSION", 4],
            ["BUILDCLASS_COUNT", 5]
        ]),
        ImpactEffectType: sourceEnum([
            ["IMPACTEFFECT_NONE", 0],
            ["IMPACTEFFECT_ELLIPSOID", 1],
            ["IMPACTEFFECT_HULL", 2]
        ]),
        BuildFilter: sourceEnum([
            ["STANDALONE", 1],
            ["NON_INSTANCED_PLACEMENT", 2],
            ["INSTANCED_PLACEMENT", 4],
            ["DEFAULT_FILTER", 0xffffffff]
        ])
    }),
    EveSOFDataHullDecalSetItem: Object.freeze({
        Usage: sourceEnum([
            ["USAGE_STANDARD", 0],
            ["USAGE_KILLCOUNTER", 1],
            ["USAGE_HOLE", 2],
            ["USAGE_CYLINDRICAL", 3],
            ["USAGE_GLOWCYLINDRICAL", 4],
            ["USAGE_GLOWSTANDARD", 5],
            ["USAGE_LOGO", 6],
            ["USAGE_MAX", 7]
        ])
    }),
    EveSOFDataLogoSet: Object.freeze({
        LogoType: sourceEnum([
            ["TYPE_PRIMARY", 0],
            ["TYPE_SECONDARY", 1],
            ["TYPE_TERTIARY", 2],
            ["TYPE_MARKING_01", 3],
            ["TYPE_MARKING_02", 4],
            ["TYPE_MAX", 5]
        ])
    }),
    EveSOFDataPatternLayer: Object.freeze({
        ProjectionType: sourceEnum([
            ["PROJECTION_REPEAT", 0],
            ["PROJECTION_CLAMP", 1],
            ["PROJECTION_BORDER", 2]
        ]),
        MaterialSource: sourceEnum([
            ["SOURCE_MATERIAL1", 0],
            ["SOURCE_MATERIAL2", 1],
            ["SOURCE_MATERIAL3", 2],
            ["SOURCE_MATERIAL4", 3],
            ["SOURCE_PATTERN1", 4],
            ["SOURCE_PATTERN2", 5]
        ])
    }),
    EveSOFDataPatternLayerProperties: Object.freeze({
        ProjectionType: sourceEnum([
            ["PROJECTION_REPEAT", 0],
            ["PROJECTION_CLAMP", 1],
            ["PROJECTION_BORDER", 2]
        ])
    })
});

const SOURCE_MEMBER_LEAF_OVERRIDES = Object.freeze({
    "CcpMath::AxisAlignedBox": Object.freeze({
        m_min: Object.freeze({
            cppType: "Vector3",
            default: Object.freeze({ cpp: "Vector3( 0, 0, 0 )", json: null, kind: "expression" })
        }),
        m_max: Object.freeze({
            cppType: "Vector3",
            default: Object.freeze({ cpp: "Vector3( 0, 0, 0 )", json: null, kind: "expression" })
        })
    })
});

function canonicalDefault(kind)
{
    const value = TYPE_DEFAULT[kind];
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === "object") return { ...value };
    return value === undefined ? null : value;
}

// ---------------------------------------------------------------------------
// C++ default expression parsers (ported from convert.cjs:2315-2353)
// ---------------------------------------------------------------------------

function unwrapCppConstructorExpression(value)
{
    const trimmed = String(value).trim();
    const match = trimmed.match(/^[A-Za-z_:][A-Za-z0-9_:<>]*\s*\((.*)\)$/s);
    return match ? match[1].trim() : trimmed;
}

function isNumericLiteral(value)
{
    const trimmed = String(value).trim();
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)f?$/i.test(trimmed) || /^0x[0-9a-f]+$/i.test(trimmed);
}

function readNumericLiteral(value)
{
    const trimmed = String(value).trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return Number(trimmed);
    return Number(trimmed.replace(/f$/i, ""));
}

function splitTopLevelArgs(input)
{
    const parts = [];
    let depth = 0;
    let current = "";
    for (const ch of String(input))
    {
        if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
        else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth = Math.max(0, depth - 1);

        if (ch === "," && depth === 0)
        {
            parts.push(current);
            current = "";
        }
        else
        {
            current += ch;
        }
    }
    if (current.trim() !== "") parts.push(current);
    return parts.map(part => part.trim()).filter(part => part.length);
}

// Parse a schema `default` object into { determinate, value } | { determinate:false, raw }.
function parseSchemaDefault(def, kind, context = {})
{
    if (!def)
    {
        return { determinate: true, value: canonicalDefault(kind), source: "canonical" };
    }
    if (def.kind === "number" || def.kind === "boolean" || def.kind === "string")
    {
        return { determinate: true, value: def.json, source: "schema" };
    }
    if (def.kind === "null")
    {
        return { determinate: true, value: null, source: "schema" };
    }
    if (def.kind === "expression")
    {
        const cpp = String(def.cpp ?? "").trim();
        if (Object.hasOwn(CPP_DEFAULT_VALUE_OVERRIDES, cpp))
        {
            return { determinate: true, value: CPP_DEFAULT_VALUE_OVERRIDES[cpp], source: "source-constant" };
        }
        const enumValue = resolveEnumDefault(
            cpp,
            context.enumType,
            context.className,
            context.schemaRoot,
            context.enumQualifiedName
        );
        if (enumValue)
        {
            return { determinate: true, value: enumValue.value, source: "source-enum" };
        }
        if (cpp === "true" || cpp === "false")
        {
            return { determinate: true, value: cpp === "true", source: "cpp-boolean" };
        }
        const factors = cpp.split("*").map(part => part.trim());
        if (factors.length > 1 && factors.every(isNumericLiteral))
        {
            return {
                determinate: true,
                value: factors.map(readNumericLiteral).reduce((value, factor) => value * factor, 1),
                source: "cpp-product"
            };
        }
        const unwrapped = unwrapCppConstructorExpression(cpp);
        const args = splitTopLevelArgs(unwrapped);
        if (args.length > 1 && args.every(isNumericLiteral))
        {
            return { determinate: true, value: args.map(readNumericLiteral), source: "cpp-array" };
        }
        if (args.length === 1 && isNumericLiteral(args[0]))
        {
            return { determinate: true, value: readNumericLiteral(args[0]), source: "cpp-number" };
        }
        // Fall back to the type's canonical default so enum/struct expressions still compare cleanly.
        return { determinate: true, value: canonicalDefault(kind), source: "canonical", note: `schema cpp default "${cpp}" not comparable` };
    }
    return { determinate: true, value: canonicalDefault(kind), source: "canonical" };
}

// ---------------------------------------------------------------------------
// C++ type -> @type.* kind mapping (ported from carbonTypes.js:131-209)
// ---------------------------------------------------------------------------

function normalizeCppType(cppType)
{
    return String(cppType || "")
        .replace(/\b(?:const|mutable)\b/g, "")
        .replace(/&/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeCppTypeName(cppType)
{
    return normalizeCppType(cppType)
        .replace(/\s*\*+$/, "")
        .replace(/\bstd::basic_string\s*<[^>]+>/g, "std::string")
        .trim();
}

function isRotationLike(name)
{
    return /(?:rotation|quat|quaternion)/i.test(String(name || ""));
}

// The source scanner can mistake getter bodies and initializer fragments for C++
// declarations (for example `return`, `min =`, or `value[0] =`). Keep those
// artifacts available in the raw schema, but never let them outrank a real field
// declaration when deriving the public Blue graph shape.
function isUsefulCppType(cppType)
{
    const value = String(cppType || "").trim();
    if (!value) return false;
    if (/^return(?:\s|$)/.test(value)) return false;
    if (/^(?:min|max)\s*=/.test(value)) return false;
    if (/\[[^\]]*\]\s*=/.test(value)) return false;
    return true;
}

function isColorLike(name)
{
    return /color/i.test(String(name || ""));
}

function isExpressionLike(name)
{
    return /expression/i.test(String(name || ""));
}

function isOpaqueNamedValueType(name)
{
    return /^[A-Z_][A-Za-z0-9_]*$/.test(String(name || ""));
}

function cleanNamedType(cppType)
{
    const type = String(cppType || "")
        .replace(/\b(?:const|mutable)\b/g, "")
        .replace(/[&*]/g, "")
        .replace(/^P(?=[A-Z])/, "")
        .replace(/Ptr$/, "")
        .replace(/Ref$/, "")
        .replace(/\s+/g, " ")
        .trim();
    const wrapper = type.match(/^(?:std::)?(?:unique_ptr|shared_ptr|weak_ptr)\s*<\s*(.+?)\s*>$/);
    return wrapper ? cleanNamedType(wrapper[1]) : type;
}

function collectionItemType(cppType)
{
    const raw = String(cppType || "");
    const template = raw.match(/<(.+)>/);
    if (template)
    {
        const args = splitTopLevelArgs(template[1].trim());
        return stripStructureSuffix(cleanNamedType(args.at(-1) || template[1].trim()));
    }
    const named = raw.match(/^P?(.+?)(?:Vector|List)$/);
    if (named) return stripStructureSuffix(cleanNamedType(named[1]));
    return null;
}

const ENUM_CATALOG_CACHE = new Map();

// Scanner-qualified aliases for namespace enums whose current report records
// retain the declared tail but omit the namespace. Keep this source-proven and
// narrow: an unrelated scoped Quality/Shape/Usage must not bind by short name.
const ENUM_CATALOG_QUALIFIED_ALIASES = Object.freeze({
    "PostProcess::Quality": "Quality",
    "Tr2Bokeh::Shape": "Shape",
    "cmf::Usage": "Usage"
});

const ENUM_CATALOG_CLASS_ALIASES = Object.freeze({
    "VertexElement::Usage": "Usage"
});

function enumCatalog(schemaRoot = DEFAULT_SCHEMA_ROOT)
{
    const root = path.resolve(schemaRoot || DEFAULT_SCHEMA_ROOT);
    const cached = ENUM_CATALOG_CACHE.get(root);
    if (cached) return cached;

    const enumPath = path.join(root, "enums.json");
    const data = fs.existsSync(enumPath) ? readJson(enumPath) : null;
    const entries = Array.isArray(data?.enums) ? data.enums : [];
    ENUM_CATALOG_CACHE.set(root, entries);
    return entries;
}

function knownEnumNames(schemaRoot = DEFAULT_SCHEMA_ROOT)
{
    const names = new Set(Object.keys(SOURCE_SHARED_ENUM_OVERRIDES));
    for (const entry of enumCatalog(schemaRoot))
    {
        const name = cleanNamedType(entry?.name);
        if (name) names.add(name);
    }
    return names;
}

function enumCatalogIdentity(entry)
{
    if (!entry?.name) return null;
    if (entry.qualifiedName) return String(entry.qualifiedName);
    if (entry.ownerClass) return `${entry.ownerClass}::${entry.name}`;
    return String(entry.name);
}

function catalogEnumReference(enumType, cppType, className, schemaRoot = DEFAULT_SCHEMA_ROOT)
{
    const entries = enumCatalog(schemaRoot);
    const namedCpp = normalizeCppTypeName(cppType || "");
    const namedEnum = cleanNamedType(enumType || "");
    const qualified = [];
    if (namedEnum.includes("::")) qualified.push(namedEnum);
    if (namedCpp.includes("::")) qualified.push(namedCpp);

    for (const identity of qualified)
    {
        const matches = entries.filter(entry => enumCatalogIdentity(entry) === identity);
        if (matches.length === 1) return matches[0];

        const alias = ENUM_CATALOG_QUALIFIED_ALIASES[identity];
        if (alias)
        {
            const aliased = entries.filter(entry => enumCatalogIdentity(entry) === alias);
            if (aliased.length === 1) return aliased[0];
        }
    }

    const declaredName = cleanNamedType(namedEnum.split("::").at(-1) || namedCpp.split("::").at(-1));
    const classAlias = className && declaredName
        ? ENUM_CATALOG_CLASS_ALIASES[`${className}::${declaredName}`]
        : null;
    if (classAlias)
    {
        const aliased = entries.filter(entry => enumCatalogIdentity(entry) === classAlias);
        if (aliased.length === 1) return aliased[0];
    }
    if (className && declaredName)
    {
        const owned = entries.filter(entry =>
            entry?.ownerClass === className && entry.name === declaredName
        );
        if (owned.length === 1) return owned[0];
    }
    return null;
}

function enumReferenceFrom(enumType, cppType, className = null, schemaRoot = DEFAULT_SCHEMA_ROOT)
{
    const generic = /^(?:Type|Enum|Mode)$/;
    const named = normalizeCppTypeName(cppType || "");
    const scoped = named.match(/^(.+?)::([A-Za-z_]\w*)$/);
    const entry = catalogEnumReference(enumType, cppType, className, schemaRoot);
    if (entry)
    {
        const scope = scoped ? cleanNamedType(scoped[1]) : null;
        const projectionName = !entry.ownerClass && scope && generic.test(entry.name)
            ? scope
            : entry.name;
        return {
            enumType: projectionName,
            enumQualifiedName: enumCatalogIdentity(entry),
            enumOwnerClass: entry.ownerClass || null
        };
    }

    const cleanEnumType = cleanNamedType(enumType || "");
    if (cleanEnumType && !generic.test(cleanEnumType))
    {
        return { enumType: cleanEnumType, enumQualifiedName: null, enumOwnerClass: null };
    }
    if (scoped)
    {
        const scope = cleanNamedType(scoped[1]);
        const tail = cleanNamedType(scoped[2]);
        return {
            enumType: scope.endsWith("Enum") || !generic.test(tail) ? tail : scope,
            enumQualifiedName: null,
            enumOwnerClass: null
        };
    }
    const fallback = cleanEnumType || (named ? cleanNamedType(named) : null);
    return { enumType: fallback, enumQualifiedName: null, enumOwnerClass: null };
}

function sourceOwnedEnums(className)
{
    return Object.entries(SOURCE_OWNED_ENUM_OVERRIDES[className] || {}).map(([name, values]) => ({
        name,
        qualifiedName: `${className}::${name}`,
        ownerClass: className,
        values
    }));
}

function ownedEnumsForClass(className, schemaRoot = DEFAULT_SCHEMA_ROOT)
{
    const byName = new Map();
    for (const entry of enumCatalog(schemaRoot))
    {
        if (entry?.ownerClass === className && entry.name && Array.isArray(entry.values))
        {
            byName.set(entry.name, entry);
        }
    }
    for (const entry of sourceOwnedEnums(className)) byName.set(entry.name, entry);
    return [...byName.values()];
}

function resolveEnumDefault(expression, enumType, className, schemaRoot = DEFAULT_SCHEMA_ROOT, enumQualifiedName = null)
{
    if (!enumType || !expression) return null;
    const parts = String(expression).trim().split("::");
    const memberName = parts.at(-1);
    if (!/^[A-Za-z_]\w*$/.test(memberName)) return null;

    if (enumQualifiedName)
    {
        const exact = enumCatalog(schemaRoot).filter(entry =>
            enumCatalogIdentity(entry) === enumQualifiedName && Array.isArray(entry.values)
        );
        if (exact.length === 1)
        {
            const member = exact[0].values.find(value => value.name === memberName);
            if (member) return member;
        }
    }

    const owned = ownedEnumsForClass(className, schemaRoot)
        .filter(entry => entry.name === enumType || entry.qualifiedName === enumType);
    for (const entry of owned)
    {
        const member = entry.values.find(value => value.name === memberName);
        if (member) return member;
    }

    const classShared = className && SOURCE_REFERENCED_ENUM_OVERRIDES[className]?.[enumType]
        ? sourceSharedEnum(enumType, className)
        : null;
    if (classShared)
    {
        const member = classShared.values.find(value => value.name === memberName);
        if (member) return member;
    }

    const matches = enumCatalog(schemaRoot).filter(entry =>
        (entry?.name === enumType || entry?.qualifiedName === enumType) &&
        Array.isArray(entry.values)
    );
    const resolved = matches
        .map(entry => entry.values.find(value => value.name === memberName))
        .filter(Boolean);
    if (resolved.length === 1) return resolved[0];
    if (resolved.length > 1 && resolved.every(value => value.value === resolved[0].value)) return resolved[0];
    const shared = sourceSharedEnum(enumType);
    if (shared)
    {
        const member = shared.values.find(value => value.name === memberName);
        if (member) return member;
    }
    return null;
}

// Source-proven typedef aliases where the alias name does not carry enough structure.
// These come from trinity/trinity/Shader/Tr2EffectDescription.h.
const COLLECTION_TYPE_ALIASES = Object.freeze({
    Tr2EffectResourceMap: { kind: "map", arg: "Tr2EffectResource" },
    Tr2SamplerSetupMap: { kind: "map", arg: "Tr2SamplerSetup" },
    Tr2EffectParameterAnnotationMap: { kind: "list", arg: "Tr2EffectParameterAnnotation" },
    Tr2EffectAnnotationMap: { kind: "map", arg: "Tr2EffectParameterAnnotationMap" }
});

// Source-backed corrections for C++ structures whose public Blue wire shape and
// defaults are defined in a .cpp BlueStructureDefinition rather than as class
// attributes or member initializers visible to the schema scan.
const SOF_FACTION_COLOR_NAMES = Object.freeze([
    "Killmark",
    "PrimaryForcefield",
    "SecondaryForcefield",
    "PrimaryFx",
    "SecondaryFx",
    "PrimaryWarpFx",
    "PrimaryAttackFX",
    "PrimarySiegeFX",
    "PrimaryDockedFX",
    "Primary",
    "Secondary",
    "Tertiary",
    "Black",
    "White",
    "Yellow",
    "Orange",
    "Red",
    "Blue",
    "Green",
    "Cyan",
    "Fire",
    "PrimaryHologram",
    "SecondaryHologram",
    "TertiaryHologram",
    "PrimaryLight",
    "SecondaryLight",
    "TertiaryLight",
    "WhiteLight",
    "Hull",
    "Glass",
    "Reactor",
    "Darkhull",
    "Booster",
    "PrimaryBanner",
    "PrimaryBillboard",
    "PrimarySpotlight",
    "SecondarySpotlight",
    "TertiarySpotlight",
    "State0",
    "State1",
    "State2",
    "State3",
    "StateVulnerable",
    "StateInvulnerable"
]);

const SOF_FACTION_COLOR_SPECIAL_DEFAULTS = Object.freeze({
    PrimaryBillboard: Object.freeze([2.5, 2.5, 2.5, 2.5]),
    PrimaryWarpFx: Object.freeze([1, 99 / 255, 51 / 255, 1]),
    PrimaryAttackFX: Object.freeze([1, 24 / 255, 11 / 255, 1]),
    PrimarySiegeFX: Object.freeze([1, 94 / 255, 45 / 255, 1]),
    PrimaryDockedFX: Object.freeze([76 / 255, 130 / 255, 226 / 255, 1])
});

const SOF_FACTION_COLOR_FIELD_OVERRIDES = Object.freeze(Object.fromEntries(
    SOF_FACTION_COLOR_NAMES.map(name => [
        name,
        Object.freeze({
            default: SOF_FACTION_COLOR_SPECIAL_DEFAULTS[name] || Object.freeze([0, 0, 0, 1])
        })
    ])
));

// EveSwarm::BehaviorProperties is an inline C++ value record. The current Blue
// scan resolves EveSOFDataGenericSwarm's dotted leaves as the root struct and
// consequently mislabels them as integer enums. Carbon's constructor in
// Eve/SpaceObject/EveSwarm.h is authoritative for all 25 float defaults.
const EVE_SWARM_BEHAVIOR_DEFAULTS = Object.freeze({
    mass: 1,
    speedMultiplier: 1.1,
    speedMinimum: 10,
    agility: 2,
    maxDistance0: 500,
    maxDistance1: 125,
    timeMultiplier: 1,
    maxTime: 0.2,
    speed0: 700,
    speed1: 1000,
    weightCohesion: 0.1,
    weightSeparation: 0.1,
    separationDistance: 250,
    weightAlign: 50,
    weightWander: 0.33,
    wanderFluctuation: 0.05,
    wanderDistance: 100,
    wanderRadius: 80,
    weightAnchor: 0.5,
    anchorRadius0: 75,
    anchorRadius1: 250,
    weightDeceleration: 0.1,
    maxDeceleration: 200,
    weightFormation: 1,
    formationDistance: 50
});

const SOF_GENERIC_SWARM_EXPOSED_FIELDS = Object.freeze([
    "speedMultiplier",
    "speedMinimum",
    "maxDistance0",
    "maxDistance1",
    "maxTime",
    "speed0",
    "speed1",
    "weightFormation",
    "weightCohesion",
    "weightSeparation",
    "weightAlign",
    "weightWander",
    "weightAnchor",
    "anchorRadius0",
    "anchorRadius1",
    "weightDeceleration",
    "maxDeceleration",
    "separationDistance",
    "formationDistance",
    "wanderFluctuation",
    "wanderDistance",
    "wanderRadius"
]);

function swarmBehaviorFieldOverrides(names)
{
    return Object.freeze(Object.fromEntries(names.map(name => [
        name,
        Object.freeze({
            kind: "float32",
            enumType: null,
            default: EVE_SWARM_BEHAVIOR_DEFAULTS[name]
        })
    ])));
}

const EVE_SWARM_BEHAVIOR_FIELD_OVERRIDES = swarmBehaviorFieldOverrides(
    Object.keys(EVE_SWARM_BEHAVIOR_DEFAULTS)
);
const SOF_GENERIC_SWARM_FIELD_OVERRIDES = swarmBehaviorFieldOverrides(
    SOF_GENERIC_SWARM_EXPOSED_FIELDS
);

const SOURCE_FIELD_OVERRIDES = Object.freeze({
    CompressionOptions: Object.freeze({
        // nvtt::Quality_Production; Blue exposes the chooser key PRODUCTION.
        quality: Object.freeze({ kind: "int32", enumType: "Quality", default: 2 })
    }),
    EveSwarm: EVE_SWARM_BEHAVIOR_FIELD_OVERRIDES,
    // EveSphereVolume_Blue.cpp exposes the leaves of two CcpMath::Sphere
    // members. The scanner currently attributes the root struct type to each
    // dotted leaf and consequently misclassifies all three leaves as an enum.
    EveSphereVolume: Object.freeze({
        position: Object.freeze({ kind: "vec3", enumType: null, default: [0, 0, 0] }),
        radius: Object.freeze({ kind: "float32", enumType: null, default: 1 }),
        innerRadius: Object.freeze({ kind: "float32", enumType: null, default: 1 })
    }),
    // Dotted-member enum projection used the enclosing struct name; the leaf
    // member is PostProcessEnums::Priority (EveChildFogVolume::m_settings.priority
    // and EveChildLightingOverride::m_overrides.priority).
    EveChildFogVolume: Object.freeze({
        priority: Object.freeze({ enumType: "Priority" })
    }),
    EveChildLightingOverride: Object.freeze({
        priority: Object.freeze({ enumType: "Priority" })
    }),
    EveSOFDataBooster: Object.freeze({
        shape0: Object.freeze({ factory: "EveSOFDataBoosterShape" }),
        shape1: Object.freeze({ factory: "EveSOFDataBoosterShape" }),
        warpShape0: Object.freeze({ factory: "EveSOFDataBoosterShape" }),
        warpShape1: Object.freeze({ factory: "EveSOFDataBoosterShape" })
    }),
    EveSOFDataFactionColorSet: SOF_FACTION_COLOR_FIELD_OVERRIDES,
    EveSOFDataGeneric: Object.freeze({
        decalMinScreenSize: Object.freeze({ omit: true }),
        decalMinScreenSizeSTANDARD: Object.freeze({
            add: true,
            kind: "float32",
            member: "m_decalMinScreenSizes[EveSOFDataHullDecalSetItem::USAGE_STANDARD]",
            cppType: "float",
            flags: ["READWRITE", "PERSIST"],
            default: 0
        }),
        decalMinScreenSizeKILLCOUNTER: Object.freeze({
            add: true,
            kind: "float32",
            member: "m_decalMinScreenSizes[EveSOFDataHullDecalSetItem::USAGE_KILLCOUNTER]",
            cppType: "float",
            flags: ["READWRITE", "PERSIST"],
            default: 0
        }),
        decalMinScreenSizeHOLE: Object.freeze({
            add: true,
            kind: "float32",
            member: "m_decalMinScreenSizes[EveSOFDataHullDecalSetItem::USAGE_HOLE]",
            cppType: "float",
            flags: ["READWRITE", "PERSIST"],
            default: 0
        }),
        decalMinScreenSizeCYLINDRICAL: Object.freeze({
            add: true,
            kind: "float32",
            member: "m_decalMinScreenSizes[EveSOFDataHullDecalSetItem::USAGE_CYLINDRICAL]",
            cppType: "float",
            flags: ["READWRITE", "PERSIST"],
            default: 0
        }),
        decalMinScreenSizeGLOWCYLINDRICAL: Object.freeze({
            add: true,
            kind: "float32",
            member: "m_decalMinScreenSizes[EveSOFDataHullDecalSetItem::USAGE_GLOWCYLINDRICAL]",
            cppType: "float",
            flags: ["READWRITE", "PERSIST"],
            default: 0
        }),
        decalMinScreenSizeGLOWSTANDARD: Object.freeze({
            add: true,
            kind: "float32",
            member: "m_decalMinScreenSizes[EveSOFDataHullDecalSetItem::USAGE_GLOWSTANDARD]",
            cppType: "float",
            flags: ["READWRITE", "PERSIST"],
            default: 0
        }),
        decalMinScreenSizeLOGO: Object.freeze({
            add: true,
            kind: "float32",
            member: "m_decalMinScreenSizes[EveSOFDataHullDecalSetItem::USAGE_LOGO]",
            cppType: "float",
            flags: ["READWRITE", "PERSIST"],
            default: 0
        }),
        bannerShader: Object.freeze({
            kind: "struct",
            typeArg: "EveSOFDataGenericShader",
            factory: "EveSOFDataGenericShader"
        })
    }),
    EveSOFDataGenericSwarm: SOF_GENERIC_SWARM_FIELD_OVERRIDES,
    EveSOFDataHullPlaneSetItem: Object.freeze({
        blinkMode: Object.freeze({ kind: "int32", enumType: "BlinkType" })
    }),
    EveSOFDataDecalIndexBuffer: Object.freeze({
        indexBuffer: Object.freeze({ kind: "typedArray", typeArg: "Uint32Array" })
    }),
    EveSOFDataHullDecalSet: Object.freeze({
        visibilityGroup: Object.freeze({ default: "primary" })
    }),
    EveSOFDataHullLightSet: Object.freeze({
        visibilityGroup: Object.freeze({ default: "primary" })
    }),
    EveSOFDataHullSpriteSet: Object.freeze({
        visibilityGroup: Object.freeze({ default: "primary" })
    }),
    EveSOFDataHullSpotlightSet: Object.freeze({
        visibilityGroup: Object.freeze({ default: "primary" })
    }),
    EveSOFDataHullSpotlightSetItem: Object.freeze({
        colorType: Object.freeze({ default: 12 })
    }),
    EveSOFDataHullPlaneSet: Object.freeze({
        visibilityGroup: Object.freeze({ default: "primary" })
    }),
    EveSOFDataHullExtensionPlacement: Object.freeze({
        distribution: Object.freeze({ factory: "EveSOFDataHullExtensionPlacementDistributionPlacement" }),
        descriptor: Object.freeze({ factory: "EveSOFDNADescriptor" })
    }),
    EveSOFDataHullExtensionPlacementDistributionParentMatch: Object.freeze({
        parentDescriptor: Object.freeze({ factory: "EveSOFDNADescriptor" })
    }),
    EveSOFDataHullLightSetItem: Object.freeze({
        lightColor: Object.freeze({ kind: "int32", enumType: "ColorType" }),
        flags: Object.freeze({ default: 1 }),
        boneIndex: Object.freeze({ default: -1 }),
        noiseFrequency: Object.freeze({ default: 1 }),
        noiseOctaves: Object.freeze({ default: 1 })
    }),
    EveSOFDataHullLightSetSpotLight: Object.freeze({
        flags: Object.freeze({ default: 1 }),
        boneIndex: Object.freeze({ default: -1 }),
        noiseFrequency: Object.freeze({ default: 1 }),
        noiseOctaves: Object.freeze({ default: 1 })
    }),
    EveSOFDataHullLightSetTexturedPointLight: Object.freeze({
        flags: Object.freeze({ default: 1 }),
        boneIndex: Object.freeze({ default: -1 }),
        noiseFrequency: Object.freeze({ default: 1 }),
        noiseOctaves: Object.freeze({ default: 1 })
    }),
    Tr2SamplerOverride: Object.freeze({
        addressU: Object.freeze({ kind: "int32", enumType: "TextureAddressMode", default: 1 }),
        addressV: Object.freeze({ kind: "int32", enumType: "TextureAddressMode", default: 1 }),
        addressW: Object.freeze({ kind: "int32", enumType: "TextureAddressMode", default: 1 }),
        filter: Object.freeze({ kind: "int32", enumType: "TextureFilter", default: 2 }),
        mipFilter: Object.freeze({ kind: "int32", enumType: "TextureFilter", default: 2 }),
        maxAnisotropy: Object.freeze({ default: 4 }),
        sampler: Object.freeze({ omit: true })
    }),
    // TriDevice_Blue.cpp maps the Tr2PresentParametersAL member leaf and names
    // the actual chooser. The scanner sees only the enclosing struct type.
    TriDevice: Object.freeze({
        presentationInterval: Object.freeze({
            kind: "int32",
            enumType: "PresentInterval",
            default: 0
        })
    }),
    EveSpaceObjectVSData: Object.freeze({
        customMaskMatrix: Object.freeze({ kind: "array", typeArg: "mat4", default: [IDENTITY_MAT4, IDENTITY_MAT4] }),
        customMaskData: Object.freeze({ kind: "array", typeArg: "vec4", default: [[0, 0, 0, 0], [0, 0, 0, 0]] }),
        boneOffsets: Object.freeze({ kind: "array", typeArg: "uint32", default: [0, 0, 0, 0] })
    }),
    EveSpaceObjectPSData: Object.freeze({
        shLightingCoefficients: Object.freeze({ kind: "array", typeArg: "vec4", default: Array.from({ length: 7 }, () => [0, 0, 0, 0]) }),
        customMaskMaterialIDs: Object.freeze({ kind: "array", typeArg: "vec4", default: [[0, 0, 0, 0], [0, 0, 0, 0]] }),
        customMaskTargets: Object.freeze({ kind: "array", typeArg: "vec4", default: [[0, 0, 0, 0], [0, 0, 0, 0]] })
    }),
    EveSpacePerObjectData: Object.freeze({
        customMaskMatrix: Object.freeze({ kind: "array", typeArg: "mat4", default: [IDENTITY_MAT4, IDENTITY_MAT4] }),
        customMaskData: Object.freeze({ kind: "array", typeArg: "vec4", default: [[0, 0, 0, 0], [0, 0, 0, 0]] }),
        customMaskMaterialIDs: Object.freeze({ kind: "array", typeArg: "vec4", default: [[0, 0, 0, 0], [0, 0, 0, 0]] }),
        customMaskTargets: Object.freeze({ kind: "array", typeArg: "vec4", default: [[0, 0, 0, 0], [0, 0, 0, 0]] }),
        boneOffsets: Object.freeze({ kind: "array", typeArg: "uint32", default: [0, 0, 0, 0] }),
        shLighting: Object.freeze({ kind: "array", typeArg: "vec4", default: Array.from({ length: 7 }, () => [0, 0, 0, 0]) })
    }),
    EveSpaceObjectDecal: Object.freeze({
        batchType: Object.freeze({ default: 1 })
    }),
    Tr2GpuSharedEmitter: Object.freeze({
        angle: Object.freeze({ kind: "float32", enumType: null }),
        innerAngle: Object.freeze({ kind: "float32", enumType: null }),
        radius: Object.freeze({ kind: "float32", enumType: null }),
        minSpeed: Object.freeze({ kind: "float32", enumType: null }),
        maxSpeed: Object.freeze({ kind: "float32", enumType: null }),
        minLifeTime: Object.freeze({ kind: "float32", enumType: null }),
        maxLifeTime: Object.freeze({ kind: "float32", enumType: null }),
        sizes: Object.freeze({ kind: "vec3", enumType: null, default: [0, 0, 0] }),
        sizeVariance: Object.freeze({ kind: "float32", enumType: null }),
        color0: Object.freeze({ kind: "color", enumType: null, default: [0, 0, 0, 0] }),
        color1: Object.freeze({ kind: "color", enumType: null, default: [0, 0, 0, 0] }),
        color2: Object.freeze({ kind: "color", enumType: null, default: [0, 0, 0, 0] }),
        color3: Object.freeze({ kind: "color", enumType: null, default: [0, 0, 0, 0] }),
        textureIndex: Object.freeze({ kind: "uint32", enumType: null }),
        colorMidpoint: Object.freeze({ kind: "float32", enumType: null, default: 0.5 }),
        velocityStretchRotation: Object.freeze({ kind: "float32", enumType: null }),
        drag: Object.freeze({ kind: "float32", enumType: null }),
        turbulenceAmplitude: Object.freeze({ kind: "float32", enumType: null }),
        turbulenceFrequency: Object.freeze({ kind: "uint32", enumType: null, default: 1 }),
        gravity: Object.freeze({ kind: "float32", enumType: null })
    }),
    Tr2GpuUniqueEmitter: Object.freeze({
        attractorStrength: Object.freeze({
            add: true,
            kind: "float32",
            enumType: null,
            default: 0,
            member: "m_params.attractorStrength",
            cppType: "float",
            flags: ["READWRITE", "PERSIST", "NOTIFY"]
        })
    }),
    Tr2MeshBase: Object.freeze({
        maxVertexScale: Object.freeze({ kind: "float32", enumType: null, default: 1 }),
        maxVertexDisplacement: Object.freeze({ kind: "float32", enumType: null, default: 0 }),
        rotatesVertices: Object.freeze({ kind: "boolean", enumType: null, default: false })
    }),
    TriRenderJob: Object.freeze({
        steps: Object.freeze({ kind: "list", typeArg: "TriRenderStep", enumType: null, default: [] })
    }),
    TriStepSetStdRndStates: Object.freeze({
        renderingMode: Object.freeze({ default: 1 })
    })
});

function applySourceFieldOverrides(className, fields)
{
    const overrides = SOURCE_FIELD_OVERRIDES[className];
    if (!overrides) return;
    for (let index = fields.length - 1; index >= 0; index--)
    {
        const field = fields[index];
        const override = overrides[field.name];
        if (!override) continue;
        if (override.omit)
        {
            fields.splice(index, 1);
            continue;
        }
        if (override.kind)
        {
            field.kind = override.kind;
            field.typeArg = override.typeArg || null;
        }
        if (Object.hasOwn(override, "enumType"))
        {
            field.enumType = override.enumType;
            field.enumQualifiedName = null;
            field.enumOwnerClass = null;
        }
        if (Object.hasOwn(override, "default"))
        {
            field.default = { determinate: true, value: override.default, source: "source-override" };
        }
        if (override.factory)
        {
            field.default = {
                determinate: true,
                value: { __factory: override.factory },
                source: "source-factory"
            };
        }
        field.notes.push("source-backed Blue structure override");
    }
    for (const [name, override] of Object.entries(overrides))
    {
        if (!override.add || fields.some(field => field.name === name)) continue;
        fields.push(buildExpectedField({
            name,
            member: override.member || name,
            cppType: override.cppType || null,
            flags: override.flags || [],
            kindInfo: {
                kind: override.kind,
                arg: override.typeArg || null,
                enumType: override.enumType || null,
                enumQualifiedName: null,
                enumOwnerClass: null
            },
            parsedDefault: {
                determinate: true,
                value: Object.hasOwn(override, "default") ? override.default : canonicalDefault(override.kind),
                source: "source-override"
            },
            notes: ["source-backed Blue structure override"]
        }));
    }
}

// Carbon wraps by-value list items in generated "<Item>Structure" holders
// (e.g. PTr2CurveScalarKeyStructureList). The runtime item class is the unwrapped name.
function stripStructureSuffix(name)
{
    if (!name) return name;
    return String(name).replace(/Structure$/, "");
}

// Carbon clock types (Be::Time, CcpTime) are int64 tick clocks in C++, converted via
// TimeAsDouble/TimeAsFloat to seconds before curve evaluation. Runtime-facing JS uses a
// numeric seconds scalar (float64), never a fake enum "Time" or a raw struct; raw ticks
// belong only in explicit binary/format readers. See .agents/DECISIONS.md (2026-07-08).
const TIME_SCALAR_CPP = new Set(["Be::Time", "CcpTime"]);
function isTimeScalarCpp(cppType)
{
    return TIME_SCALAR_CPP.has(String(cppType || "").trim());
}

// Returns { kind, arg?, enumType? }
function inferKindFromCpp(cppType, name, schemaRoot = DEFAULT_SCHEMA_ROOT, className = null)
{
    const original = String(cppType || "").trim();
    const type = normalizeCppType(original);
    const named = normalizeCppTypeName(original);

    if (!type) return { kind: "unknown" };
    if (isTimeScalarCpp(original)) return { kind: "float64" };
    if (COLLECTION_TYPE_ALIASES[named]) return { ...COLLECTION_TYPE_ALIASES[named] };
    if (type.includes("std::vector") || /(?:Vector|List)$/.test(named)) return { kind: "list", arg: collectionItemType(original) };
    if (type.includes("std::map") || /Map$/.test(named)) return { kind: "map", arg: collectionItemType(original) };
    if (type.includes("std::set") || /Set$/.test(named)) return { kind: "set", arg: collectionItemType(original) };
    if (/\*$/.test(type) || /^P(?:I)?[A-Z]\w+$/.test(named) || /(?:Ptr|Ref)$/.test(named)) return { kind: "objectRef", arg: cleanNamedType(original) };

    switch (named)
    {
        case "bool": return { kind: "boolean" };
        case "char": case "int8_t": return { kind: "int8" };
        case "uint8_t": case "byte": case "unsigned char": return { kind: "uint8" };
        case "int16_t": case "short": return { kind: "int16" };
        case "uint16_t": case "ushort": case "unsigned short": return { kind: "uint16" };
        case "int": case "int32_t": case "long": return { kind: "int32" };
        case "uint": case "uint32_t": case "ulong": case "unsigned": case "unsigned int": case "unsigned long": return { kind: "uint32" };
        case "int64_t": case "longlong": return { kind: "int64" };
        case "uint64_t": case "size_t": case "ulonglong": return { kind: "uint64" };
        case "float": return { kind: "float32" };
        case "double": return { kind: "float64" };
        case "std::string": case "std::wstring": case "BlueSharedString": case "BlueSharedStringW":
            return { kind: isExpressionLike(name) ? "expression" : "string" };
        case "Vector2": return { kind: "vec2" };
        case "Vector3": return { kind: "vec3" };
        case "Vector4": return { kind: isRotationLike(name) ? "quat" : isColorLike(name) ? "color" : "vec4" };
        case "Color": case "ColorRGBA": case "LinearColor": return { kind: "color" };
        case "Quaternion": return { kind: "quat" };
        case "Matrix3": case "Mat3": return { kind: "mat3" };
        case "Matrix": case "Matrix4": case "Mat4": case "TriMatrix": return { kind: "mat4" };
        default: break;
    }

    const scoped = named.match(/^(.+?)::([A-Za-z_]\w*)$/);
    const enumLikeTail = /(?:Type|Usage|Mode|Enum)$/;
    if (scoped && (
        scoped[1].endsWith("Enum") ||
        enumLikeTail.test(scoped[2]) ||
        knownEnumNames(schemaRoot).has(cleanNamedType(scoped[2]))
    ))
    {
        return { kind: "int32", ...enumReferenceFrom(null, named, className, schemaRoot) };
    }
    if (type.includes("::")) return { kind: "rawStruct", arg: cleanNamedType(original) };
    if (knownEnumNames(schemaRoot).has(named))
    {
        return { kind: "int32", ...enumReferenceFrom(named, named, className, schemaRoot) };
    }
    if (isOpaqueNamedValueType(named)) return { kind: "rawStruct", arg: cleanNamedType(original) };
    return { kind: "unknown" };
}

const MATH_KINDS = new Set(["vec2", "vec3", "vec4", "color", "quat", "mat3", "mat4"]);
const INLINE_CPP_KINDS = new Set(
    [...KNOWN_TYPE_KINDS].filter(kind => !["unknown", "rawStruct", "struct"].includes(kind))
);

// Resolve a usable enum name. Carbon inner enums are declared as `enum Type` (or Mode/…)
// inside a named scope, so an unscoped generic name resolves to the scope from the cppType
// (e.g. enumType "Type" + cppType "Tr2CurveExtrapolation::Type" -> "Tr2CurveExtrapolation").
// Map schema wire metadata (black entry) -> { kind, arg?, enumType? }.
function inferKindFromBlack(black, cppType, name, schemaRoot = DEFAULT_SCHEMA_ROOT, className = null)
{
    if (!black) return inferKindFromCpp(cppType, name, schemaRoot, className);

    const effectiveCppType = isUsefulCppType(black.cppType) ? black.cppType : cppType;

    // Be::Time/CcpTime wired as enum "Time" (or LONG) is still a numeric seconds scalar.
    if (isTimeScalarCpp(effectiveCppType)) return { kind: "float64" };

    if (black.wireType === "enum" || black.enumType)
    {
        return {
            kind: "int32",
            ...enumReferenceFrom(black.enumType, effectiveCppType, className, schemaRoot)
        };
    }

    switch (black.wireType)
    {
        case "stringRef": case "wstringRef":
            return { kind: isExpressionLike(name) ? "expression" : "string" };
        case "bool": return { kind: "boolean" };
        case "float32": return { kind: "float32" };
        case "int32": return { kind: "int32" };
        case "uint32": return { kind: "uint32" };
        case "uint8": return { kind: "uint8" };
        case "uint16": return { kind: "uint16" };
        case "int64": return { kind: "int64" };
        case "floatArray":
        {
            const length = Number(black.length) || 0;
            if (length === 2) return { kind: "vec2" };
            if (length === 3) return { kind: "vec3" };
            if (length === 9) return { kind: "mat3" };
            if (length === 16) return { kind: "mat4" };
            const named = normalizeCppTypeName(effectiveCppType);
            if (named === "Quaternion" || isRotationLike(name)) return { kind: "quat" };
            if (named === "Color" || named === "ColorRGBA" || named === "LinearColor") return { kind: "color" };
            if (isColorLike(name)) return { kind: "color" };
            return { kind: "vec4" };
        }
        case "objectRef":
            return { kind: "model", arg: cleanNamedType(effectiveCppType) };
        case "container":
            return { kind: "list", arg: collectionItemType(effectiveCppType) };
        case "binaryBlock":
            return { kind: "typedArray", arg: "Uint8Array" };
        case "inlineObject":
        case "struct":
        {
            // Math value types (Quaternion, Color, Vector2/3/4, matrices) are wired as
            // inline objects in some docs but map to their @type.* math kinds, not struct.
            const resolved = inferKindFromCpp(effectiveCppType, name, schemaRoot, className);
            if (INLINE_CPP_KINDS.has(resolved.kind)) return resolved;
            return { kind: "struct", arg: cleanNamedType(effectiveCppType) };
        }
        default:
            return inferKindFromCpp(effectiveCppType, name, schemaRoot, className);
    }
}

// ---------------------------------------------------------------------------
// Schema doc loading + expected-field derivation
// ---------------------------------------------------------------------------

function readJson(file)
{
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function roleKey(names, role)
{
    if (!names || typeof names !== "object") return null;
    for (const [name, roles] of Object.entries(names))
    {
        const roleList = Array.isArray(roles) ? roles : String(roles).split(/\s+/);
        if (roleList.includes(role)) return name;
    }
    return null;
}

function stripMemberPrefix(member)
{
    if (!member) return null;
    const rootName = String(member).match(/[A-Za-z_][A-Za-z0-9_]*/);
    if (!rootName) return null;
    return rootName[0].replace(/^m_/, "");
}

function normalizeMemberPath(member)
{
    return String(member || "")
        .replace(/\s+/g, "")
        .replace(/\[[^\]]+\]/g, "");
}

function memberLeafName(member)
{
    const path = normalizeMemberPath(member);
    const leaf = path.split(".").at(-1) || null;
    return leaf ? leaf.replace(/^m_/, "") : null;
}

/**
 * Locate + read a schema doc. Options:
 *   { schema, schemaRoot, family, className }
 * Returns { doc, schemaPath, schemaRoot, family }.
 */
export function loadSchemaDoc(options = {})
{
    const schemaRoot = options.schemaRoot ? path.resolve(options.schemaRoot) : DEFAULT_SCHEMA_ROOT;

    if (options.schema)
    {
        const schemaPath = path.resolve(options.schema);
        if (!fs.existsSync(schemaPath))
        {
            throw withCode(new Error(`Schema doc not found: ${schemaPath}`), "schema-doc-missing");
        }
        const doc = readJson(schemaPath);
        // Root for member-path resolution is the parent of the family directory.
        const resolvedRoot = options.schemaRoot ? schemaRoot : path.resolve(path.dirname(schemaPath), "..");
        return { doc, schemaPath, schemaRoot: resolvedRoot, family: doc.family || options.family || null };
    }

    const className = options.className;
    if (!className)
    {
        throw withCode(new Error("Cannot locate schema doc without a class name or --schema path."), "schema-doc-missing");
    }

    if (options.family)
    {
        const familyIndexPath = path.join(schemaRoot, options.family, "index.json");
        if (!fs.existsSync(familyIndexPath))
        {
            throw withCode(new Error(`Unknown schema family "${options.family}" (no ${familyIndexPath}).`), "schema-doc-missing");
        }
        const familyIndex = readJson(familyIndexPath);
        const entry = (familyIndex.classes || []).find(item => item.blueClass === className || item.cppClass === className);
        if (!entry)
        {
            throw withCode(new Error(`Class "${className}" not found in family "${options.family}".`), "schema-doc-missing");
        }
        const schemaPath = path.join(schemaRoot, options.family, entry.jsonFile);
        return { doc: readJson(schemaPath), schemaPath, schemaRoot, family: options.family };
    }

    // Family-agnostic scan across the whole tree.
    const rootIndexPath = path.join(schemaRoot, "index.json");
    if (!fs.existsSync(rootIndexPath))
    {
        throw withCode(new Error(`Schema root index not found: ${rootIndexPath}`), "schema-doc-missing");
    }
    const rootIndex = readJson(rootIndexPath);
    const matches = [];
    for (const family of rootIndex.families || [])
    {
        const familyIndexPath = path.join(schemaRoot, family.index);
        if (!fs.existsSync(familyIndexPath)) continue;
        const familyIndex = readJson(familyIndexPath);
        for (const item of familyIndex.classes || [])
        {
            if (item.blueClass === className || item.cppClass === className)
            {
                matches.push({ family: family.name, jsonFile: path.join(schemaRoot, family.name, item.jsonFile) });
            }
        }
    }

    if (matches.length === 0)
    {
        throw withCode(new Error(`No schema doc found for class "${className}" under ${schemaRoot}.`), "schema-doc-missing");
    }
    if (matches.length > 1)
    {
        const families = matches.map(match => match.family).join(", ");
        throw withCode(new Error(`Class "${className}" is ambiguous across families [${families}]. Pass --family.`), "schema-doc-ambiguous");
    }

    return { doc: readJson(matches[0].jsonFile), schemaPath: matches[0].jsonFile, schemaRoot, family: matches[0].family };
}

function withCode(error, code)
{
    error.code = code;
    return error;
}

function isInterfaceLikeClassName(name)
{
    return /^I[A-Z]/.test(String(name || ""));
}

function hasClassBodyDetail(doc)
{
    return Boolean(
        doc?.blue?.isExposed ||
        (Array.isArray(doc?.attributes) && doc.attributes.length) ||
        (Array.isArray(doc?.black?.fields) && doc.black.fields.length) ||
        (Array.isArray(doc?.fields) && doc.fields.length) ||
        (Array.isArray(doc?.methods) && doc.methods.length)
    );
}

function parentHasEmittedClassBody(parent, schemaRoot, family)
{
    if (!parent?.jsonFile || !schemaRoot || !family)
    {
        return true;
    }
    const parentPath = path.join(schemaRoot, family, parent.jsonFile);
    if (!fs.existsSync(parentPath))
    {
        return false;
    }
    try
    {
        return hasClassBodyDetail(readJson(parentPath));
    }
    catch
    {
        return false;
    }
}

// Returns the concrete Carbon parent-class fact, if any. This is source/schema
// metadata for downstream libraries to consume; it is not a runtime policy
// default and does not imply that emitted classes must extend it.
export function schemaBaseClassForDoc(doc, options = {})
{
    const className = doc?.blueClass || doc?.cppClass || doc?.black?.className || null;
    const schemaRoot = options.schemaRoot ? path.resolve(options.schemaRoot) : null;
    const family = options.family || doc?.family || null;
    for (const parent of Array.isArray(doc?.parents) ? doc.parents : [])
    {
        const parentClass = parent?.cppClass;
        if (
            parentClass &&
            parentClass !== className &&
            parent.jsonFile &&
            !parent.external &&
            !isInterfaceLikeClassName(parentClass) &&
            parentHasEmittedClassBody(parent, schemaRoot, family)
        )
        {
            return parentClass;
        }
    }
    return null;
}

function expectedIo(flags)
{
    const set = new Set((flags || []).map(flag => String(flag).toUpperCase()));
    let ioName = null;
    if (set.has("PERSISTONLY")) ioName = "persistOnly";
    else if (set.has("PERSIST")) ioName = "persist";
    else if (set.has("READWRITE")) ioName = "readwrite";
    else if (set.has("READ") && set.has("WRITE")) ioName = "readwrite";
    else if (set.has("READ")) ioName = "read";
    else if (set.has("WRITE")) ioName = "write";
    return { ioName, notify: set.has("NOTIFY") };
}

function unionFlags(...lists)
{
    const seen = new Set();
    const result = [];
    for (const list of lists)
    {
        for (const flag of list || [])
        {
            if (!seen.has(flag))
            {
                seen.add(flag);
                result.push(flag);
            }
        }
    }
    return result;
}

// Resolve a dotted member (e.g. m_lightData.position) to a concrete leaf type via
// embedded nested field records first, then the root struct's own schema doc.
// Returns { cppType, default } | null.
function resolveMemberLeaf(doc, black, member, family, schemaRoot, declaredOn = null)
{
    if (!member || !member.includes(".")) return null;
    const leafMember = normalizeMemberPath(member).split(".").at(-1);
    const leafName = memberLeafName(member);
    const current = resolveMemberLeafInDoc(doc, member);
    if (current.field) return toResolvedMemberLeaf(current.field);

    const ownerDoc = declaredOn && declaredOn !== doc?.cppClass
        ? readFamilySchemaDoc(schemaRoot, family, declaredOn)
        : null;
    const ownerIsValueType = Boolean(
        ownerDoc &&
        ownerDoc.blue?.isExposed === false &&
        (!Array.isArray(ownerDoc.bases) || ownerDoc.bases.length === 0)
    );
    const owner = ownerDoc
        ? resolveMemberLeafInDoc(ownerDoc, member, ownerIsValueType)
        : { field: null, rootType: null };
    if (owner.field) return toResolvedMemberLeaf(owner.field);

    const rootTypes = [...new Set([current.rootType, owner.rootType, black?.cppType]
        .map(cleanNamedType)
        .filter(Boolean))];

    for (const rootType of rootTypes)
    {
        const sourceLeaf = SOURCE_MEMBER_LEAF_OVERRIDES[rootType]?.[leafMember];
        if (sourceLeaf) return sourceLeaf;
    }

    if (!family) return null;
    for (const rootType of rootTypes)
    {
        const rootDoc = readFamilySchemaDoc(schemaRoot, family, rootType);
        const leaf = (rootDoc?.fields || []).find(field =>
            isUsefulCppType(field.cppType) && memberLeafName(field.cppName) === leafName
        );
        if (leaf) return toResolvedMemberLeaf(leaf);
    }
    return null;
}

function resolveMemberLeafInDoc(doc, member, allowDirectLeaf = false)
{
    const fields = Array.isArray(doc?.fields) ? doc.fields : [];
    const memberPath = normalizeMemberPath(member);
    const memberRoot = memberPath.split(".")[0];
    const leafName = memberLeafName(memberPath);
    const exact = fields.find(field =>
        isUsefulCppType(field.cppType) && normalizeMemberPath(field.cppName) === memberPath
    );
    if (exact) return { field: exact, rootType: null };

    const rootField = topLevelFieldFor(doc, memberRoot);
    const rootType = isUsefulCppType(rootField?.cppType) ? cleanNamedType(rootField.cppType) : null;
    if (rootType)
    {
        const structured = fields.find(field =>
        {
            if (!isUsefulCppType(field.cppType)) return false;
            if (memberLeafName(field.cppName) !== leafName) return false;
            if (normalizeMemberPath(field.parent) === memberRoot) return true;
            return Boolean(field.nested && rootType && cleanNamedType(field.struct) === rootType);
        });
        return { field: structured || null, rootType: rootType || null };
    }

    // Some non-exposed, base-less schema docs represent the nested value type
    // directly (for example LightData), so there is no owner member root.
    const direct = allowDirectLeaf
        ? fields.find(field =>
            isUsefulCppType(field.cppType) && normalizeMemberPath(field.cppName) === leafName
        )
        : null;
    return { field: direct || null, rootType: null };
}

function readFamilySchemaDoc(schemaRoot, family, typeName)
{
    if (!schemaRoot || !family || !typeName) return null;
    const candidates = [cleanNamedType(typeName), cleanNamedType(typeName).split("::").at(-1)];
    for (const candidate of new Set(candidates))
    {
        const file = path.join(schemaRoot, family, `${candidate}.json`);
        if (!fs.existsSync(file)) continue;
        try { return readJson(file); }
        catch { return null; }
    }
    return null;
}

function toResolvedMemberLeaf(field)
{
    return {
        cppType: field.cppType,
        default: field.default || null
    };
}

function topLevelFieldFor(doc, member)
{
    if (!member) return null;
    const memberPath = normalizeMemberPath(member);
    const root = memberPath.split(".")[0];
    const matches = (doc.fields || []).filter(item =>
    {
        const fieldPath = normalizeMemberPath(item.cppName);
        return fieldPath === root || fieldPath === memberPath;
    });
    return matches.find(item => isUsefulCppType(item.cppType)) || matches[0] || null;
}

function topLevelDefaultFor(doc, member)
{
    return topLevelFieldFor(doc, member)?.default || null;
}

const INLINE_WIRE_TYPES = new Set(["inlineObject", "struct"]);

/**
 * Derive the expected field and method set from a schema doc.
 * Returns { fields, methods, fallback, meta } where meta = { className, family, shapeHash, isExposed }.
 * fallback is null unless the doc carries no field/method detail (interface / no-detail class).
 */
export function deriveExpectedFields(doc, options = {})
{
    const schemaRoot = options.schemaRoot ? path.resolve(options.schemaRoot) : DEFAULT_SCHEMA_ROOT;
    const family = options.family || doc.family || null;
    const includeInherited = Boolean(options.includeInherited);
    const className = doc.blueClass || doc.cppClass || doc.black?.className || null;
    const shapeHash = doc.hashes?.shapeHash || null;
    const isExposed = Boolean(doc.blue?.isExposed);

    const meta = {
        className,
        family,
        shapeHash,
        isExposed,
        cppClass: doc.cppClass || className,
        sourceBaseClass: schemaBaseClassForDoc(doc, { schemaRoot, family })
    };

    const attributes = Array.isArray(doc.attributes) ? doc.attributes : [];
    const blackFields = Array.isArray(doc.black?.fields) ? doc.black.fields : [];
    const rawFields = Array.isArray(doc.fields) ? doc.fields : [];
    const usableRawFields = rawFields.filter(field => field.cppName && isUsefulCppType(field.cppType));
    const methods = deriveExpectedMethods(doc);

    const hasDetail = attributes.length > 0 || blackFields.length > 0 || usableRawFields.length > 0 || methods.length > 0;
    if (!hasDetail)
    {
        return {
            fields: [],
            methods,
            fallback: {
                reason: "schema carries no field or method detail (interface/no-detail class)",
                shapeHash,
                isExposed
            },
            meta
        };
    }

    const fields = [];
    const seen = new Set();
    let inheritedSkipped = 0;

    const pushExpected = (raw) =>
    {
        if (!raw.name || seen.has(raw.name)) return;
        seen.add(raw.name);
        fields.push(raw);
    };

    if (attributes.length)
    {
        for (const attr of attributes)
        {
            const black = attr.black || null;
            const name = attr.blueName || roleKey(black?.names, "name") || stripMemberPrefix(attr.member);
            if (!name) continue;

            const declaredOn = attr.declaredOn || black?.declaredOn || null;
            const enumContextClass = declaredOn || className;
            if (!includeInherited && declaredOn && declaredOn !== meta.cppClass)
            {
                inheritedSkipped++;
                continue;
            }

            const member = attr.member || roleKey(black?.names, "memberPath") || roleKey(black?.names, "member");
            const flags = unionFlags(attr.flags, black?.flags);
            const notes = [];

            // Resolve the cppType from the black entry, the attribute, or the doc's own fields[]
            // so math value types wired as inlineObject still map to their math kinds.
            const fieldCppType = topLevelFieldFor(doc, member)?.cppType || null;
            const cppFallback = isUsefulCppType(attr.cppType) ? attr.cppType : fieldCppType;
            let kindInfo = inferKindFromBlack(black, cppFallback, name, schemaRoot, enumContextClass);
            let cppType = isUsefulCppType(black?.cppType) ? black.cppType : cppFallback;
            let defaultObj = attr.default || topLevelDefaultFor(doc, member);
            const leaf = member && member.includes(".")
                ? resolveMemberLeaf(doc, black, member, family, schemaRoot, declaredOn)
                : null;
            if (leaf?.default) defaultObj = leaf.default;

            // Dotted member path: the wire type describes the root struct, not the leaf.
            if (member && member.includes("."))
            {
                if (leaf)
                {
                    kindInfo = inferKindFromCpp(leaf.cppType, name, schemaRoot, enumContextClass);
                    cppType = leaf.cppType;
                }
                else if (INLINE_WIRE_TYPES.has(black?.wireType))
                {
                    kindInfo = { kind: "unknown" };
                    notes.push("unresolved member path");
                }
            }

            const parsedDefault = parseSchemaDefault(defaultObj, kindInfo.kind, {
                enumType: kindInfo.enumType,
                enumQualifiedName: kindInfo.enumQualifiedName,
                className: enumContextClass,
                schemaRoot
            });

            pushExpected(buildExpectedField({
                name, member, cppType, flags, kindInfo, parsedDefault, notes
            }));
        }
    }
    else if (blackFields.length)
    {
        for (const black of blackFields)
        {
            const name = roleKey(black.names, "name") || stripMemberPrefix(roleKey(black.names, "member"));
            if (!name) continue;
            const member = roleKey(black.names, "memberPath") || roleKey(black.names, "member");
            const flags = unionFlags(black.flags);
            const notes = [];

            const fieldCppType = topLevelFieldFor(doc, member)?.cppType || null;
            const cppFallback = isUsefulCppType(black.cppType) ? black.cppType : fieldCppType;
            const enumContextClass = black.declaredOn || className;
            let kindInfo = inferKindFromBlack(black, cppFallback, name, schemaRoot, enumContextClass);
            let cppType = cppFallback;
            let defaultObj = topLevelDefaultFor(doc, member);
            const leaf = member && member.includes(".")
                ? resolveMemberLeaf(doc, black, member, family, schemaRoot, black.declaredOn || null)
                : null;
            if (leaf?.default) defaultObj = leaf.default;

            if (member && member.includes("."))
            {
                if (leaf)
                {
                    kindInfo = inferKindFromCpp(leaf.cppType, name, schemaRoot, enumContextClass);
                    cppType = leaf.cppType;
                }
                else if (INLINE_WIRE_TYPES.has(black.wireType))
                {
                    kindInfo = { kind: "unknown" };
                    notes.push("unresolved member path");
                }
            }

            const parsedDefault = parseSchemaDefault(defaultObj, kindInfo.kind, {
                enumType: kindInfo.enumType,
                enumQualifiedName: kindInfo.enumQualifiedName,
                className: enumContextClass,
                schemaRoot
            });

            pushExpected(buildExpectedField({ name, member, cppType, flags, kindInfo, parsedDefault, notes }));
        }
    }
    else
    {
        for (const field of usableRawFields)
        {
            const name = stripMemberPrefix(field.cppName);
            if (!name) continue;
            const kindInfo = inferKindFromCpp(field.cppType, name, schemaRoot, className);
            const parsedDefault = parseSchemaDefault(field.default, kindInfo.kind, {
                enumType: kindInfo.enumType,
                enumQualifiedName: kindInfo.enumQualifiedName,
                className,
                schemaRoot
            });
            const notes = [];
            pushExpected(buildExpectedField({
                name, member: field.cppName, cppType: field.cppType || null,
                flags: [], kindInfo, parsedDefault, notes
            }));
        }
    }

    applySourceFieldOverrides(className, fields);
    // Carbon class-owned enums remain part of the class surface even when no
    // field on that class currently references them. Consumers may reference
    // the static vocabulary directly or project it onto another class.
    meta.ownedEnums = ownedEnumsForClass(className, schemaRoot);
    meta.referencedEnums = referencedEnumsForFields(
        fields,
        meta.ownedEnums,
        schemaRoot,
        className
    );
    meta.inheritedSkipped = inheritedSkipped;
    return { fields, methods, fallback: null, meta };
}

// Enums a class's fields reference through @schema.enum without owning them.
// Prefer an exact/class-scoped source declaration, then an unambiguous scanner
// catalog entry, then a bounded shared source vocabulary. No short-name choice
// is made between distinct scanner declarations.
function referencedEnumsForFields(fields, ownedEnums, schemaRoot = DEFAULT_SCHEMA_ROOT, className = null)
{
    const ownedIdentities = new Set((ownedEnums || []).map(enumCatalogIdentity).filter(Boolean));
    const ownedNames = new Set((ownedEnums || []).map(entry => entry.name));
    const resolved = [];
    const projectionIdentity = new Map((ownedEnums || []).map(entry => [
        entry.name,
        enumCatalogIdentity(entry) || `source:${entry.name}`
    ]));
    for (const field of fields)
    {
        const name = field.enumType;
        if (!name) continue;
        if (field.enumQualifiedName && ownedIdentities.has(field.enumQualifiedName)) continue;
        if (!field.enumQualifiedName && ownedNames.has(name)) continue;

        const matches = enumCatalog(schemaRoot).filter(entry =>
            Array.isArray(entry?.values) && (field.enumQualifiedName
                ? enumCatalogIdentity(entry) === field.enumQualifiedName
                : entry.name === name)
        );
        const catalogMatch = matches.length === 1
            ? matches[0]
            : matches.length > 1 && matches.every(entry =>
                JSON.stringify(entry.values) === JSON.stringify(matches[0].values))
                ? matches[0]
                : null;
        const classMatch = className && SOURCE_REFERENCED_ENUM_OVERRIDES[className]?.[name]
            ? sourceSharedEnum(name, className)
            : null;
        const match = classMatch || catalogMatch || sourceSharedEnum(name);
        if (!match) continue;

        const identity = enumCatalogIdentity(match);
        const prior = projectionIdentity.get(name);
        if (prior && prior !== identity)
        {
            const error = new Error(
                `${className || "class"} cannot project both ${prior} and ${identity} as enum static ${name}`
            );
            error.code = "enum-projection-collision";
            throw error;
        }
        if (prior) continue;
        projectionIdentity.set(name, identity);
        resolved.push({ ...match, name });
    }
    return resolved.sort((left, right) => left.name.localeCompare(right.name));
}

function sourceSharedEnum(name, className = null)
{
    const classValues = className
        ? SOURCE_REFERENCED_ENUM_OVERRIDES[className]?.[name]
        : null;
    const values = classValues || SOURCE_SHARED_ENUM_OVERRIDES[name];
    return values ? {
        name,
        qualifiedName: classValues ? `source:${className}::${name}` : `source:${name}`,
        ownerClass: null,
        values
    } : null;
}

function buildExpectedField({ name, member, cppType, flags, kindInfo, parsedDefault, notes })
{
    const io = expectedIo(flags);
    return {
        name,
        member: member || null,
        cppType: cppType || null,
        flags: flags || [],
        kind: kindInfo.kind,
        typeArg: kindInfo.arg || null,
        enumType: kindInfo.enumType || null,
        enumQualifiedName: kindInfo.enumQualifiedName || null,
        enumOwnerClass: kindInfo.enumOwnerClass || null,
        rotationLike: kindInfo.kind === "quat",
        io: io.ioName,
        notify: io.notify,
        default: parsedDefault,
        notes: notes || []
    };
}

function deriveExpectedMethods(doc)
{
    const methods = [];
    const seen = new Set();

    for (const method of Array.isArray(doc.methods) ? doc.methods : [])
    {
        const name = method.blueName || method.target || null;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        methods.push({
            name,
            blueName: method.blueName || null,
            target: method.target || null,
            declaredOn: method.declaredOn || null,
            macro: method.macro || null,
            description: method.description || null
        });
    }

    return methods;
}

// ---------------------------------------------------------------------------
// Class-file parsing
// ---------------------------------------------------------------------------

function normalizeSource(text)
{
    return String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

// String-aware comment stripper. Length-preserving: comment characters become spaces and
// newlines are preserved, so character offsets and line numbers stay identical to the input.
function stripComments(src)
{
    const out = new Array(src.length);
    let i = 0;
    const n = src.length;
    let quote = null;
    const blank = (index) => { out[index] = src[index] === "\n" ? "\n" : " "; };

    while (i < n)
    {
        const c = src[i];
        const d = src[i + 1];
        if (quote)
        {
            out[i] = c;
            if (c === "\\") { out[i + 1] = src[i + 1] ?? ""; i += 2; continue; }
            if (c === quote) quote = null;
            i++;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; out[i] = c; i++; continue; }
        if (c === "/" && d === "/")
        {
            while (i < n && src[i] !== "\n") { blank(i); i++; }
            continue;
        }
        if (c === "/" && d === "*")
        {
            blank(i); blank(i + 1); i += 2;
            while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { blank(i); i++; }
            if (i < n) { blank(i); blank(i + 1); i += 2; }
            continue;
        }
        out[i] = c;
        i++;
    }
    return out.join("");
}

function bracketsBalanced(str)
{
    let depth = 0;
    let quote = null;
    for (let i = 0; i < str.length; i++)
    {
        const c = str[i];
        if (quote)
        {
            if (c === "\\") { i++; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
    }
    return depth === 0;
}

function statementComplete(stmt)
{
    if (!bracketsBalanced(stmt)) return false;
    return /;\s*$/.test(stmt) || /\}\s*$/.test(stmt);
}

// Decorators may be namespaced through a schema object (e.g. @CjsSchema.type.float32);
// the last two segments are the namespace (`type`/`io`/`schema`) and the kind.
const DECOR_LEAD_RE = /^@(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*(\([\s\S]*?\))?/;
const FIELD_RE = /^(?:(?:public|private|protected|readonly|declare|override)\s+)*(#?[A-Za-z_$][\w$]*|\[[^\]]+\])\s*(?::\s*([^=]+?))?\s*=\s*([\s\S]*?);\s*$/;
const METHOD_RE = /^(?:(?:public|private|protected|override|async)\s+)*(#?[A-Za-z_$][\w$]*|\[[^\]]+\])\s*\(/;

/**
 * Parse a runtime class file. Returns:
 *   { className, base, fields:[{name, kind, typeArg, kinds[], ioNames[], notify, default, annotation, line, hasType, hasIo}],
 *     methods:[{name, line, carbonNames[], implNames[], hasCarbon, hasImpl}],
 *     helpers:[names], define:{className, family} }
 * Throws Error(code="class-file-unparseable") if no class is found.
 */
export function parseClassFile(rawText, options = {})
{
    const text = normalizeSource(rawText);
    const src = stripComments(text);
    const generated = /\/\/\s*Generated by format-carbon carbon-class --emit/i.test(text);

    const classMatch = src.match(/export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?/);
    if (!classMatch)
    {
        throw withCode(new Error(`No 'export class' declaration found in ${options.filePath || "class file"}.`), "class-file-unparseable");
    }
    const classNameFromDecl = classMatch[1];
    const base = classMatch[2] || null;

    const define = parseDefine(src);
    const className = define.className || classNameFromDecl;

    // Slice the class body by brace balance from the first `{` after the class match.
    const bodyOpen = src.indexOf("{", classMatch.index + classMatch[0].length);
    const body = bodyOpen >= 0 ? sliceBalanced(src, bodyOpen) : "";

    const fields = [];
    const methods = [];
    const helpers = [];

    const lineOffsets = buildLineOffsets(text);
    const bodyStartLine = bodyOpen >= 0 ? lineForOffset(lineOffsets, bodyOpen) : 1;

    const rawLines = body.split("\n");
    let pending = [];
    let lineNo = bodyStartLine;

    for (let idx = 0; idx < rawLines.length; idx++)
    {
        const physicalLine = bodyStartLine + idx;
        let line = rawLines[idx].trim();
        if (!line) continue;

        // A decorator whose argument spans lines (e.g. @type.array({\n ... })) must be
        // joined before stripping, otherwise the tail swallows the following field.
        while (line.startsWith("@") && !bracketsBalanced(line) && idx + 1 < rawLines.length)
        {
            idx++;
            line += " " + rawLines[idx].trim();
        }

        // Strip any leading decorators from this physical line.
        let matchedDecorator = true;
        while (matchedDecorator && line.length)
        {
            const dm = line.match(DECOR_LEAD_RE);
            if (dm)
            {
                pending.push({
                    ns: dm[1],
                    name: dm[2],
                    arg: dm[3] ? dm[3].slice(1, -1).trim() : undefined
                });
                line = line.slice(dm[0].length).trim();
            }
            else
            {
                matchedDecorator = false;
            }
        }
        if (!line) continue;

        // Accumulate a full statement (field decls / methods may span lines).
        let stmt = line;
        let consumed = idx;
        while (!statementComplete(stmt) && consumed + 1 < rawLines.length)
        {
            consumed++;
            stmt += " " + rawLines[consumed].trim();
        }
        idx = consumed;

        const handled = handleStatement(stmt, pending, physicalLine, fields, methods, helpers);
        void handled;
        pending = [];
        void lineNo;
    }

    return { className, base, define, fields, methods, helpers, generated };
}

function parseDefine(src)
{
    const match = src.match(/@(?:[A-Za-z_$][\w$]*\.)*type\.define\(\s*(\{[\s\S]*?\}|"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*)\s*\)/);
    if (!match) return { className: null, family: null };
    const arg = match[1].trim();
    if (arg.startsWith("{"))
    {
        const nameMatch = arg.match(/className\s*:\s*["']([^"']+)["']/);
        const familyMatch = arg.match(/family\s*:\s*["']([^"']+)["']/);
        return { className: nameMatch ? nameMatch[1] : null, family: familyMatch ? familyMatch[1] : null };
    }
    if (arg.startsWith('"') || arg.startsWith("'"))
    {
        return { className: arg.slice(1, -1), family: null };
    }
    // Identifier -> resolve `const <ID> = "...";`
    const constMatch = src.match(new RegExp(`const\\s+${arg}\\s*=\\s*["']([^"']+)["']`));
    return { className: constMatch ? constMatch[1] : null, family: null };
}

function handleStatement(stmt, pending, line, fields, methods, helpers)
{
    const trimmed = stmt.trim();

    // Methods / getters / constructors / static members are helpers.
    if (/^(?:static|get|set|constructor)\b/.test(trimmed))
    {
        const nameMatch = trimmed.match(/(?:static|get|set|async)?\s*([A-Za-z_$][\w$]*)/);
        if (nameMatch) helpers.push(nameMatch[1]);
        return false;
    }

    const fieldMatch = trimmed.match(FIELD_RE);
    if (fieldMatch)
    {
        const rawName = fieldMatch[1];
        // A method disguised as `name(... ) {...}` won't match FIELD_RE (needs `=`), so we're safe.
        const name = normalizeFieldName(rawName);
        const annotation = fieldMatch[2] ? fieldMatch[2].trim() : null;
        const initializer = fieldMatch[3].trim();

        const typeDecorators = pending.filter(d => d.ns === "type" && d.name !== "define");
        const ioDecorators = pending.filter(d => d.ns === "io");
        const schemaDecorators = pending.filter(d => d.ns === "schema");

        const field = {
            name,
            annotation,
            line,
            kinds: typeDecorators.map(d => d.name),
            kind: typeDecorators.length ? typeDecorators[0].name : null,
            typeArg: typeDecorators.length && typeDecorators[0].arg !== undefined ? parseTypeArg(typeDecorators[0].arg) : null,
            ioNames: ioDecorators.filter(d => d.name !== "notify").map(d => d.name),
            notify: ioDecorators.some(d => d.name === "notify"),
            enumArg: (() => {
                const enumDecorator = schemaDecorators.find(d => d.name === "enum");
                return enumDecorator && enumDecorator.arg !== undefined ? stripQuotes(enumDecorator.arg) : null;
            })(),
            hasType: typeDecorators.length > 0,
            hasIo: ioDecorators.length > 0,
            default: parseJsDefault(initializer, typeDecorators.length ? typeDecorators[0].name : null)
        };
        fields.push(field);
        return true;
    }

    const methodMatch = trimmed.match(METHOD_RE);
    if (methodMatch)
    {
        const name = normalizeFieldName(methodMatch[1]);
        helpers.push(name);
        methods.push(buildParsedMethod(name, pending, line));
        return false;
    }

    // Non-field, non-method (e.g. a bare declaration) -> record as helper name if any.
    const nameMatch = trimmed.match(/^([A-Za-z_$][\w$]*)/);
    if (nameMatch) helpers.push(nameMatch[1]);
    return false;
}

function buildParsedMethod(name, pending, line)
{
    const carbonDecorators = pending.filter(d => d.ns === "carbon");
    const implDecorators = pending.filter(d => d.ns === "impl");
    return {
        name,
        line,
        carbonNames: carbonDecorators.map(d => d.name),
        implNames: implDecorators.map(d => d.name),
        hasCarbon: carbonDecorators.some(d => d.name === "method"),
        hasImpl: implDecorators.length > 0
    };
}

function normalizeFieldName(rawName)
{
    if (rawName.startsWith("["))
    {
        const inner = rawName.slice(1, -1).trim();
        return stripQuotes(inner);
    }
    return rawName;
}

// A @type decorator argument is either a quoted/bare name or an options object
// (e.g. @type.array({ kind: "struct", className: "Tr2CurveScalarKey" })).
function parseTypeArg(value)
{
    const trimmed = String(value).trim();
    if (trimmed.startsWith("{"))
    {
        const classNameMatch = trimmed.match(/className\s*:\s*["']([^"']+)["']/);
        if (classNameMatch) return classNameMatch[1];
        const kindMatch = trimmed.match(/kind\s*:\s*["']([^"']+)["']/);
        return kindMatch ? kindMatch[1] : trimmed;
    }
    return stripQuotes(trimmed);
}

function stripQuotes(value)
{
    const trimmed = String(value).trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

const HELPER_CREATE_DEFAULT = {
    vec2: [0, 0], vec3: [0, 0, 0], vec4: [0, 0, 0, 0], quat: [0, 0, 0, 1],
    mat3: IDENTITY_MAT3, mat4: IDENTITY_MAT4
};

// Parse a JS initializer expression into { determinate, value } | { determinate:false, raw }.
function parseJsDefault(raw, kind)
{
    const trimmed = String(raw).trim();
    if (trimmed === "") return { determinate: false, raw: "" };

    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    {
        return { determinate: true, value: stripQuotes(trimmed) };
    }
    if (trimmed === "true") return { determinate: true, value: true };
    if (trimmed === "false") return { determinate: true, value: false };
    if (trimmed === "null") return { determinate: true, value: null };
    if (trimmed === "undefined") return { determinate: true, value: null };
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return { determinate: true, value: Number(trimmed) };
    if (/^-?\d+n$/.test(trimmed)) return { determinate: true, value: Number(trimmed.slice(0, -1)) };

    if (trimmed.startsWith("["))
    {
        const inner = trimmed.slice(1, -1).trim();
        if (inner === "") return { determinate: true, value: [] };
        const parts = splitTopLevelArgs(inner);
        if (parts.every(part => /^-?(?:\d+\.?\d*|\.\d+)$/.test(part)))
        {
            return { determinate: true, value: parts.map(Number) };
        }
        return { determinate: false, raw: trimmed };
    }

    if (/^new\s+Map\s*\(\s*\)$/.test(trimmed)) return { determinate: true, value: { __container: "map" } };
    if (/^new\s+Set\s*\(\s*\)$/.test(trimmed)) return { determinate: true, value: { __container: "set" } };
    const factoryMatch = trimmed.match(/^new\s+([A-Za-z_$][\w$]*)\s*\(\s*\)$/);
    if (factoryMatch) return { determinate: true, value: { __factory: factoryMatch[1] } };

    const createMatch = trimmed.match(/^(vec2|vec3|vec4|quat|mat3|mat4)\.create\(\s*\)$/);
    if (createMatch)
    {
        return { determinate: true, value: HELPER_CREATE_DEFAULT[createMatch[1]].slice() };
    }
    if (/^vec4\.createLinear\(\s*\)$/.test(trimmed))
    {
        return { determinate: true, value: [0, 0, 0, 1] };
    }
    const fromValuesMatch = trimmed.match(/^(?:vec2|vec3|vec4|quat|mat3|mat4)\.fromValues\(([^)]*)\)$/);
    if (fromValuesMatch)
    {
        const parts = splitTopLevelArgs(fromValuesMatch[1]);
        if (parts.every(part => /^-?(?:\d+\.?\d*|\.\d+)$/.test(part)))
        {
            return { determinate: true, value: parts.map(Number) };
        }
    }
    const numMatch = trimmed.match(/^num\.[a-z0-9]+\(\s*(-?[\d.]+)\s*\)$/i);
    if (numMatch) return { determinate: true, value: Number(numMatch[1]) };

    void kind;
    return { determinate: false, raw: trimmed };
}

function buildLineOffsets(text)
{
    const offsets = [0];
    for (let i = 0; i < text.length; i++)
    {
        if (text[i] === "\n") offsets.push(i + 1);
    }
    return offsets;
}

function lineForOffset(offsets, offset)
{
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi)
    {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return lo + 1;
}

function sliceBalanced(src, openIndex)
{
    let depth = 0;
    let quote = null;
    for (let i = openIndex; i < src.length; i++)
    {
        const c = src[i];
        if (quote)
        {
            if (c === "\\") { i++; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{") depth++;
        else if (c === "}")
        {
            depth--;
            if (depth === 0) return src.slice(openIndex + 1, i);
        }
    }
    return src.slice(openIndex + 1);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

const STRING_ALIASES = new Set(["string", "path", "expression"]);
const LIST_ALIASES = new Set(["list", "array"]);

// Returns { match:boolean, info?:string }
function kindsCompatible(expected, actualKind)
{
    const expKind = expected.kind;
    if (expKind === actualKind) return { match: true };
    if (STRING_ALIASES.has(expKind) && STRING_ALIASES.has(actualKind)) return { match: true };
    if (LIST_ALIASES.has(expKind) && LIST_ALIASES.has(actualKind)) return { match: true };
    if (expKind === "model" && actualKind === "objectRef") return { match: true };
    // vec4 <-> quat only when schema field is rotation-like (i.e. expected kind is quat).
    if (expKind === "quat" && actualKind === "vec4") return { match: true };
    if (expKind === "vec4" && actualKind === "quat") return { match: false };
    // color <-> vec4 is an info-level compatibility.
    if ((expKind === "color" && actualKind === "vec4") || (expKind === "vec4" && actualKind === "color"))
    {
        return { match: true, info: "color≈vec4" };
    }
    // enum expected (int32) accepts int32/uint32 in file.
    if (expected.enumType && (actualKind === "int32" || actualKind === "uint32")) return { match: true };
    return { match: false };
}

const IO_CAPS = {
    persist: ["read", "write", "persist"],
    persistOnly: ["persist", "persistOnly"],
    readwrite: ["read", "write"],
    read: ["read"],
    write: ["write"]
};

function capsFor(ioName)
{
    return new Set(IO_CAPS[ioName] || []);
}

function ioSatisfied(expectedIoName, actualIoNames)
{
    if (!expectedIoName) return true;
    const need = capsFor(expectedIoName);
    const have = new Set();
    for (const name of actualIoNames || [])
    {
        for (const cap of capsFor(name)) have.add(cap);
    }
    for (const cap of need)
    {
        if (!have.has(cap)) return false;
    }
    return true;
}

function defaultsEqual(a, b)
{
    if (Array.isArray(a) && Array.isArray(b))
    {
        if (a.length !== b.length) return false;
        return a.every((value, index) => Object.is(Number(value), Number(b[index])));
    }
    if (a && b && typeof a === "object" && typeof b === "object" && a.__container && b.__container)
    {
        return a.__container === b.__container;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && a.__factory && b.__factory)
    {
        return a.__factory === b.__factory;
    }
    if (typeof a === "number" && typeof b === "number") return Object.is(a, b);
    return Object.is(a, b);
}

/**
 * Compare expected fields against a parsed class file.
 * Returns { class, family, schemaPath, filePath, shapeHash, fields, summary, fallback }.
 */
export function compareClass(expected, parsed, options = {})
{
    const allowExtra = Boolean(options.allowExtra);
    const strict = Boolean(options.strict);
    const strictIo = Boolean(options.strictIo) || strict;
    const strictDefaults = Boolean(options.strictDefaults) || strict;

    const meta = expected.meta || {};
    const results = [];
    addClassPolicyResults(results, meta, parsed, options);

    // File fields that carry a @type or @io decorator are "data" fields.
    const dataFields = parsed.fields.filter(field => field.hasType || field.hasIo);
    const dataByName = new Map(dataFields.map(field => [field.name, field]));
    const undecoratedByName = new Map(parsed.fields.filter(field => !field.hasType && !field.hasIo).map(field => [field.name, field]));

    // Interface / no-field fallback: never silently pass.
    if (expected.fallback)
    {
        for (const field of dataFields)
        {
            results.push(makeExtraResult(field, allowExtra, strict));
        }
        const summary = summarize(results);
        return {
            class: meta.className || parsed.className || null,
            family: meta.family || null,
            shapeHash: meta.shapeHash || null,
            fields: results,
            summary,
            fallback: expected.fallback
        };
    }

    const expectedByName = new Map(expected.fields.map(field => [field.name, field]));
    const names = new Set([...expectedByName.keys(), ...dataByName.keys()]);

    for (const name of [...names].sort())
    {
        const exp = expectedByName.get(name) || null;
        const act = dataByName.get(name) || null;

        if (exp && !act)
        {
            const undecorated = undecoratedByName.get(name);
            if (undecorated)
            {
                results.push({
                    name, verdict: "type-mismatch", severity: "error", symbol: "cross",
                    notes: ["missing-type-decorator: field present but has no @type decorator"],
                    expected: exportExpected(exp),
                    actual: { type: null, io: null, default: null, line: undecorated.line }
                });
                continue;
            }
            results.push({
                name, verdict: "missing-in-file", severity: "error", symbol: "cross",
                notes: [`schema expects @type.${exp.kind}${exp.typeArg ? `("${exp.typeArg}")` : ""} ${name}${exp.member ? ` (${exp.member})` : ""} [${exp.flags.join(", ")}]`],
                expected: exportExpected(exp),
                actual: null
            });
            continue;
        }

        if (!exp && act)
        {
            results.push(makeExtraResult(act, allowExtra, strict));
            continue;
        }

        // Both present.
        const notes = [...(exp.notes || [])];
        let verdict = "match";
        let severity = "ok";

        if (act.kinds.length > 1)
        {
            results.push({
                name, verdict: "type-mismatch", severity: "error", symbol: "cross",
                notes: [`multiple-type-decorators: [${act.kinds.map(k => `@type.${k}`).join(", ")}]`],
                expected: exportExpected(exp),
                actual: exportActual(act)
            });
            continue;
        }
        if (act.kind && !KNOWN_TYPE_KINDS.has(act.kind))
        {
            results.push({
                name, verdict: "type-mismatch", severity: "error", symbol: "cross",
                notes: [`unknown-type-kind: @type.${act.kind}`],
                expected: exportExpected(exp),
                actual: exportActual(act)
            });
            continue;
        }
        if (!act.kind)
        {
            // Decorated with @io only, no @type.
            results.push({
                name, verdict: "type-mismatch", severity: "error", symbol: "cross",
                notes: ["missing-type-decorator: field has @io but no @type"],
                expected: exportExpected(exp),
                actual: exportActual(act)
            });
            continue;
        }

        const compat = kindsCompatible(exp, act.kind);
        if (!compat.match)
        {
            results.push({
                name, verdict: "type-mismatch", severity: "error", symbol: "cross",
                notes: [`schema expects @type.${exp.kind}, file has @type.${act.kind}`],
                expected: exportExpected(exp),
                actual: exportActual(act)
            });
            continue;
        }
        if (compat.info) notes.push(compat.info);

        // typeArg comparison (objectRef/struct/rawStruct/list item). Carbon's generated
        // "<Item>Structure" wrappers are the same runtime item type.
        if (exp.typeArg && act.typeArg && stripStructureSuffix(exp.typeArg) !== stripStructureSuffix(act.typeArg))
        {
            results.push({
                name, verdict: "type-mismatch", severity: "error", symbol: "cross",
                notes: [`item/ref type differs: schema "${exp.typeArg}" vs file "${act.typeArg}"`],
                expected: exportExpected(exp),
                actual: exportActual(act)
            });
            continue;
        }
        if (exp.typeArg && !act.typeArg)
        {
            notes.push(`item/ref type "${exp.typeArg}" unspecified in file`);
        }

        // enum meta.
        if (exp.enumType && !act.enumArg)
        {
            notes.push(`expected @schema.enum("${exp.enumType}")`);
        }
        else if (exp.enumType && act.enumArg && exp.enumType !== act.enumArg)
        {
            notes.push(`enum type differs: schema "${exp.enumType}" vs file "${act.enumArg}"`);
        }

        // io.
        let missingIo = false;
        if (!ioSatisfied(exp.io, act.ioNames))
        {
            missingIo = true;
            notes.push(`missing-io-flag: schema flags [${exp.flags.join(", ")}] expect @io.${exp.io}; file has ${act.ioNames.length ? act.ioNames.map(n => `@io.${n}`).join(", ") : "none"}`);
        }
        if (exp.notify && !act.notify)
        {
            notes.push("expected @io.notify");
        }

        // default.
        let wrongDefault = false;
        let info = false;
        const schemaHasConcreteDefault = exp.default.determinate && exp.default.source !== "canonical";
        if (!act.default.determinate)
        {
            info = true;
            notes.push("file default indeterminate (not compared)");
        }
        else if (schemaHasConcreteDefault)
        {
            if (!defaultsEqual(exp.default.value, act.default.value))
            {
                wrongDefault = true;
                notes.push(`wrong-default: schema ${formatValue(exp.default.value)} vs file ${formatValue(act.default.value)}`);
            }
        }
        else if (exp.default.determinate && !defaultsEqual(exp.default.value, act.default.value))
        {
            // Schema gave no concrete default; the file diverges from the canonical type default.
            info = true;
            notes.push(`schema default unspecified; file ${formatValue(act.default.value)} differs from canonical ${formatValue(exp.default.value)}`);
        }
        // Member-path / other derivation notes are informational, not drift.
        if ((exp.notes || []).some(note => note.includes("unresolved member path"))) info = true;

        // Resolve severity/symbol.
        if (missingIo)
        {
            severity = strictIo ? "error" : "warning";
        }
        if (wrongDefault)
        {
            severity = (strictDefaults ? "error" : (severity === "error" ? "error" : "warning"));
        }
        if (severity === "ok" && info) severity = "info";

        const symbol = severity === "error" ? "cross" : severity === "warning" ? "warn" : severity === "info" ? "info" : "ok";
        verdict = "match";

        results.push({
            name, verdict, severity, symbol,
            missingIo, wrongDefault, info,
            notes,
            expected: exportExpected(exp),
            actual: exportActual(act)
        });
    }

    const summary = summarize(results);
    return {
        class: meta.className || parsed.className || null,
        family: meta.family || null,
        shapeHash: meta.shapeHash || null,
        fields: results,
        summary,
        fallback: null
    };
}

function makeExtraResult(field, allowExtra, strict)
{
    const severity = allowExtra && !strict ? "warning" : "error";
    return {
        name: field.name,
        verdict: "extra-in-file",
        severity,
        symbol: severity === "error" ? "cross" : "warn",
        notes: [`field not in schema (line ${field.line})`],
        expected: null,
        actual: exportActual(field)
    };
}

function addClassPolicyResults(results, meta, parsed, options = {})
{
    const requiredFamily = options.runtimeFamily || meta.runtimeFamily || meta.family || null;
    const allowSourceProven = options.sourceProven === undefined ? !parsed.generated : Boolean(options.sourceProven);

    const expectedBase = options.runtimeBaseClass || options.extendsClass || "CjsModel";
    if (meta.className && parsed.base !== expectedBase && !allowSourceProven)
    {
        results.push({
            name: "<class>",
            verdict: "class-policy",
            severity: "error",
            symbol: "cross",
            notes: [`schema-backed class must extend ${expectedBase}; found ${parsed.base || "no base class"}`],
            expected: { base: expectedBase, family: requiredFamily },
            actual: { base: parsed.base || null, family: parsed.define?.family || null }
        });
    }

    if (requiredFamily && parsed.define?.family !== requiredFamily)
    {
        results.push({
            name: "<class>",
            verdict: "class-policy",
            severity: "error",
            symbol: "cross",
            notes: [`@type.define family must be "${requiredFamily}"; found ${parsed.define?.family || "no family"}`],
            expected: { base: expectedBase, family: requiredFamily },
            actual: { base: parsed.base || null, family: parsed.define?.family || null }
        });
    }
}

function exportExpected(exp)
{
    return {
        type: exp.kind,
        typeArg: exp.typeArg,
        enumType: exp.enumType,
        io: exp.io,
        notify: exp.notify,
        default: exp.default.determinate ? exp.default.value : null,
        defaultDeterminate: exp.default.determinate,
        member: exp.member,
        cppType: exp.cppType,
        flags: exp.flags
    };
}

function exportActual(field)
{
    return {
        type: field.kind,
        typeArg: field.typeArg,
        enumArg: field.enumArg,
        io: field.ioNames.length ? field.ioNames.join("+") : null,
        notify: field.notify,
        default: field.default.determinate ? field.default.value : null,
        defaultDeterminate: field.default.determinate,
        line: field.line
    };
}

function summarize(results)
{
    const summary = {
        match: 0,
        typeMismatch: 0,
        missingInFile: 0,
        extraInFile: 0,
        missingIoFlag: 0,
        wrongDefault: 0,
        classPolicy: 0,
        info: 0,
        drift: false
    };
    for (const result of results)
    {
        if (result.verdict === "type-mismatch") summary.typeMismatch++;
        else if (result.verdict === "missing-in-file") summary.missingInFile++;
        else if (result.verdict === "extra-in-file") summary.extraInFile++;
        else if (result.verdict === "class-policy") summary.classPolicy++;
        else if (result.verdict === "match")
        {
            if (result.missingIo) summary.missingIoFlag++;
            if (result.wrongDefault) summary.wrongDefault++;
            if (result.info) summary.info++;
            if (!result.missingIo && !result.wrongDefault && !result.info) summary.match++;
        }
        if (result.severity === "error") summary.drift = true;
    }
    return summary;
}

function formatValue(value)
{
    if (Array.isArray(value)) return `[${value.join(",")}]`;
    if (value && typeof value === "object" && value.__container) return `new ${value.__container === "map" ? "Map" : "Set"}()`;
    if (value && typeof value === "object" && value.__factory) return `new ${value.__factory}()`;
    return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

const SYMBOLS = {
    ascii: { ok: "OK", warn: "!!", cross: "XX", info: "~~" },
    unicode: { ok: "✔", warn: "⚠", cross: "✖", info: "~" }
};

export function renderReport(result, options = {})
{
    if (options.json)
    {
        return JSON.stringify(buildJsonReport(result), null, 2);
    }
    return renderHumanReport(result, options);
}

export function buildJsonReport(result)
{
    return {
        tool: "carbon-class",
        mode: "check",
        schemaVersion: 1,
        class: result.class,
        family: result.family,
        schemaPath: result.schemaPath || null,
        filePath: result.filePath || null,
        shapeHash: result.shapeHash || null,
        fields: result.fields.map(field => ({
            name: field.name,
            verdict: field.verdict,
            severity: field.severity,
            expected: field.expected,
            actual: field.actual,
            notes: field.notes || []
        })),
        summary: result.summary,
        fallback: result.fallback || null
    };
}

function renderHumanReport(result, options = {})
{
    const sym = options.ascii ? SYMBOLS.ascii : SYMBOLS.unicode;
    const lines = [];
    lines.push(`carbon-class check ${result.class}`);
    if (result.schemaPath)
    {
        lines.push(`  schema: ${result.schemaPath}${result.family ? ` (family ${result.family})` : ""}${result.shapeHash ? ` shapeHash ${shortHash(result.shapeHash)}` : ""}`);
    }
    if (result.filePath)
    {
        lines.push(`  file:   ${result.filePath}`);
    }
    lines.push("");

    if (result.fallback)
    {
        lines.push(`  ${sym.warn} schema carries no field detail — field-level check skipped; recorded shapeHash ${result.shapeHash ? shortHash(result.shapeHash) : "n/a"} (re-run when schema is enriched)`);
        if (result.fields.length)
        {
            lines.push("");
            for (const field of result.fields)
            {
                lines.push(renderFieldLine(field, sym));
            }
        }
        lines.push("");
        lines.push(`  summary: ${summaryLine(result.summary)}`);
        lines.push(`  result: ${result.summary.drift ? "DRIFT" : "OK (fallback)"}`);
        return lines.join("\n");
    }

    for (const field of result.fields)
    {
        lines.push(renderFieldLine(field, sym));
    }
    lines.push("");
    lines.push(`  summary: ${summaryLine(result.summary)}`);
    lines.push(`  result: ${result.summary.drift ? "DRIFT" : "OK"}`);
    return lines.join("\n");
}

function renderFieldLine(field, sym)
{
    const symbol = sym[field.symbol] || sym.info;
    const namePad = field.name.padEnd(14);
    const detail = renderFieldDetail(field);
    return `  ${symbol} ${namePad} ${detail}`;
}

function renderFieldDetail(field)
{
    if (field.verdict === "match" && field.expected)
    {
        const parts = [`type.${field.expected.type}`];
        if (field.expected.io) parts.push(`io:${field.expected.io}`);
        if (field.expected.defaultDeterminate) parts.push(`default ${formatValue(field.expected.default)}`);
        const base = parts.join("  ");
        return field.notes && field.notes.length ? `${base}  - ${field.notes.join("; ")}` : base;
    }
    return `${field.verdict}: ${(field.notes || []).join("; ")}`;
}

function summaryLine(summary)
{
    return [
        `${summary.match} match`,
        `${summary.typeMismatch} type-mismatch`,
        `${summary.missingInFile} missing-in-file`,
        `${summary.extraInFile} extra-in-file`,
        `${summary.missingIoFlag} missing-io-flag`,
        `${summary.wrongDefault} wrong-default`,
        `${summary.classPolicy} class-policy`,
        `${summary.info} info`
    ].join(", ");
}

function shortHash(hash)
{
    const value = String(hash).replace(/^sha256:/, "");
    return `${value.slice(0, 8)}...`;
}

// ---------------------------------------------------------------------------
// Class emission
// ---------------------------------------------------------------------------

// Math kinds render as core-math factory calls with a local Float32Array type alias.
// `color` reuses the vec4 factory/type. Project rule: vector/matrix/quaternion/color
// values use @carbonenginejs/core-math, never raw arrays or shared mutable constants.
const MATH_EMIT = {
    vec2: { ns: "vec2", type: "Vec2" },
    vec3: { ns: "vec3", type: "Vec3" },
    vec4: { ns: "vec4", type: "Vec4" },
    color: { ns: "vec4", type: "Vec4" },
    quat: { ns: "quat", type: "Quat" },
    mat3: { ns: "mat3", type: "Mat3" },
    mat4: { ns: "mat4", type: "Mat4" }
};

function arraysEqualNums(a, b)
{
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function defaultBaseImportFor(baseClass, isJs)
{
    return `./${baseClass}${isJs ? ".js" : ""}`;
}

function resolveRuntimeBase(options, isJs)
{
    const baseClass = options.extendsClass || options.runtimeBaseClass || "CjsModel";
    if (baseClass === "CjsModel")
    {
        return {
            className: baseClass,
            importPath: null
        };
    }

    if (options.extendsImport)
    {
        return {
            className: baseClass,
            importPath: options.extendsImport
        };
    }

    if (typeof options.extendsImportFor === "function")
    {
        const importPath = options.extendsImportFor(baseClass);
        if (!importPath)
        {
            return {
                className: "CjsModel",
                importPath: null
            };
        }
        return {
            className: baseClass,
            importPath
        };
    }

    return {
        className: baseClass,
        importPath: defaultBaseImportFor(baseClass, isJs)
    };
}

/**
 * Render a source-shaped class file from derived expected fields.
 * options: { js, doc, sourceRefs }
 */
export function renderClassFile(expected, options = {})
{
    const meta = expected.meta || {};
    const doc = options.doc || {};
    const isJs = Boolean(options.js);
    const className = meta.className;
    const family = meta.family || doc.family || "unknown";
    const runtimeBase = resolveRuntimeBase(options, isJs);
    const baseClass = runtimeBase.className;
    const baseImport = runtimeBase.importPath;
    const fields = expected.fields || [];
    const methods = expected.methods || [];

    const usesIo = fields.some(field => field.io || field.notify);
    const usesEnum = fields.some(field => field.enumType);
    const usesMethods = methods.length > 0;

    // Enums routed to an external package (e.g. runtime-const) are imported and
    // aliased as class statics rather than inlined, so a single source owns the
    // vocabulary. Map: enumName -> { import: <exportName>, from: <subpath> }.
    const enumImportMap = options.enumImportMap || {};
    const ownedEnumNames = new Set((meta.ownedEnums || []).map(entry => entry.name));
    const importedEnumNames = [];
    const seenImportedEnum = new Set();
    for (const field of fields)
    {
        const enumName = field.enumType;
        if (!enumName || ownedEnumNames.has(enumName) || seenImportedEnum.has(enumName)) continue;
        if (Object.prototype.hasOwnProperty.call(enumImportMap, enumName))
        {
            seenImportedEnum.add(enumName);
            importedEnumNames.push(enumName);
        }
    }

    const importNames = ["type"];
    if (usesMethods) importNames.push("carbon", "impl");
    if (usesIo) importNames.push("io");
    if (usesEnum) importNames.push("schema");
    importNames.sort();

    // Math fields use @carbonenginejs/core-math factories; their value types come from
    // @carbonenginejs/core-math/types (shared, not re-declared per generated file).
    const mathNs = new Set();
    const mathTypes = new Set();
    const factoryTypes = new Set();
    for (const field of fields)
    {
        const emit = MATH_EMIT[field.kind] || (field.kind === "array" ? MATH_EMIT[field.typeArg] : null);
        if (emit) { mathNs.add(emit.ns); mathTypes.add(emit.type); }
        if (field.default?.value?.__factory) factoryTypes.add(field.default.value.__factory);
    }

    const lines = [];
    const headerRef = resolveSourceHeader(doc);
    if (headerRef)
    {
        lines.push("// Ported from CarbonEngine (MIT, (c) 2026 CCP Games) - https://github.com/carbonengine/trinity");
        lines.push(`//   ${headerRef}`);
    }
    lines.push(`// Generated by format-carbon carbon-class --emit. Verify against ${family}/${className}.json.`);
    lines.push(`import { ${importNames.join(", ")} } from "@carbonenginejs/core-types/schema";`);
    if (baseImport)
    {
        lines.push(`import { ${baseClass} } from "${baseImport}";`);
    }
    else
    {
        lines.push(`import { ${baseClass} } from "@carbonenginejs/core-types/model";`);
    }
    for (const factoryType of [...factoryTypes].sort())
    {
        if (factoryType === baseClass && baseImport) continue;
        lines.push(`import { ${factoryType} } from "./${factoryType}${isJs ? ".js" : ""}";`);
    }
    for (const ns of [...mathNs].sort())
    {
        lines.push(`import { ${ns} } from "@carbonenginejs/core-math/${ns}";`);
    }
    if (!isJs && mathTypes.size)
    {
        lines.push(`import type { ${[...mathTypes].sort().join(", ")} } from "@carbonenginejs/core-math/types";`);
    }
    if (importedEnumNames.length)
    {
        const bySource = new Map();
        for (const enumName of importedEnumNames)
        {
            const { import: exportName, from } = enumImportMap[enumName];
            if (!bySource.has(from)) bySource.set(from, new Set());
            bySource.get(from).add(exportName);
        }
        for (const from of [...bySource.keys()].sort())
        {
            const names = [...bySource.get(from)].sort().join(", ");
            lines.push(`import { ${names} } from "${from}";`);
        }
    }
    lines.push("");
    lines.push(`/** ${className} (${family}) - generated${meta.shapeHash ? ` from schema shapeHash ${shortHash(meta.shapeHash)}` : ""}. */`);
    lines.push(`@type.define({ className: "${className}", family: "${family}" })`);
    lines.push(`export class ${className} extends ${baseClass}`);
    lines.push("{");
    lines.push("");

    fields.forEach((field, index) =>
    {
        if (index > 0) lines.push("");
        lines.push(`  /** ${field.member || field.name} (${field.cppType || field.kind}${field.enumType ? ` - enum ${field.enumType}` : ""})${field.flags.length ? ` [${field.flags.join(", ")}]` : ""} */`);
        if (field.notify) lines.push("  @io.notify");
        if (field.io) lines.push(`  @io.${field.io}`);
        lines.push(`  @type.${renderTypeDecorator(field)}`);
        if (field.enumType) lines.push(`  @schema.enum("${field.enumType}")`);
        lines.push(`  ${renderFieldDecl(field, isJs)}`);
    });

    if (fields.length && methods.length) lines.push("");

    methods.forEach((method, index) =>
    {
        if (index > 0) lines.push("");
        lines.push(`  ${renderMethodComment(method)}`);
        lines.push("  @carbon.method");
        lines.push("  @impl.notImplemented");
        lines.push(`  ${renderMethodDecl(method, isJs)}`);
        lines.push("  {");
        lines.push(`    throw new Error("${className}.${method.name} is not implemented in CarbonEngineJS.");`);
        lines.push("  }");
    });

    const ownedEnums = Array.isArray(meta.ownedEnums) ? meta.ownedEnums : [];
    ownedEnums.forEach((entry, index) =>
    {
        if (fields.length || methods.length || index > 0) lines.push("");
        lines.push(`  static ${entry.name} = Object.freeze({`);
        for (const member of entry.values || [])
        {
            lines.push(`    ${member.name}: ${renderEnumValue(member.value)},`);
        }
        lines.push("  });");
    });

    // Shared enums the fields reference without owning: stamped as class
    // statics so @schema.enum("X") always resolves via `Constructor[X]`.
    // Import-routed enums are excluded here and aliased from the import below.
    const referencedEnums = (Array.isArray(meta.referencedEnums) ? meta.referencedEnums : [])
        .filter(entry => !seenImportedEnum.has(entry.name));
    referencedEnums.forEach((entry, index) =>
    {
        if (fields.length || methods.length || ownedEnums.length || index > 0) lines.push("");
        lines.push(`  static ${entry.name} = Object.freeze({`);
        for (const member of entry.values || [])
        {
            lines.push(`    ${member.name}: ${renderEnumValue(member.value)},`);
        }
        lines.push("  });");
    });

    // Import-routed enum statics: alias the class-static name (the @schema.enum
    // key) to the imported vocabulary object.
    importedEnumNames.forEach((enumName, index) =>
    {
        if (fields.length || methods.length || ownedEnums.length || referencedEnums.length || index > 0) lines.push("");
        lines.push(`  static ${enumName} = ${enumImportMap[enumName].import};`);
    });

    lines.push("");
    lines.push("}");
    lines.push("");
    return lines.join("\n");
}

function renderMethodComment(method)
{
    const target = method.target && method.target !== method.name ? ` -> ${method.target}` : "";
    const macro = method.macro ? ` (${method.macro})` : "";
    return `/** Carbon method ${method.name}${target}${macro}. */`;
}

function renderMethodDecl(method, isJs)
{
    const annotation = isJs ? "" : ": unknown[]";
    const returnType = isJs ? "" : ": never";
    return `${methodPropertyName(method.name)}(...args${annotation})${returnType}`;
}

function renderEnumValue(value)
{
    return typeof value === "number" ? String(value) : JSON.stringify(value);
}

/**
 * Render enum declarations from schema enum entries. TypeScript mode emits a
 * literal-typed `interface XEnum`, a value-union `type XValue`, and a frozen `const X`.
 * JavaScript mode emits only the frozen `const X` value object.
 * Matches the runtime enum convention (see runtime-trinity/src/curves/enums.ts).
 */
export function renderEnums(enums, options = {})
{
    // Class-owned enums are emitted by renderClassFile as class statics. This
    // standalone surface is only for genuinely shared/unowned vocabularies.
    const list = (enums || []).filter(entry =>
        entry && entry.name && !entry.ownerClass && Array.isArray(entry.values)
    );
    const seenNames = new Set();
    for (const entry of list)
    {
        if (seenNames.has(entry.name))
        {
            const error = new Error(`cannot emit ambiguous standalone enum ${entry.name}`);
            error.code = "duplicate-enum-export";
            throw error;
        }
        seenNames.add(entry.name);
    }
    const isJs = Boolean(options.js);
    const lines = [];
    if (options.header !== false)
    {
        lines.push("// Generated by format-carbon carbon-class --emit-enums from schema enums.json.");
        lines.push("");
    }
    list.forEach((entry, index) =>
    {
        if (index > 0) lines.push("");
        const name = entry.name;
        const members = entry.values;
        if (!isJs)
        {
            lines.push(`export interface ${name}Enum`);
            lines.push("{");
            for (const member of members) lines.push(`  readonly ${member.name}: ${renderEnumValue(member.value)};`);
            lines.push("}");
            lines.push("");
            lines.push(`export type ${name}Value = ${name}Enum[keyof ${name}Enum];`);
            lines.push("");
        }
        lines.push(`export const ${name}${isJs ? "" : `: ${name}Enum`} = Object.freeze({`);
        for (const member of members) lines.push(`  ${member.name}: ${renderEnumValue(member.value)},`);
        lines.push("});");
    });
    lines.push("");
    return lines.join("\n");
}

function renderTypeDecorator(field)
{
    if (field.kind === "model" || field.kind === "objectRef" || field.kind === "struct" || field.kind === "rawStruct")
    {
        return `${field.kind}("${field.typeArg || field.cppType || "unknown"}")`;
    }
    if (field.kind === "list" || field.kind === "array" || field.kind === "set")
    {
        return `${field.kind}("${field.typeArg || "unknown"}")`;
    }
    if (field.kind === "map")
    {
        return `map("${field.typeArg || "unknown"}")`;
    }
    if (field.kind === "typedArray")
    {
        return `typedArray("${field.typeArg || "Uint8Array"}")`;
    }
    return field.kind;
}

function renderFieldDecl(field, isJs)
{
    const value = field.default.determinate ? field.default.value : canonicalDefault(field.kind);
    const literal = field.kind === "array" && MATH_EMIT[field.typeArg] && Array.isArray(value)
        ? `[${value.map(item => renderLiteral(item, field.typeArg)).join(", ")}]`
        : renderLiteral(value, field.kind);
    let annotation = renderFieldAnnotation(field, isJs);
    return `${fieldPropertyName(field.name)}${annotation} = ${literal};`;
}

function renderFieldAnnotation(field, isJs)
{
    if (isJs) return "";

    const mathEmit = MATH_EMIT[field.kind];
    if (mathEmit)
    {
        return `: ${mathEmit.type}`;
    }
    if (field.kind === "map")
    {
        return ": Map<string, unknown>";
    }
    if (field.kind === "set")
    {
        return `: Set<${renderSetElementType(field.typeArg || field.cppType)}>`;
    }
    return "";
}

function renderSetElementType(typeArg)
{
    const type = normalizeCppTypeName(typeArg || "");
    switch (type)
    {
        case "bool": return "boolean";
        case "std::string":
        case "std::wstring":
        case "BlueSharedString":
        case "BlueSharedStringW":
            return "string";
        case "char":
        case "int8_t":
        case "uint8_t":
        case "byte":
        case "int16_t":
        case "short":
        case "uint16_t":
        case "ushort":
        case "int":
        case "int32_t":
        case "long":
        case "uint":
        case "uint32_t":
        case "ulong":
        case "int64_t":
        case "longlong":
        case "uint64_t":
        case "size_t":
        case "ulonglong":
        case "float":
        case "double":
            return "number";
        default:
            return "unknown";
    }
}

function fieldPropertyName(name)
{
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `[${JSON.stringify(name)}]`;
}

function methodPropertyName(name)
{
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function renderLiteral(value, kind)
{
    const mathEmit = MATH_EMIT[kind];
    if (mathEmit)
    {
        const def = HELPER_CREATE_DEFAULT[mathEmit.ns];
        // Fresh per-instance value; create() for zero/identity defaults, else fromValues(...).
        if (!Array.isArray(value) || arraysEqualNums(value, def)) return `${mathEmit.ns}.create()`;
        if (kind === "color" && arraysEqualNums(value, [0, 0, 0, 1])) return "vec4.createLinear()";
        return `${mathEmit.ns}.fromValues(${value.join(", ")})`;
    }
    if (value && typeof value === "object" && value.__container)
    {
        return value.__container === "map" ? "new Map()" : "new Set()";
    }
    if (value && typeof value === "object" && value.__factory)
    {
        return `new ${value.__factory}()`;
    }
    if (Array.isArray(value)) return `[${value.join(", ")}]`;
    if (value === null || value === undefined)
    {
        if (kind === "list" || kind === "array") return "[]";
        return "null";
    }
    return JSON.stringify(value);
}

function resolveSourceHeader(doc)
{
    if (!doc || !doc.source || !doc.sourceRefs) return null;
    const ref = (doc.source.header || [])[0];
    return ref ? doc.sourceRefs[ref] || null : null;
}
