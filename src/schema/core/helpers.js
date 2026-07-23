import fs from "node:fs";
import path from "node:path";

import {
    BLACK_DEFINITIONS_SCHEMA_NAME,
    BLACK_DEFINITIONS_SCHEMA_VERSION,
    CLASS_KEYS,
    SCHEMA_NAME,
    SCHEMA_VERSION
} from "./schema.js";
import { DEFAULT_FIELD_RESOLUTIONS } from "./schemaFieldResolutions.js";

export const OUTPUT_JSON = "json";
export const OUTPUT_RAW = "raw";

export const DEFAULT_VALUES = Object.freeze({
    emit: OUTPUT_JSON,
    fieldResolutions: null,
    schema: null,
    strictSchema: false,
    version: SCHEMA_VERSION,
    classes: Object.freeze({})
});

const OPTION_KEYS = new Set([ "emit", "fieldResolutions", "schema", "strictSchema", "version", "classes" ]);
const SOURCE_MEMBER_DEFAULT_OVERRIDES = Object.freeze({
    // EveSOFDataPatternLayerProperties initializes every applicable-area slot
    // with memset(..., 1, TYPE_MAX * sizeof(bool)) in EveSOFData.cpp.
    "EveSOFDataPatternLayerProperties.m_applicableAreas": Object.freeze({
        value: "true"
    })
});

// EveChildInheritProperties_Blue.cpp exposes the faction color array through
// COLOR_DEFINE. The Blue scanner currently retains only the macro body
// ("#_Color" / "TYPE_##_COLOR"), which is not a real public field. Expand the
// source-defined calls here, ordered by SOFDataFactionColorChooser::ColorType in
// EveSOFData.h rather than by their call order in the Blue source.
const EVE_CHILD_INHERIT_COLOR_ATTRIBUTES = Object.freeze([
    [ "Primary", "PRIMARY" ],
    [ "Secondary", "SECONDARY" ],
    [ "Tertiary", "TERTIARY" ],
    [ "Black", "BLACK" ],
    [ "White", "WHITE" ],
    [ "Yellow", "YELLOW" ],
    [ "Orange", "ORANGE" ],
    [ "Red", "RED" ],
    [ "Blue", "BLUE" ],
    [ "Green", "GREEN" ],
    [ "Cyan", "CYAN" ],
    [ "Fire", "FIRE" ],
    [ "Hull", "HULL" ],
    [ "Glass", "GLASS" ],
    [ "Reactor", "REACTOR" ],
    [ "Darkhull", "DARKHULL" ],
    [ "Booster", "BOOSTER" ],
    [ "Killmark", "KILLMARK" ],
    [ "PrimaryLight", "PRIMARY_LIGHT" ],
    [ "SecondaryLight", "SECONDARY_LIGHT" ],
    [ "TertiaryLight", "TERTIARY_LIGHT" ],
    [ "WhiteLight", "WHITE_LIGHT" ],
    [ "PrimaryHologram", "PRIMARY_HOLOGRAM" ],
    [ "SecondaryHologram", "SECONDARY_HOLOGRAM" ],
    [ "TertiaryHologram", "TERTIARY_HOLOGRAM" ],
    [ "State0", "STATE_0" ],
    [ "State1", "STATE_1" ],
    [ "State2", "STATE_2" ],
    [ "State3", "STATE_3" ],
    [ "StateVulnerable", "STATE_VULNERABLE" ],
    [ "StateInvulnerable", "STATE_INVULNERABLE" ],
    [ "PrimaryForcefield", "PRIMARY_FORCEFIELD" ],
    [ "SecondaryForcefield", "SECONDARY_FORCEFIELD" ],
    [ "PrimaryBanner", "PRIMARY_BANNER" ],
    [ "PrimaryFx", "PRIMARY_FX" ],
    [ "SecondaryFx", "SECONDARY_FX" ],
    [ "PrimarySpotlight", "PRIMARY_SPOTLIGHT" ],
    [ "SecondarySpotlight", "SECONDARY_SPOTLIGHT" ],
    [ "TertiarySpotlight", "TERTIARY_SPOTLIGHT" ],
    [ "PrimaryBillboard", "PRIMARY_BILLBOARD" ],
    [ "PrimaryWarpFx", "PRIMARY_WARP_FX" ],
    [ "PrimaryAttackFx", "PRIMARY_ATTACK_FX" ],
    [ "PrimarySiegeFx", "PRIMARY_SIEGE_FX" ],
    [ "PrimaryDockedFx", "PRIMARY_DOCKED_FX" ]
].map(([ name, token ]) => Object.freeze({
    name,
    token,
    member: `m_colorSet[TYPE_${token}]`
})));

function sourceBackedAttributes(classInfo)
{
    const attributes = Array.isArray(classInfo.blue?.attributes)
        ? classInfo.blue.attributes
        : [];
    if (classInfoName(classInfo) !== "EveChildInheritProperties") return attributes;

    const isColorAttribute = attribute =>
    {
        const member = String(attribute?.member || "").replace(/\s+/g, "");
        return attribute?.nameExpression === "#_Color" ||
            member === "m_colorSet[TYPE_##_COLOR]" ||
            /^m_colorSet\[TYPE_[A-Z0-9_]+\]$/.test(member);
    };
    const colorAttributes = attributes.filter(isColorAttribute);
    if (colorAttributes.length === 0) return attributes;

    const byMember = new Map(colorAttributes.map(attribute => [
        String(attribute.member || "").replace(/\s+/g, ""),
        attribute
    ]));
    const template = colorAttributes[0] || {};
    const expanded = EVE_CHILD_INHERIT_COLOR_ATTRIBUTES.map(({ name, member }) => ({
        ...template,
        ...(byMember.get(member) || {}),
        macro: "MAP_ATTRIBUTE",
        name,
        nameExpression: null,
        nameSource: "literal",
        nameChooser: null,
        member,
        flags: [ "READ" ],
        description: ":jessica-group:SOF Faction Glow Colors",
        chooser: null,
        iid: null
    }));

    return [
        ...attributes.filter(attribute => !isColorAttribute(attribute)),
        ...expanded
    ];
}

function hasOwn(value, key)
{
    return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeEmit(emit, readerName)
{
    if (emit === undefined || emit === OUTPUT_JSON) return OUTPUT_JSON;
    if (emit === OUTPUT_RAW) return OUTPUT_RAW;
    throw new Error(`${readerName} unknown emit value "${emit}"`);
}

function normalizeVersion(version, readerName)
{
    const number = version === undefined ? SCHEMA_VERSION : Number(version);
    if (!Number.isInteger(number))
    {
        throw new TypeError(`${readerName} schema version must be an integer`);
    }

    if (number !== SCHEMA_VERSION)
    {
        throw new Error(`${readerName} unsupported schema version ${number}; current schema version is ${SCHEMA_VERSION}`);
    }

    return number;
}

function normalizeBoolean(value, option, readerName)
{
    if (typeof value !== "boolean")
    {
        throw new TypeError(`${readerName} ${option} option must be a boolean`);
    }
    return value;
}

function normalizeFieldResolutions(value, readerName)
{
    if (value === null || value === undefined) return null;
    if (typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError(`${readerName} fieldResolutions option must be an object`);
    }
    return value;
}

function assertKnownOptions(options, readerName)
{
    for (const key of Object.keys(options))
    {
        if (!OPTION_KEYS.has(key))
        {
            throw new TypeError(`${readerName} unknown option "${key}"`);
        }
    }
}

function classMap(values)
{
    return values && values.classes ? values.classes : {};
}

function cloneValues(values)
{
    return {
        emit: values.emit,
        fieldResolutions: values.fieldResolutions ?? null,
        schema: values.schema ?? null,
        strictSchema: Boolean(values.strictSchema),
        version: normalizeVersion(values.version, "CjsFormatCarbon"),
        classes: { ...classMap(values) }
    };
}

export function validateClassKey(classKeys, key, readerName)
{
    if (!classKeys.includes(key))
    {
        throw new Error(`${readerName} unknown class type "${String(key)}"`);
    }
}

export function validateClass(classKeys, type, Class, readerName)
{
    validateClassKey(classKeys, type, readerName);
    if (typeof Class !== "function")
    {
        throw new TypeError(`${readerName} class "${type}" must be a constructor`);
    }
}

function mergeClasses(values, classes, classKeys, readerName)
{
    if (!classes || typeof classes !== "object")
    {
        throw new TypeError(`${readerName} classes option must be an object`);
    }

    const next = { ...values.classes };
    for (const [ type, Class ] of Object.entries(classes))
    {
        validateClass(classKeys, type, Class, readerName);
        next[type] = Class;
    }
    values.classes = next;
}

export function normalizeValues(base, options, classKeys, readerName)
{
    if (!options || typeof options !== "object")
    {
        throw new TypeError(`${readerName} options must be an object`);
    }

    assertKnownOptions(options, readerName);

    const values = cloneValues(base);
    if (hasOwn(options, "emit")) values.emit = normalizeEmit(options.emit, readerName);
    if (hasOwn(options, "fieldResolutions")) values.fieldResolutions = normalizeFieldResolutions(options.fieldResolutions, readerName);
    if (hasOwn(options, "schema")) values.schema = options.schema ?? null;
    if (hasOwn(options, "strictSchema")) values.strictSchema = normalizeBoolean(options.strictSchema, "strictSchema", readerName);
    if (hasOwn(options, "version")) values.version = normalizeVersion(options.version, readerName);
    if (hasOwn(options, "classes")) mergeClasses(values, options.classes, classKeys, readerName);
    return values;
}

function toBytes(input)
{
    if (input instanceof ArrayBuffer)
    {
        return new Uint8Array(input);
    }

    if (ArrayBuffer.isView(input))
    {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }

    return null;
}

function readInput(input, readerName)
{
    if (typeof input === "string")
    {
        const trimmed = input.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("["))
        {
            return parseJson(input, readerName);
        }

        if (fs.existsSync(input))
        {
            if (fs.statSync(input).isDirectory())
            {
                return readSchemaTree(input, readerName);
            }

            return parseJson(fs.readFileSync(input, "utf8"), readerName);
        }

        return parseJson(input, readerName);
    }

    const bytes = toBytes(input);
    if (bytes)
    {
        return parseJson(new TextDecoder().decode(bytes), readerName);
    }

    if (input && typeof input === "object")
    {
        return toJsonValue(input);
    }

    throw new TypeError(`${readerName} input must be an object, JSON text, or UTF-8 bytes`);
}

function parseJson(text, readerName)
{
    try
    {
        return JSON.parse(text);
    }
    catch (error)
    {
        throw new SyntaxError(`${readerName} only accepts JSON schema input in this build-tool package: ${error.message}`);
    }
}

function readJsonFile(file, readerName)
{
    return parseJson(fs.readFileSync(file, "utf8"), readerName);
}

function readSchemaTree(inputRoot, readerName)
{
    const
        root = path.resolve(inputRoot),
        indexPath = path.join(root, "index.json");

    if (!fs.existsSync(indexPath))
    {
        throw new Error(`${readerName} schema directory is missing index.json: ${inputRoot}`);
    }

    const index = readJsonFile(indexPath, readerName);
    if (!isRootIndex(index))
    {
        throw new TypeError(`${readerName} schema directory index.json is not a root schema index`);
    }

    const
        enumsPath = path.join(root, "enums.json"),
        enums = fs.existsSync(enumsPath)
            ? readJsonFile(enumsPath, readerName)
            : {
                schemaVersion: index.schemaVersion,
                generatedAt: index.generatedAt || null,
                carbonRoot: index.carbonRoot || null,
                enums: []
            },
        families = [];

    for (const familyRef of index.families || [])
    {
        const
            familyName = familyRef.name,
            familyIndexPath = resolveSchemaFile(root, familyRef.index || path.join(familyName, "index.json"), readerName),
            familyIndex = readJsonFile(familyIndexPath, readerName),
            familyRoot = path.dirname(familyIndexPath),
            classes = [];

        for (const classRef of familyIndex.classes || [])
        {
            const classFile = classRef.jsonFile || `${classRef.blueClass || classRef.cppClass || classRef.className}.json`;
            const classPath = assertSchemaFileInside(root, path.resolve(familyRoot, classFile), readerName);
            classes.push(readJsonFile(classPath, readerName));
        }

        families.push({
            schemaVersion: familyIndex.schemaVersion,
            generatedAt: familyIndex.generatedAt || index.generatedAt || null,
            name: familyIndex.family || familyName,
            root: familyIndex.root || familyRef.root || null,
            index: familyIndex,
            classes
        });
    }

    return {
        schema: SCHEMA_NAME,
        schemaVersion: index.schemaVersion,
        generatedAt: index.generatedAt || null,
        carbonRoot: index.carbonRoot || null,
        index,
        enums,
        families
    };
}

function resolveSchemaFile(root, relativePath, readerName)
{
    return assertSchemaFileInside(root, path.resolve(root, String(relativePath || "")), readerName);
}

function assertSchemaFileInside(root, file, readerName)
{
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    {
        throw new Error(`${readerName} schema path escapes the schema root: ${file}`);
    }
    return file;
}

function assertDocumentVersion(document, version, readerName)
{
    if (!document || typeof document !== "object")
    {
        throw new TypeError(`${readerName} schema document must be an object`);
    }

    if (!hasOwn(document, "schemaVersion"))
    {
        throw new Error(`${readerName} schema document is missing schemaVersion`);
    }

    const actual = normalizeVersion(document.schemaVersion, readerName);
    if (actual !== version)
    {
        throw new Error(`${readerName} schema version mismatch: expected ${version}, got ${actual}`);
    }
}

function documentKind(document)
{
    if (isSchemaBundle(document)) return "bundle";
    if (isScanReport(document)) return "scanReport";
    if (isEnumsDocument(document)) return "enums";
    if (isFamilyIndex(document)) return "familyIndex";
    if (isRootIndex(document)) return "rootIndex";
    if (isClassSchema(document)) return "class";
    return "unknown";
}

function isScanReport(document)
{
    return !!document &&
        typeof document === "object" &&
        Array.isArray(document.families) &&
        document.families.some(family => Array.isArray(family.classes) && family.classes.some(item => item && item.name));
}

function isSchemaBundle(document)
{
    return !!document &&
        typeof document === "object" &&
        document.schema === SCHEMA_NAME &&
        Array.isArray(document.families) &&
        document.index &&
        document.enums;
}

function isRootIndex(document)
{
    return !!document &&
        typeof document === "object" &&
        Array.isArray(document.families) &&
        hasOwn(document, "enums") &&
        !document.index &&
        !document.summary;
}

function isFamilyIndex(document)
{
    return !!document &&
        typeof document === "object" &&
        typeof document.family === "string" &&
        Array.isArray(document.classes) &&
        !document.blueClass;
}

function isEnumsDocument(document)
{
    return !!document &&
        typeof document === "object" &&
        Array.isArray(document.enums) &&
        !Array.isArray(document.families);
}

function isClassSchema(document)
{
    return !!document &&
        typeof document === "object" &&
        (typeof document.blueClass === "string" || typeof document.cppClass === "string") &&
        (Array.isArray(document.fields) || document.black || document.blue);
}

export function emitSchema(input, values, readerName)
{
    const document = readInput(input, readerName);
    const version = values.version;

    if (isScanReport(document))
    {
        return emitSchemaBundleFromReport(document, values, readerName);
    }

    if (isSchemaBundle(document))
    {
        assertDocumentVersion(document, version, readerName);
        const schema = normalizeSchemaBundle(document, version, readerName);
        if (values.strictSchema) assertNoSchemaResolutionIssues(schema, readerName);
        return schema;
    }

    if (isRootIndex(document) || isFamilyIndex(document) || isEnumsDocument(document) || isClassSchema(document))
    {
        assertDocumentVersion(document, version, readerName);
        const schema = normalizeSchemaDocument(document, version);
        if (values.strictSchema) assertNoSchemaResolutionIssues(schema, readerName);
        return schema;
    }

    throw new TypeError(`${readerName} input is not a Carbon Blue scan report or ${SCHEMA_NAME} v${version} schema document`);
}

function normalizeSchemaDocument(document, version)
{
    return {
        ...document,
        schemaVersion: version
    };
}

function normalizeSchemaBundle(bundle, version, readerName)
{
    assertDocumentVersion(bundle.index, version, readerName);
    assertDocumentVersion(bundle.enums, version, readerName);

    return {
        ...bundle,
        schema: SCHEMA_NAME,
        schemaVersion: version,
        index: normalizeSchemaDocument(bundle.index, version),
        enums: normalizeSchemaDocument(bundle.enums, version),
        families: bundle.families.map(family =>
        {
            assertDocumentVersion(family.index, version, readerName);
            return {
                ...family,
                schemaVersion: version,
                index: normalizeSchemaDocument(family.index, version),
                classes: (family.classes || []).map(item =>
                {
                    assertDocumentVersion(item, version, readerName);
                    return normalizeSchemaDocument(item, version);
                })
            };
        })
    };
}

function emitSchemaBundleFromReport(report, values, readerName)
{
    const
        version = values.version,
        generatedAt = report.generatedAt || null,
        carbonRoot = report.carbonRoot || null,
        enumNames = new Set((report.enums || []).map(item => item?.name).filter(Boolean)),
        families = [],
        rootIndex = {
            schemaVersion: version,
            generatedAt,
            carbonRoot,
            families: [],
            enums: Array.isArray(report.enums) ? report.enums.length : 0
        };

    // Embedded-struct roots may be declared in another family (the eve smart
    // lights map attributes through lights/LightData); nested-member resolution
    // consults this report-wide fallback when a root type is not family-local.
    const crossFamilyTypes = new Map();
    for (const family of report.families || [])
    {
        for (const classInfo of family.classes || [])
        {
            if (classInfo?.name && !crossFamilyTypes.has(classInfo.name)) crossFamilyTypes.set(classInfo.name, classInfo);
        }
    }

    for (const family of report.families || [])
    {
        const familyBundle = emitFamilyFromReport(family, generatedAt, version, enumNames, carbonRoot, values, crossFamilyTypes);
        families.push(familyBundle);
        rootIndex.families.push({
            name: familyBundle.name,
            root: familyBundle.root,
            index: `${familyBundle.name}/index.json`,
            classes: familyBundle.classes.length
        });
    }

    const bundle = {
        schema: SCHEMA_NAME,
        schemaVersion: version,
        generatedAt,
        carbonRoot,
        index: rootIndex,
        enums: {
            schemaVersion: version,
            generatedAt,
            carbonRoot,
            enums: Array.isArray(report.enums) ? report.enums : []
        },
        families
    };

    if (values.strictSchema) assertNoSchemaResolutionIssues(bundle, readerName);
    return bundle;
}

function schemaClassDocuments(schema)
{
    if (isClassSchema(schema)) return [ schema ];
    if (isSchemaBundle(schema))
    {
        return schema.families.flatMap(family => family.classes || []);
    }
    if (Array.isArray(schema?.classes))
    {
        return schema.classes.filter(isClassSchema);
    }
    return [];
}

function assertNoSchemaResolutionIssues(schema, readerName)
{
    const sortKey = issue => [ issue.family, issue.className, issue.blueName, issue.member, issue.type ]
        .map(value => String(value || ""))
        .join("\u0000");
    const issues = schemaClassDocuments(schema)
        .flatMap(doc => (doc.reviewNotes || [])
            .filter(note => note?.blocking)
            .map(note => ({
                family: doc.family || null,
                className: doc.blueClass || doc.cppClass || note.className || null,
                ...note
            })))
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    if (!issues.length) return;

    const details = issues.map(issue =>
        `${issue.family || "unknown"}/${issue.className || "unknown"}.${issue.blueName || issue.member || "unknown"}: ${issue.type}`
    );
    const error = new AggregateError(
        issues.map((issue, index) => Object.assign(new Error(details[index]), { issue })),
        `${readerName} schema resolution failed with ${issues.length} blocking issue${issues.length === 1 ? "" : "s"}:\n- ${details.join("\n- ")}`
    );
    error.code = "schema-resolution-failed";
    error.issues = issues;
    throw error;
}

function emitFamilyFromReport(family, generatedAt, version, enumNames, carbonRoot, values, crossFamilyTypes = null)
{
    const
        classInfos = (family.classes || []).filter(shouldEmitReportClass),
        classMap = new Map(classInfos.map(item => [ item.name, item ])),
        classes = [],
        index = {
            schemaVersion: version,
            generatedAt,
            family: family.name,
            root: family.root,
            classes: []
        };

    // Carried on the family map so nested-member resolution can reach
    // embedded-struct types declared in other families without changing how
    // parents and local fields resolve.
    classMap.crossFamilyTypes = crossFamilyTypes;

    for (const classInfo of classInfos)
    {
        const schema = renderClassSchema(classInfo, classMap, version, enumNames, carbonRoot, family.name, values);
        classes.push(schema);
        index.classes.push({
            blueClass: schema.blueClass,
            cppClass: schema.cppClass,
            jsonFile: `${schema.blueClass}.json`,
            blueExposed: !!schema.blue?.isExposed,
            reviewNotes: schema.reviewNotes.length,
            hashes: schema.hashes || {}
        });
    }

    return {
        schemaVersion: version,
        generatedAt,
        name: family.name,
        root: family.root,
        index,
        classes
    };
}

function shouldEmitReportClass(classInfo)
{
    if (!classInfo || typeof classInfo !== "object") return false;
    if (isBlueMacroTemplateClass(classInfo)) return false;

    const blue = classInfo.blue || {};
    if (hasItems(classInfo.headerFiles)) return true;
    if (hasItems(classInfo.fields)) return true;
    if (hasItems(classInfo.bases)) return true;
    if (hasItems(classInfo.reviewNotes)) return true;

    return !!blue.isExposed ||
        hasItems(blue.defines) ||
        hasItems(blue.exposures) ||
        hasItems(blue.attributes) ||
        hasItems(blue.properties) ||
        hasItems(blue.methods) ||
        hasItems(blue.interfaces);
}

function isBlueMacroTemplateClass(classInfo)
{
    const name = classInfoName(classInfo);
    if (!/^_[a-z][A-Za-z0-9_]*$/.test(String(name || ""))) return false;
    if (hasItems(classInfo.fields)) return false;

    const markers = [
        ...(classInfo.blue?.defines || []),
        ...(classInfo.blue?.exposures || [])
    ];
    return markers.length > 0 && markers.every(marker => marker?.name === name);
}

function hasItems(value)
{
    return Array.isArray(value) && value.length > 0;
}

const SOURCE_LINE_CACHE = new Map();

function renderClassSchema(classInfo, classMap, version, enumNames, carbonRoot = null, familyName = null, values = DEFAULT_VALUES)
{
    const sourceRefs = createSourceRefs();
    const reviewNotes = Array.isArray(classInfo.reviewNotes) ? [ ...classInfo.reviewNotes ] : [];
    const source = compactObject({
        header: toSourceRefList(sourceRefs, classInfo.headerFiles || []),
        cpp: toSourceRefList(sourceRefs, classInfo.cppFiles || []),
        blue: toSourceRefList(sourceRefs, classInfo.blue?.files || [])
    });
    const attributes = sourceBackedAttributes(classInfo)
        .filter(attr =>
        {
            if (isUnexpandedMacroTemplateAttribute(attr, carbonRoot))
            {
                reviewNotes.push({
                    type: "blue-attribute-macro-template",
                    blueName: attr?.name || null,
                    attributeExpression: attr?.nameExpression || null,
                    member: attr?.member || null,
                    source: attr?.source || null,
                    line: attr?.line || null
                });
                return false;
            }
            if (!isCommentedOutSourceLocation(attr?.source, attr?.line, carbonRoot)) return true;
            reviewNotes.push({
                type: "blue-attribute-commented-out",
                blueName: attr?.name || null,
                member: attr?.member || null,
                source: attr?.source || null,
                line: attr?.line || null
            });
            return false;
        })
        .map(attr => toAttributeSchema(classInfo, attr, reviewNotes, classMap, sourceRefs, enumNames, familyName, values))
        .filter(Boolean);

    return {
        schemaVersion: version,
        family: classInfo.family,
        blueClass: classInfo.name,
        cppClass: classInfo.name,
        sourceRefs: sourceRefs.toJSON(),
        bases: classInfo.bases || [],
        parents: toParentSchemas(classInfo, classMap),
        source,
        hashes: classInfo.hashes || {},
        blue: {
            isExposed: !!classInfo.blue?.isExposed,
            defines: (classInfo.blue?.defines || []).map(toBlueDefineSchema),
            exposures: (classInfo.blue?.exposures || []).map(toBlueExposureSchema),
            interfaces: (classInfo.blue?.interfaces || []).map(toBlueInterfaceSchema),
            // The Blue persistence parent (EXPOSURE_CHAINTO). Preserved as a
            // tri-state: name = chained, null = EXPOSURE_END, absent key =
            // legacy scan without chain capture.
            ...(classInfo.blue && Object.prototype.hasOwnProperty.call(classInfo.blue, "chainTo")
                ? { chainTo: classInfo.blue.chainTo ?? null }
                : {})
        },
        black: toBlackClassSchema(classInfo, attributes, version),
        fields: (classInfo.fields || []).map(field => toFieldSchema(classInfo, field)),
        attributes,
        properties: (classInfo.blue?.properties || []).map(prop => toPropertySchema(classInfo, prop, reviewNotes, classMap)),
        methods: (classInfo.blue?.methods || []).map(method =>
            toBlueMethodSchema(classInfo, method, classMap)),
        reviewNotes
    };
}

function isCommentedOutSourceLocation(sourceFile, line, carbonRoot)
{
    if (!sourceFile || !Number.isInteger(line) || line < 1) return false;

    const file = resolveSourceFilePath(sourceFile, carbonRoot);
    if (!file || !fs.existsSync(file)) return false;

    const lines = getSourceLines(file);

    const text = lines[line - 1] || "";
    return text.trimStart().startsWith("//");
}

function isUnexpandedMacroTemplateAttribute(attribute, carbonRoot)
{
    const sourceFile = attribute?.source;
    const line = attribute?.line;
    if (!sourceFile || !Number.isInteger(line) || line < 1) return false;

    const file = resolveSourceFilePath(sourceFile, carbonRoot);
    if (!file || !fs.existsSync(file)) return false;

    const lines = getSourceLines(file);
    let start = line - 1;
    while (start > 0 && /\\\s*$/.test(lines[start - 1] || "")) start--;

    const directive = lines[start] || "";
    const match = directive.match(/^\s*#\s*define\s+[A-Za-z_]\w*\s*\(([^)]*)\)/);
    if (!match) return false;

    const parameters = match[1]
        .split(",")
        .map(value => value.trim())
        .filter(value => /^[A-Za-z_]\w*$/.test(value));
    if (!parameters.length) return false;

    const values = [
        attribute?.member,
        attribute?.nameExpression,
        attribute?.chooser,
        attribute?.nameSource === "expression" ? attribute?.name : null
    ].map(value => String(value || ""));
    return parameters.some(parameter =>
    {
        const escaped = parameter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const token = new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`);
        return values.some(value => token.test(value));
    });
}

function getSourceLines(file)
{
    let lines = SOURCE_LINE_CACHE.get(file);
    if (!lines)
    {
        lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
        SOURCE_LINE_CACHE.set(file, lines);
    }
    return lines;
}

function resolveSourceFilePath(sourceFile, carbonRoot)
{
    const text = String(sourceFile || "").trim();
    if (!text) return null;
    if (path.isAbsolute(text)) return text;
    if (!carbonRoot) return null;
    return path.resolve(carbonRoot, text);
}

function createSourceRefs()
{
    const byPath = new Map();
    const byRef = {};

    return {
        ref(file)
        {
            const sourceFile = String(file || "").trim();
            if (!sourceFile) return null;

            let ref = byPath.get(sourceFile);
            if (!ref)
            {
                ref = `#ref${byPath.size + 1}`;
                byPath.set(sourceFile, ref);
                byRef[ref] = sourceFile;
            }
            return ref;
        },

        location(file, line)
        {
            return compactObject({
                file: this.ref(file),
                line: line || null
            });
        },

        toJSON()
        {
            return { ...byRef };
        }
    };
}

function toSourceRefList(sourceRefs, files)
{
    return files
        .map(file => sourceRefs.ref(file))
        .filter(Boolean);
}

function toParentSchemas(classInfo, classMap)
{
    return (classInfo.bases || []).map(base =>
    {
        const cppClass = cleanBaseName(base);
        const local = classMap && classMap.has(cppClass);
        return compactObject({
            cppClass,
            jsonFile: local ? `${cppClass}.json` : null,
            external: local ? null : true
        });
    });
}

function toBlueDefineSchema(item)
{
    return {
        macro: item.macro,
        name: item.name
    };
}

function toBlueExposureSchema(item)
{
    return compactObject({
        macro: item.macro || "EXPOSURE_BEGIN",
        name: item.name,
        description: item.description || null
    });
}

function toBlueInterfaceSchema(item)
{
    return {
        macro: item.macro || "MAP_INTERFACE",
        name: item.name
    };
}

function toFieldSchema(classInfo, field)
{
    const defaultInfo = classInfo.defaults?.[field.name] || (field.defaultValue ? {
        member: field.name,
        value: field.defaultValue
    } : null);

    return compactObject({
        cppName: field.name,
        cppType: field.type,
        parent: field.parent || null,
        struct: field.struct || null,
        nested: field.nested || null,
        nestedStruct: field.nestedStruct || null,
        default: toDefaultSchema(defaultInfo, field.type)
    });
}

function classInfoName(classInfo)
{
    return classInfo?.name ||
        classInfo?.blueClass ||
        classInfo?.cppClass ||
        classInfo?.black?.className ||
        classInfo?.className ||
        null;
}

function resolutionFields(registry)
{
    if (!registry || typeof registry !== "object") return null;
    return registry.fields && typeof registry.fields === "object"
        ? registry.fields
        : registry;
}

function lookupFieldResolution(registry, familyName, className, attr)
{
    const fields = resolutionFields(registry);
    if (!fields || !className) return null;

    const member = String(attr?.member || "").replace(/\s+/g, "");
    const fieldNames = [ attr?.name, member ].filter(Boolean);
    const classKeys = familyName
        ? [ `${familyName}/${className}`, className ]
        : [ className ];

    for (const classKey of classKeys)
    {
        const classFields = fields[classKey];
        if (!classFields || typeof classFields !== "object") continue;
        for (const fieldName of fieldNames)
        {
            if (hasOwn(classFields, fieldName))
            {
                return {
                    key: `${classKey}.${fieldName}`,
                    value: classFields[fieldName]
                };
            }
        }
    }

    return null;
}

function resolveFieldResolution(custom, familyName, classInfo, attr)
{
    const className = classInfoName(classInfo);
    return lookupFieldResolution(custom, familyName, className, attr) ||
        lookupFieldResolution(DEFAULT_FIELD_RESOLUTIONS, familyName, className, attr);
}

function fieldResolutionSummary(match)
{
    if (!match) return null;
    return compactObject({
        source: "fieldResolution",
        key: match.key,
        reason: match.value?.reason || null,
        reference: match.value?.source || null
    });
}

function isHydratableAttribute(attr)
{
    if (attr?.macro === "MAP_ATTRIBUTE_AS_CUSTOM_BINARY_BLOCK") return true;
    const flags = new Set(attr?.flags || []);
    return [ "READ", "WRITE", "READWRITE", "PERSIST", "PERSISTONLY" ]
        .some(flag => flags.has(flag));
}

function fieldResolutionIssue(reviewNotes, code, classInfo, attr, extra = {})
{
    const note = compactObject({
        type: code,
        blocking: isHydratableAttribute(attr),
        className: classInfoName(classInfo),
        blueName: attr?.name || null,
        member: attr?.member || null,
        flags: attr?.flags || [],
        ...extra
    });
    reviewNotes.push(note);
    return note;
}

function validateFieldResolution(match, classInfo, attr, reviewNotes)
{
    if (!match) return null;
    const resolution = match.value;
    if (!resolution || typeof resolution !== "object" || Array.isArray(resolution))
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-invalid", classInfo, attr, {
            resolutionKey: match.key,
            message: "Resolution must be an object."
        });
        return null;
    }
    if (!String(resolution.reason || "").trim())
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-invalid", classInfo, attr, {
            resolutionKey: match.key,
            message: "Resolution must provide a reason."
        });
        return null;
    }

    const member = String(attr?.member || "").replace(/\s+/g, "");
    const expectedMember = String(resolution.member || "").replace(/\s+/g, "");
    if (expectedMember && expectedMember !== member)
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-stale", classInfo, attr, {
            resolutionKey: match.key,
            expectedMember,
            actualMember: member
        });
        return null;
    }

    if (resolution.omit && (resolution.select || resolution.type || resolution.wire))
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-invalid", classInfo, attr, {
            resolutionKey: match.key,
            message: "An omitted field cannot also select or define a type."
        });
        return null;
    }
    if (resolution.select && (typeof resolution.select !== "object" || Array.isArray(resolution.select)))
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-invalid", classInfo, attr, {
            resolutionKey: match.key,
            message: "Resolution select must be an object."
        });
        return null;
    }
    if (resolution.expects && (typeof resolution.expects !== "object" || Array.isArray(resolution.expects)))
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-invalid", classInfo, attr, {
            resolutionKey: match.key,
            message: "Resolution expects must be an object."
        });
        return null;
    }
    if (resolution.define && resolution.select)
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-invalid", classInfo, attr, {
            resolutionKey: match.key,
            message: "A field cannot be both selected and manually defined."
        });
        return null;
    }
    if (resolution.define && resolution.expects)
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-invalid", classInfo, attr, {
            resolutionKey: match.key,
            message: "A manually defined field cannot also expect a scanned declaration."
        });
        return null;
    }
    if (resolution.type && !wireTypeForResolution(resolution.type))
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-invalid", classInfo, attr, {
            resolutionKey: match.key,
            message: `Unsupported resolution type "${resolution.type}".`
        });
        return null;
    }

    return match;
}

function wireTypeForResolution(type)
{
    switch (type)
    {
        case "boolean": return { beType: "BOOL", wireType: "bool" };
        case "float32": return { beType: "FLOAT", wireType: "float32" };
        case "float64": return { beType: "DOUBLE", wireType: "float64" };
        case "int8": return { beType: "BYTE", wireType: "int8", signed: true };
        case "uint8": return { beType: "BYTE", wireType: "uint8", signed: false };
        case "int16": return { beType: "SHORT", wireType: "int16", signed: true };
        case "uint16": return { beType: "SHORT", wireType: "uint16", signed: false };
        case "int32": return { beType: "LONG", wireType: "int32", signed: true };
        case "uint32": return { beType: "ULONG", wireType: "uint32", signed: false };
        case "int64": return { beType: "INT64", wireType: "int64", signed: true };
        case "uint64": return { beType: "UINT64", wireType: "uint64", signed: false };
        case "string": return { beType: "STDSTRING", wireType: "stringRef" };
        case "wstring": return { beType: "STDWSTRING", wireType: "wstringRef" };
        case "vec2": return { beType: "FLOATARRAY", wireType: "floatArray", length: 2 };
        case "vec3": return { beType: "FLOATARRAY", wireType: "floatArray", length: 3 };
        case "vec4":
        case "color":
        case "quat":
            return { beType: "FLOATARRAY", wireType: "floatArray", length: 4 };
        case "mat3": return { beType: "FLOATARRAY", wireType: "floatArray", length: 9 };
        case "mat4": return { beType: "FLOATARRAY", wireType: "floatArray", length: 16 };
        case "struct": return { beType: "IROOT", wireType: "inlineObject" };
        default: return null;
    }
}

function fieldResolutionWire(match)
{
    const resolution = match?.value;
    if (!resolution) return null;
    const byType = resolution.type ? wireTypeForResolution(resolution.type) : null;
    if (resolution.type && !byType) return null;
    if (!byType && !resolution.wire) return null;
    return {
        ...(byType || {}),
        ...(resolution.wire || {}),
        unresolved: false
    };
}

function getFieldCppName(field)
{
    return field?.name || field?.cppName || field?.fieldName || null;
}

function getFieldCppType(field)
{
    return field?.type || field?.cppType || null;
}

function toAttributeSchema(classInfo, attr, reviewNotes, classMap, sourceRefs, enumNames, familyName, values)
{
    const resolution = validateFieldResolution(
        resolveFieldResolution(values?.fieldResolutions, familyName, classInfo, attr),
        classInfo,
        attr,
        reviewNotes
    );
    if (resolution?.value?.omit)
    {
        reviewNotes.push({
            type: "field-resolution-applied",
            className: classInfoName(classInfo),
            blueName: attr?.name || null,
            member: attr?.member || null,
            resolution: fieldResolutionSummary(resolution),
            omitted: true
        });
        return null;
    }

    const fieldInfo = resolveAttributeFieldInfo(classInfo, attr, classMap, reviewNotes, resolution);
    const field = fieldInfo ? fieldInfo.field : null;
    const defaultInfo = field?.sourceNestedDefault
        ? { member: attr.member, value: field.sourceNestedDefault }
        : resolveDefault(classInfo, attr, field, classMap);
    const black = toBlackAttributeSchema(classInfo, attr, fieldInfo, field, reviewNotes, sourceRefs, enumNames, resolution);
    const schema = compactObject({
        macro: attr.macro,
        blueName: attr.name || null,
        blueNameExpression: attr.nameExpression || null,
        blueNameSource: attr.nameSource && attr.nameSource !== "literal" ? attr.nameSource : null,
        blueNameChooser: attr.nameChooser || null,
        member: attr.member,
        embedded: toEmbeddedProvenance(classInfo, attr, classMap),
        cppType: field ? getFieldCppType(field) : null,
        declaredOn: fieldInfo && classInfoName(fieldInfo.owner) !== classInfoName(classInfo) ? classInfoName(fieldInfo.owner) : null,
        flags: attr.flags || [],
        description: attr.description || null,
        chooser: attr.chooser || null,
        iid: attr.iid || null,
        black,
        default: toDefaultSchema(defaultInfo, field ? getFieldCppType(field) : null),
        resolution: fieldResolutionSummary(resolution)
    });

    if (attr.member && !field)
    {
        fieldResolutionIssue(reviewNotes, "attribute-cpp-type-unresolved", classInfo, attr, {
            blueName: attr.name || null,
            member: attr.member
        });
    }

    return schema;
}

/**
 * Provenance for attributes mapped THROUGH an embedded struct
 * (`MAP_ATTRIBUTE("name", m_struct.m_member, ...)`): records the root member
 * and, when resolvable, the struct's type so consumers do not have to
 * re-derive the through-path from the dotted member expression.
 */
function toEmbeddedProvenance(classInfo, attr, classMap)
{
    const memberPath = getMemberPath(attr.member);
    if (!memberPath || !memberPath.includes(".")) return null;

    const rootName = memberPath.split(".")[0];
    const rootInfo = findFieldInfo(classInfo, rootName, classMap);
    const rootType = rootInfo ? cleanNamedType(getFieldCppType(rootInfo.field)) : null;
    return compactObject({
        root: rootName,
        rootType: rootType || null
    });
}

function toBlackClassSchema(classInfo, attributes, version)
{
    return {
        schemaVersion: version,
        className: classInfo.name,
        fields: attributes
            .map(attribute => attribute.black)
            .filter(Boolean)
            .filter(field => field.persisted)
            .sort(compareBlackFields)
            .map(field => compactObject({
                names: field.names || null,
                nameExpression: field.nameExpression || null,
                indexToken: field.indexToken || null,
                indexKey: field.indexKey || null,
                cppType: field.cppType || null,
                enumType: field.enumType || null,
                beType: field.beType || null,
                wireType: field.wireType || null,
                container: field.container || null,
                length: field.length || null,
                signed: field.signed,
                macro: field.macro || null,
                flags: field.flags || null,
                source: field.source || null
            }))
    };
}

function compareBlackFields(a, b)
{
    const aFile = a.source?.file || "";
    const bFile = b.source?.file || "";
    if (aFile !== bFile) return aFile.localeCompare(bFile);

    const aLine = a.source?.line || 0;
    const bLine = b.source?.line || 0;
    if (aLine !== bLine) return aLine - bLine;

    return String(getNameRole(a.names, "name") || "").localeCompare(String(getNameRole(b.names, "name") || ""));
}

function toBlackAttributeSchema(classInfo, attr, fieldInfo, field, reviewNotes, sourceRefs, enumNames, resolution = null)
{
    const persisted = isBlackPersistedAttribute(attr);
    if (!persisted) return null;

    const memberPath = getMemberPath(attr.member);
    const memberRoot = getMemberRoot(attr.member);
    const indexed = parseIndexedMember(attr.member);
    const blackType = inferBlackWireType(field ? getFieldCppType(field) : null, attr, enumNames);
    const fieldName = getBlackFieldName(attr, memberRoot, field);
    const blackName = attr.name || attr.nameExpression || attr.member || fieldName;
    const blackTypeOverride = fieldResolutionWire(resolution) ||
        resolveBlackFieldOverride(classInfo, fieldName || blackName);
    const resolvedBlackType = blackTypeOverride ? { ...blackType, ...blackTypeOverride } : blackType;
    const enumType = resolvedBlackType.wireType === "enum"
        ? inferBlackEnumType(field ? getFieldCppType(field) : null, enumNames)
        : null;

    if (!attr.name)
    {
        fieldResolutionIssue(reviewNotes, "black-name-unresolved", classInfo, attr, {
            attributeExpression: attr.nameExpression || null,
            member: attr.member || null
        });
    }

    if (!resolvedBlackType.beType || resolvedBlackType.unresolved)
    {
        fieldResolutionIssue(reviewNotes, "black-type-unresolved", classInfo, attr, {
            blueName: attr.name || null,
            member: attr.member || null,
            cppType: field ? getFieldCppType(field) : null
        });
    }

    return compactObject({
        persisted,
        names: toNameRoleMap({
            name: blackName || null,
            fieldName,
            cppName: memberPath || memberRoot || (field ? field.name : null),
            member: attr.member || null,
            memberPath,
            memberRoot
        }),
        nameExpression: attr.nameExpression || null,
        nameSource: attr.nameSource && attr.nameSource !== "literal" ? attr.nameSource : null,
        nameChooser: attr.nameChooser || null,
        indexToken: indexed ? indexed.indexToken : null,
        indexKey: indexed ? normalizeBlackIndexKey(indexed.indexToken) : null,
        cppType: field ? getFieldCppType(field) : null,
        declaredOn: fieldInfo ? classInfoName(fieldInfo.owner) : classInfoName(classInfo),
        enumType,
        beType: resolvedBlackType.beType,
        wireType: resolvedBlackType.wireType,
        container: resolvedBlackType.container || null,
        length: resolvedBlackType.length || null,
        signed: resolvedBlackType.signed,
        macro: attr.macro,
        flags: attr.flags || [],
        source: sourceRefs.location(attr.source, attr.line)
    });
}

function toPropertySchema(classInfo, prop, reviewNotes, classMap)
{
    const inferred = inferPropertyType(classInfo, prop, classMap);
    reviewNotes.push(...inferred.reviewNotes);

    return compactObject({
        macro: prop.macro,
        blueName: prop.name || null,
        getter: prop.getter || null,
        setter: prop.setter || null,
        readOnly: prop.macro === "MAP_PROPERTY_READONLY" || !prop.setter,
        cppType: inferred.cppType,
        getterReturnType: inferred.getterReturnType,
        setterParameterType: inferred.setterParameterType,
        description: prop.description || null
    });
}

function toBlueMethodSchema(classInfo, method, classMap)
{
    const declaration = findMethodDeclarationInfo(
        classInfo,
        method.target || method.name,
        classMap
    );
    const ownerName = classInfoName(declaration?.owner);
    const className = classInfoName(classInfo);

    return compactObject({
        macro: method.macro,
        blueName: method.name || null,
        target: method.target || null,
        declaredOn: ownerName && ownerName !== className ? ownerName : null,
        description: method.description || null
    });
}

function resolveAttributeFieldInfo(classInfo, attr, classMap, reviewNotes, resolution = null)
{
    const memberPath = getMemberPath(attr.member);
    const selector = resolution?.value?.select || null;
    if (selector)
    {
        const selected = findSelectedFieldInfo(classInfo, memberPath || getMemberRoot(attr.member), classMap, selector);
        if (selected.matches.length !== 1)
        {
            fieldResolutionIssue(reviewNotes, "field-resolution-stale", classInfo, attr, {
                resolutionKey: resolution.key,
                selector,
                candidates: selected.matches.map(toFieldCandidateSummary),
                message: selected.matches.length
                    ? "Selector matched more than one field."
                    : "Selector did not match a field."
            });
            return null;
        }
        return selected.matches[0];
    }

    if (resolution?.value?.define)
    {
        return definedFieldInfo(resolution, classInfo, attr, reviewNotes);
    }

    const ambiguity = findAmbiguousFieldCandidates(classInfo, memberPath || getMemberRoot(attr.member), classMap);
    if (ambiguity.length > 1)
    {
        fieldResolutionIssue(reviewNotes, "attribute-cpp-type-ambiguous", classInfo, attr, {
            candidates: ambiguity.map(toFieldCandidateSummary),
            resolutionKey: `${classInfoName(classInfo)}.${attr?.name || attr?.member || "unknown"}`
        });
    }

    if (memberPath)
    {
        const found = findFieldInfo(classInfo, memberPath, classMap);
        if (found) return validateResolvedFieldExpectation(found, resolution, classInfo, attr, reviewNotes);
    }

    const memberRoot = getMemberRoot(attr.member);
    if (!memberRoot)
    {
        return definedFieldInfo(resolution, classInfo, attr, reviewNotes);
    }
    const found = findFieldInfo(classInfo, memberRoot, classMap);
    if (found) return validateResolvedFieldExpectation(found, resolution, classInfo, attr, reviewNotes);
    return definedFieldInfo(resolution, classInfo, attr, reviewNotes);
}

function definedFieldInfo(resolution, classInfo, attr, reviewNotes)
{
    const definition = resolution?.value?.define;
    if (!definition) return null;
    if (!definition.cppType)
    {
        fieldResolutionIssue(reviewNotes, "field-resolution-invalid", classInfo, attr, {
            resolutionKey: resolution.key,
            message: "A manually defined field must provide define.cppType."
        });
        return null;
    }
    return {
        owner: classInfo,
        field: {
            name: attr.member,
            type: definition.cppType,
            defaultValue: definition.defaultValue || null
        }
    };
}

function validateResolvedFieldExpectation(found, resolution, classInfo, attr, reviewNotes)
{
    const expects = resolution?.value?.expects;
    if (!expects) return found;
    if (fieldInfoMatchesSelector(found, expects)) return found;
    fieldResolutionIssue(reviewNotes, "field-resolution-stale", classInfo, attr, {
        resolutionKey: resolution.key,
        expects,
        candidates: [ toFieldCandidateSummary(found) ],
        message: "Resolved field no longer matches the expected native declaration."
    });
    return null;
}

function findSelectedFieldInfo(classInfo, memberName, classMap, selector)
{
    const candidates = collectFieldInfos(classInfo, memberName, classMap)
        .filter(info => isUsefulCppType(getFieldCppType(info.field)))
        .filter(info => fieldInfoMatchesSelector(info, selector));
    return { matches: candidates };
}

function collectFieldInfos(classInfo, memberName, classMap, seen = new Set())
{
    const typeName = classInfoName(classInfo);
    if (!classInfo || !memberName || (typeName && seen.has(typeName))) return [];
    if (typeName) seen.add(typeName);

    const lookup = getMemberPath(memberName);
    const matches = (classInfo.fields || [])
        .filter(field => fieldMatchesMember(field, lookup))
        .map(field => ({ owner: classInfo, field }));
    if (!classMap) return matches;

    for (const base of classInfo.bases || [])
    {
        matches.push(...collectFieldInfos(classMap.get(cleanBaseName(base)), memberName, classMap, seen));
    }
    return matches;
}

function fieldInfoMatchesSelector(info, selector)
{
    if (!info || !selector) return false;
    const field = info.field;
    if (selector.declaredOn && classInfoName(info.owner) !== selector.declaredOn) return false;
    if (selector.cppType && normalizeCppType(getFieldCppType(field)) !== normalizeCppType(selector.cppType)) return false;
    if (selector.parent && getMemberPath(field?.parent) !== getMemberPath(selector.parent)) return false;
    if (selector.struct && cleanNamedType(field?.struct) !== cleanNamedType(selector.struct)) return false;
    if (hasOwn(selector, "nested") && Boolean(field?.nested) !== Boolean(selector.nested)) return false;
    return true;
}

function toFieldCandidateSummary(info)
{
    const field = info?.field || info;
    return compactObject({
        declaredOn: classInfoName(info?.owner) || null,
        cppName: getFieldCppName(field),
        cppType: getFieldCppType(field),
        parent: field?.parent || null,
        struct: field?.struct || null,
        nested: field?.nested || null
    });
}

function fieldSemanticType(cppType)
{
    const normalized = normalizeCppTypeName(cppType);
    if (normalized === "std::string" || normalized === "std::wstring") return "string";
    return normalized;
}

function findAmbiguousFieldCandidates(classInfo, memberName, classMap)
{
    const candidates = collectFieldInfos(classInfo, memberName, classMap)
        .filter(info => isUsefulCppType(getFieldCppType(info.field)));
    const types = new Map();
    for (const info of candidates)
    {
        const type = fieldSemanticType(getFieldCppType(info.field));
        if (!types.has(type)) types.set(type, info);
    }
    return [ ...types.values() ];
}

function findFieldInfo(classInfo, memberName, classMap, seen = new Set())
{
    const typeName = classInfoName(classInfo);
    if (!classInfo || !memberName || (typeName && seen.has(typeName))) return null;
    if (typeName) seen.add(typeName);

    const field = findLocalField(classInfo, memberName);
    if (field) return { owner: classInfo, field };

    const nested = findNestedFieldInfo(classInfo, memberName, classMap, seen);
    if (nested) return nested;

    if (!classMap) return null;

    for (const base of classInfo.bases || [])
    {
        const found = findFieldInfo(classMap.get(cleanBaseName(base)), memberName, classMap, seen);
        if (found) return found;
    }

    return null;
}

function findLocalField(classInfo, memberName)
{
    const lookup = getMemberPath(memberName);
    if (!lookup) return null;

    const allMatches = (classInfo.fields || []).filter(item => fieldMatchesMember(item, lookup));
    const usefulMatches = allMatches.filter(item => isUsefulCppType(getFieldCppType(item)));
    const matches = usefulMatches.length ? usefulMatches : allMatches;
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];

    let best = matches[0];
    let bestScore = scoreLocalFieldMatch(best, lookup);
    for (let i = 1; i < matches.length; i++)
    {
        const field = matches[i];
        const score = scoreLocalFieldMatch(field, lookup);
        if (score > bestScore)
        {
            best = field;
            bestScore = score;
        }
    }

    return best;
}

function scoreLocalFieldMatch(field, lookup)
{
    let score = 0;

    if (getMemberPath(getFieldCppName(field)) === lookup) score += 20;
    if (isUsefulCppType(getFieldCppType(field))) score += 10;
    if (field?.jsType) score += 6;
    if (field?.default?.kind && field.default.kind !== "expression") score += 2;
    else if (field?.default) score += 1;

    return score;
}

function fieldMatchesMember(field, memberName)
{
    return [
        getFieldCppName(field),
        field?.member,
        field?.memberPath,
        field?.memberRoot
    ]
        .filter(Boolean)
        .some(value => getMemberPath(value) === memberName);
}

function findNestedFieldInfo(classInfo, memberName, classMap, seen)
{
    const memberPath = getMemberPath(memberName);
    if (!memberPath || !memberPath.includes(".")) return null;

    const parts = memberPath.split(".");
    const rootName = parts.shift();
    if (!rootName || !parts.length) return null;

    const rootField = findLocalField(classInfo, rootName);
    if (!rootField) return null;

    const rootType = cleanNamedType(getFieldCppType(rootField));
    if (!rootType)
    {
        return findFlattenedNestedFieldInfo(classInfo, memberPath, rootName, parts.join("."), null);
    }

    const sourceLeaf = resolveSourceNestedField(rootType, parts.join("."), memberPath);
    if (sourceLeaf) return { owner: classInfo, field: sourceLeaf };

    if (!classMap) return null;

    const nestedType = classMap.get(rootType) || classMap.crossFamilyTypes?.get(rootType);
    if (!nestedType)
    {
        return findFlattenedNestedFieldInfo(classInfo, memberPath, rootName, parts.join("."), rootType);
    }

    const found = findFieldInfo(nestedType, parts.join("."), classMap, new Set(seen));
    return found || findFlattenedNestedFieldInfo(classInfo, memberPath, rootName, parts.join("."), rootType);
}

const SOURCE_NESTED_FIELD_OVERRIDES = Object.freeze({
    "CcpMath::AxisAlignedBox": Object.freeze({
        m_min: Object.freeze({ type: "Vector3", defaultValue: "Vector3( 0, 0, 0 )" }),
        m_max: Object.freeze({ type: "Vector3", defaultValue: "Vector3( 0, 0, 0 )" })
    })
});

function resolveSourceNestedField(rootType, leafPath, memberPath)
{
    const leaf = SOURCE_NESTED_FIELD_OVERRIDES[rootType]?.[leafPath];
    if (!leaf) return null;
    return {
        name: memberPath,
        type: leaf.type,
        sourceNestedDefault: leaf.defaultValue || null
    };
}

function findFlattenedNestedFieldInfo(classInfo, memberPath, rootName, leafPath, rootType)
{
    const fields = Array.isArray(classInfo?.fields) ? classInfo.fields : [];
    const leafName = getMemberPath(leafPath)?.split(".").pop() || null;
    if (!leafName) return null;

    for (const field of fields)
    {
        if (fieldMatchesMember(field, memberPath)) return { owner: classInfo, field };
    }

    const structured = fields.filter(field => matchesFlattenedNestedLeaf(field, rootName, leafName, rootType));
    if (structured.length === 1) return { owner: classInfo, field: structured[0] };

    const leafOnly = fields.filter(field => getMemberPath(getFieldCppName(field)) === leafName);
    if (leafOnly.length === 1) return { owner: classInfo, field: leafOnly[0] };

    return null;
}

function matchesFlattenedNestedLeaf(field, rootName, leafName, rootType)
{
    const fieldName = getMemberPath(getFieldCppName(field));
    if (!fieldName) return false;

    if (fieldName === `${rootName}.${leafName}`) return true;

    const parent = getMemberPath(field?.parent);
    if (parent && parent === rootName)
    {
        return fieldName === leafName || fieldName.endsWith(`.${leafName}`);
    }

    if (field?.nested)
    {
        const struct = cleanNamedType(field?.struct);
        if (rootType && struct === rootType)
        {
            return fieldName === leafName || fieldName.endsWith(`.${leafName}`);
        }
    }

    return false;
}

function resolveDefault(classInfo, attr, field, classMap)
{
    const memberPath = getMemberPath(attr.member);
    if (memberPath && classInfo.defaults?.[memberPath]) return classInfo.defaults[memberPath];

    const memberRoot = getMemberRoot(attr.member);
    if (memberRoot && classInfo.defaults?.[memberRoot]) return classInfo.defaults[memberRoot];
    if (field)
    {
        const fieldName = getFieldCppName(field);
        if (fieldName && classInfo.defaults?.[fieldName]) return classInfo.defaults[fieldName];
    }

    const sourceDefault = resolveSourceMemberDefault(classInfo, attr.member);
    if (sourceDefault) return sourceDefault;

    if (!classMap) return null;

    for (const base of classInfo.bases || [])
    {
        const parent = classMap.get(cleanBaseName(base));
        const found = parent ? resolveDefault(parent, attr, field, classMap) : null;
        if (found) return found;
    }

    return null;
}

function resolveSourceMemberDefault(classInfo, member)
{
    const className = classInfoName(classInfo);
    const memberPath = getMemberPath(member);
    if (!className || !memberPath) return null;
    const override = SOURCE_MEMBER_DEFAULT_OVERRIDES[`${className}.${memberPath}`];
    return override ? { member, value: override.value } : null;
}

function inferPropertyType(classInfo, prop, classMap)
{
    const getter = findMethodDeclaration(classInfo, prop.getter, classMap);
    const setter = findMethodDeclaration(classInfo, prop.setter, classMap);
    const getterReturnType = getter && getter.returnType && getter.returnType !== "void" ? getter.returnType : null;
    const setterParameterType = setter && setter.parameters && setter.parameters[0] ? setter.parameters[0].type : null;
    const cppType = getterReturnType || setterParameterType || null;
    const reviewNotes = [];

    if (prop.getter && !getter)
    {
        reviewNotes.push({
            type: "property-getter-not-found",
            blueName: prop.name || null,
            getter: prop.getter
        });
    }

    if (prop.setter && !setter)
    {
        reviewNotes.push({
            type: "property-setter-not-found",
            blueName: prop.name || null,
            setter: prop.setter
        });
    }

    if (!cppType)
    {
        reviewNotes.push({
            type: "property-cpp-type-unresolved",
            blueName: prop.name || null,
            getter: prop.getter || null,
            setter: prop.setter || null
        });
    }
    else if (getterReturnType && setterParameterType && normalizeCppType(getterReturnType) !== normalizeCppType(setterParameterType))
    {
        reviewNotes.push({
            type: "property-cpp-type-mismatch",
            blueName: prop.name || null,
            getter: prop.getter || null,
            getterReturnType,
            setter: prop.setter || null,
            setterParameterType
        });
    }

    return {
        cppType,
        getterReturnType,
        setterParameterType,
        reviewNotes
    };
}

function findMethodDeclaration(classInfo, name, classMap, seen = new Set())
{
    return findMethodDeclarationInfo(classInfo, name, classMap, seen)?.method || null;
}

function findMethodDeclarationInfo(classInfo, name, classMap, seen = new Set())
{
    if (!classInfo || !name || seen.has(classInfo.name)) return null;
    seen.add(classInfo.name);

    const method = (classInfo.methods || []).find(item => item.kind === "declaration" && item.name === name);
    if (method)
    {
        return {
            method,
            owner: classInfo
        };
    }

    if (!classMap) return null;

    for (const base of classInfo.bases || [])
    {
        const found = findMethodDeclarationInfo(classMap.get(cleanBaseName(base)), name, classMap, seen);
        if (found) return found;
    }

    return null;
}

function isBlackPersistedAttribute(attr)
{
    const flags = attr.flags || [];
    return attr.macro === "MAP_ATTRIBUTE_AS_CUSTOM_BINARY_BLOCK" ||
        flags.includes("PERSIST") ||
        flags.includes("PERSISTONLY");
}

function hasEnumName(enumNames, name)
{
    return !!name && enumNames instanceof Set && enumNames.has(name);
}

function inferBlackEnumType(cppType, enumNames = null)
{
    if (!cppType) return null;
    const raw = normalizeCppTypeName(cppType);
    if (!raw) return null;
    if (raw.includes("::"))
    {
        const parts = raw.split("::");
        const tail = parts[parts.length - 1].trim();
        return tail || raw;
    }
    if (hasEnumName(enumNames, raw)) return raw;
    return raw;
}

function inferBlackWireType(cppType, attr, enumNames = null)
{
    if (attr.macro === "MAP_ATTRIBUTE_AS_CUSTOM_BINARY_BLOCK")
    {
        return {
            beType: "BINARYBLOCK",
            wireType: "binaryBlock"
        };
    }

    if (!cppType) return { beType: null, wireType: null };

    const type = normalizeCppType(cppType);
    const name = normalizeCppTypeName(cppType);
    const vector = getVectorSpec(cppType);
    if (vector)
    {
        return {
            beType: "FLOATARRAY",
            wireType: "floatArray",
            length: vector.length
        };
    }

    if (isContainerLikeCppType(cppType))
    {
        return {
            beType: "IROOT",
            wireType: "container",
            container: inferBlackContainerKind(cppType)
        };
    }

    if (isPointerLikeCppType(cppType))
    {
        return {
            beType: "IROOTPTR",
            wireType: "objectRef"
        };
    }

    switch (name)
    {
        case "bool":
            return { beType: "BOOL", wireType: "bool" };
        case "float":
            return { beType: "FLOAT", wireType: "float32" };
        case "double":
            return { beType: "DOUBLE", wireType: "float64" };
        case "char":
        case "int8_t":
            return { beType: "BYTE", wireType: "int8", signed: true };
        case "uint8_t":
        case "byte":
        case "unsignedchar":
            return { beType: "BYTE", wireType: "uint8", signed: false };
        case "int16_t":
        case "short":
            return { beType: "SHORT", wireType: "int16", signed: true };
        case "uint16_t":
        case "ushort":
        case "unsignedshort":
            return { beType: "SHORT", wireType: "uint16", signed: false };
        case "uint":
        case "uint32_t":
        case "ulong":
        case "unsigned":
        case "unsignedint":
        case "unsignedlong":
            return { beType: "ULONG", wireType: "uint32", signed: false };
        case "int":
        case "int32_t":
        case "long":
            return { beType: "LONG", wireType: "int32", signed: true };
        case "int64_t":
        case "longlong":
            return { beType: "INT64", wireType: "int64", signed: true };
        case "uint64_t":
        case "size_t":
        case "ulonglong":
            return { beType: "UINT64", wireType: "uint64", signed: false };
        case "std::wstring":
            return { beType: "STDWSTRING", wireType: "wstringRef" };
        case "std::string":
            return { beType: "STDSTRING", wireType: "stringRef" };
        case "BlueSharedStringW":
            return { beType: "SHAREDSTRINGW", wireType: "wstringRef" };
        case "BlueSharedString":
            return { beType: "SHAREDSTRING", wireType: "stringRef" };
        default:
            break;
    }

    if (/wchar_t\*$/.test(type)) return { beType: "WCSTRING", wireType: "wstringRef" };
    if (/char\*$/.test(type)) return { beType: "CSTRING", wireType: "stringRef" };
    const enumType = inferBlackEnumType(cppType, enumNames);
    if ((attr.flags || []).includes("ENUM")) return { beType: "LONG", wireType: "enum", signed: true };
    if (enumType && hasEnumName(enumNames, enumType)) return { beType: "LONG", wireType: "enum", signed: true };
    if (/::[A-Za-z_]\w*(?:Type|Usage|Mode|Enum)?$/.test(type)) return { beType: "LONG", wireType: "enum", signed: true };
    if (/^[A-Z]\w*(?:Type|Usage|Mode|Enum)$/.test(name)) return { beType: "LONG", wireType: "enum", signed: true };

    return {
        beType: "IROOT",
        wireType: "inlineObject",
        unresolved: true
    };
}

function getVectorSpec(cppType)
{
    const name = normalizeCppTypeName(cppType);
    switch (name)
    {
        case "Quaternion":
        case "Quat":
        case "Color":
        case "ColorRGBA":
        case "LinearColor":
            return { length: 4 };
        case "Matrix3":
        case "Mat3":
            return { length: 9 };
        case "Matrix":
        case "Matrix4":
        case "Mat4":
        case "TriMatrix":
            return { length: 16 };
        default:
            break;
    }

    const match = name.match(/(?:Float|Vector|Vec)([234])(?:d|f)?$/i) || name.match(/^(?:float)([234])$/i);
    if (!match) return null;
    return { length: Number(match[1]) };
}

function inferBlackContainerKind(cppType)
{
    const type = normalizeCppTypeName(cppType);
    if (/(?:^|::)map<|Map$/.test(type)) return "dict";
    if (/(?:^|::)set<|Set$/.test(type)) return "set";
    return "list";
}

function isContainerLikeCppType(cppType)
{
    const type = normalizeCppType(cppType);
    return /(?:vector|list|set|map|Vector|List|Set|Map|Deque|Array)</.test(type) ||
        /(?:Vector|List|Set|Map|Deque|Array)$/.test(normalizeCppTypeName(cppType));
}

function isPointerLikeCppType(cppType)
{
    const type = normalizeCppType(cppType);
    const name = normalizeCppTypeName(cppType);
    return /\*$/.test(type) ||
        /Ptr$/.test(name) ||
        /^P[A-Z]/.test(name);
}

function getBlackFieldName(attr, memberRoot, field)
{
    if (attr.name && (!attr.nameSource || attr.nameSource === "literal")) return toPropertyName(attr.name);
    if (memberRoot) return toPropertyName(memberRoot.replace(/^m_/, ""));
    if (field)
    {
        const fieldName = String(getFieldCppName(field) || "").split(".").pop();
        if (fieldName) return toPropertyName(fieldName.replace(/^m_/, ""));
    }
    if (attr.name) return toPropertyName(attr.name);
    return null;
}

function parseIndexedMember(value)
{
    const match = String(value || "").match(/^(.+)\[([^\]]+)\]$/);
    if (!match) return null;
    return {
        member: match[1],
        indexToken: String(match[2]).trim()
    };
}

function normalizeBlackIndexKey(indexToken)
{
    const number = Number(indexToken);
    if (Number.isInteger(number) && String(indexToken).trim() === String(number)) return number;

    const parts = normalizeChooserToken(indexToken)
        .replace(/^TYPE_/, "")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);
    if (!parts.length) return null;

    const pascal = parts
        .map(part => part === "FX" ? "FX" : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join("");

    return pascal ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : null;
}

function toDefaultSchema(defaultInfo, cppType)
{
    if (!defaultInfo) return null;

    const parsed = parseDefaultJsonValue(defaultInfo.value, cppType);
    return {
        cpp: defaultInfo.value,
        json: parsed.value,
        kind: parsed.kind
    };
}

function parseDefaultJsonValue(value, cppType)
{
    if (!value) return { kind: "none", value: null };

    const trimmed = String(value).trim();
    if (/^(NULL|nullptr)$/i.test(trimmed)) return { kind: "null", value: null };
    if (isStringCppType(cppType) && isCppStringLiteral(trimmed)) return { kind: "string", value: readCppStringLiteral(trimmed) };
    if (isBoolCppType(cppType) && /^(true|false)$/i.test(trimmed)) return { kind: "boolean", value: /^true$/i.test(trimmed) };
    if (isNumberCppType(cppType) && isNumericLiteral(trimmed)) return { kind: "number", value: readNumericLiteral(trimmed) };
    if (!cppType && isCppStringLiteral(trimmed)) return { kind: "string", value: readCppStringLiteral(trimmed) };
    if (!cppType && /^(true|false)$/i.test(trimmed)) return { kind: "boolean", value: /^true$/i.test(trimmed) };
    if (!cppType && isNumericLiteral(trimmed)) return { kind: "number", value: readNumericLiteral(trimmed) };
    return { kind: "expression", value: null };
}

function isStringCppType(cppType)
{
    const name = normalizeCppTypeName(cppType);
    return /(^|::)(string|wstring)$/.test(name) || /BlueSharedStringW?$/.test(name);
}

function isBoolCppType(cppType)
{
    return normalizeCppTypeName(cppType) === "bool";
}

function isNumberCppType(cppType)
{
    return /^(?:float|double|int|long|short|char|byte|uint|size_t|int\d+_t|uint\d+_t|unsigned(?:int|long|short|char))$/.test(normalizeCppTypeName(cppType));
}

function isCppStringLiteral(value)
{
    return /^L?"(?:\\.|[^"\\])*"$/.test(value);
}

function readCppStringLiteral(value)
{
    return value
        .replace(/^L?"/, "")
        .replace(/"$/, "")
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\");
}

function isNumericLiteral(value)
{
    return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[ful]*$/i.test(value);
}

function readNumericLiteral(value)
{
    return Number(String(value).replace(/[ful]+$/i, ""));
}

function cleanBaseName(base)
{
    return String(base || "")
        .replace(/\b(public|protected|private|virtual)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
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

function getMemberRoot(member)
{
    if (!member) return null;
    const match = String(member).match(/([A-Za-z_]\w*)/);
    return match ? match[1] : null;
}

function getMemberPath(member)
{
    if (!member) return null;
    return String(member)
        .replace(/\s+/g, "")
        .replace(/\[[^\]]+\]/g, "");
}

function normalizeCppType(type)
{
    return String(type || "")
        .replace(/\bconst\b/g, "")
        .replace(/\s+/g, "")
        .replace(/[&]+$/g, "");
}

function normalizeCppTypeName(cppType)
{
    return normalizeCppType(cppType)
        .replace(/\*+$/g, "")
        .replace(/^class/, "")
        .replace(/^struct/, "");
}

function normalizeChooserToken(value)
{
    return String(value || "")
        .replace(/\b[A-Za-z_]\w*::/g, "")
        .replace(/\s+/g, "")
        .trim();
}

function toPropertyName(value)
{
    const text = String(value || "").trim();
    if (!text) return null;
    return text.charAt(0).toLowerCase() + text.slice(1);
}

function resolveBlackFieldOverride(type, fieldName)
{
    if (!type || !fieldName) return null;
    const match = resolveFieldResolution(null, type.family || null, type, {
        name: fieldName,
        member: fieldName
    });
    return fieldResolutionWire(match);
}

function toNameRoleMap(roles)
{
    const names = {};
    for (const [ role, value ] of Object.entries(roles))
    {
        if (value === null || value === undefined || value === "") continue;

        const name = String(value);
        if (!names[name])
        {
            names[name] = [];
        }
        names[name].push(role);
    }

    for (const [ name, nameRoles ] of Object.entries(names))
    {
        names[name] = nameRoles.join(" ");
    }

    return Object.keys(names).length ? names : null;
}

function getNameRole(names, role)
{
    if (!names || typeof names !== "object") return null;

    for (const [ name, roles ] of Object.entries(names))
    {
        const roleList = Array.isArray(roles) ? roles : String(roles || "").split(/\s+/);
        if (roleList.includes(role))
        {
            return name;
        }
    }

    return null;
}

function compactObject(value)
{
    const out = {};
    for (const [ key, item ] of Object.entries(value))
    {
        if (item === null || item === undefined) continue;
        if (Array.isArray(item) && item.length === 0) continue;
        out[key] = item;
    }
    return out;
}

function build(classes, key, props)
{
    const Ctor = classes[key];
    return Ctor ? Object.assign(new Ctor(), props) : props;
}

function hydrateClassSchema(type, classes)
{
    return build(classes, "Type", {
        ...type,
        parents: (type.parents || []).map(item => build(classes, "Reference", item)),
        fields: (type.fields || []).map(item => build(classes, "Field", item)),
        attributes: (type.attributes || []).map(item => build(classes, "Decorator", item)),
        properties: (type.properties || []).map(item => build(classes, "Decorator", item)),
        methods: (type.methods || []).map(item => build(classes, "Decorator", item))
    });
}

function hydrateEnums(enums, classes)
{
    return build(classes, "Schema", {
        ...enums,
        enums: (enums.enums || []).map(item => build(classes, "Enum", {
            ...item,
            values: (item.values || []).map(value => build(classes, "EnumValue", value))
        }))
    });
}

function hydrateSchema(value, classes)
{
    const kind = documentKind(value);
    if (kind === "bundle")
    {
        return build(classes, "Schema", {
            ...value,
            index: build(classes, "Schema", value.index),
            enums: hydrateEnums(value.enums, classes),
            families: value.families.map(family => build(classes, "Namespace", {
                ...family,
                index: build(classes, "Namespace", family.index),
                classes: family.classes.map(item => hydrateClassSchema(item, classes))
            }))
        });
    }

    if (kind === "class") return hydrateClassSchema(value, classes);
    if (kind === "enums") return hydrateEnums(value, classes);
    if (kind === "familyIndex") return build(classes, "Namespace", value);
    return build(classes, "Schema", value);
}

export function readWithValues(input, values, readerName = "CjsFormatCarbon")
{
    const schema = emitSchema(input, values, readerName);
    if (values.emit === OUTPUT_RAW) return schema;
    return hydrateSchema(schema, values.classes);
}

export function inspectWithValues(input, values, readerName = "CjsFormatCarbon")
{
    const schema = emitSchema(input, { ...values, emit: OUTPUT_RAW }, readerName);
    const kind = documentKind(schema);

    if (kind === "bundle")
    {
        return {
            schema: schema.schema,
            schemaVersion: schema.schemaVersion,
            kind,
            generatedAt: schema.generatedAt,
            carbonRoot: schema.carbonRoot,
            families: schema.families.length,
            classes: schema.families.reduce((total, family) => total + family.classes.length, 0),
            enums: schema.enums.enums.length
        };
    }

    if (kind === "class")
    {
        return {
            schema: SCHEMA_NAME,
            schemaVersion: schema.schemaVersion,
            kind,
            family: schema.family || null,
            blueClass: schema.blueClass || null,
            cppClass: schema.cppClass || null,
            fields: (schema.fields || []).length,
            attributes: (schema.attributes || []).length,
            blackFields: (schema.black?.fields || []).length,
            reviewNotes: (schema.reviewNotes || []).length
        };
    }

    return {
        schema: SCHEMA_NAME,
        schemaVersion: schema.schemaVersion,
        kind,
        families: Array.isArray(schema.families) ? schema.families.length : 0,
        classes: Array.isArray(schema.classes) ? schema.classes.length : 0,
        enums: Array.isArray(schema.enums) ? schema.enums.length : 0
    };
}

export function readBlackDefinitionsWithValues(input, values, readerName = "CjsFormatCarbon")
{
    const schema = emitSchema(input, { ...values, emit: OUTPUT_RAW }, readerName);
    return projectBlackDefinitions(schema, readerName);
}

export function writeWithValues(input, outputRoot, values, readerName = "CjsFormatCarbon")
{
    if (typeof outputRoot !== "string" || !outputRoot.trim())
    {
        throw new TypeError(`${readerName} output root must be a non-empty path`);
    }

    const schema = emitSchema(input, { ...values, emit: OUTPUT_RAW }, readerName);
    return writeSchemaFiles(schema, outputRoot, readerName);
}

export function writeBlackDefinitionsWithValues(input, outputRoot, values, readerName = "CjsFormatCarbon")
{
    if (typeof outputRoot !== "string" || !outputRoot.trim())
    {
        throw new TypeError(`${readerName} output root must be a non-empty path`);
    }

    const definitions = readBlackDefinitionsWithValues(input, values, readerName);
    return writeBlackDefinitionFiles(definitions, outputRoot, readerName);
}

function projectBlackDefinitions(schema, readerName)
{
    const kind = documentKind(schema);
    if (kind === "bundle")
    {
        const
            classMap = createSchemaClassMap(schema.families || []),
            enumNames = new Set((schema.enums?.enums || []).map(item => item?.name).filter(Boolean)),
            enums = projectBlackEnums(schema.enums),
            classList = projectBlackClasses(schema, readerName, classMap, enumNames),
            classes = Object.fromEntries(classList.map(type => [ type.className, type.fields ]));

        return {
            schema: BLACK_DEFINITIONS_SCHEMA_NAME,
            version: BLACK_DEFINITIONS_SCHEMA_VERSION,
            generatedAt: schema.generatedAt || null,
            enums,
            classes
        };
    }

    if (kind === "class")
    {
        return projectBlackClass(schema);
    }

    throw new TypeError(`${readerName} cannot project ${kind} to Black definitions; use a schema bundle, schema folder, or class schema`);
}

function createSchemaClassMap(families)
{
    const classes = new Map();
    for (const family of families || [])
    {
        for (const type of family.classes || [])
        {
            for (const name of [
                classInfoName(type),
                type?.blueClass,
                type?.cppClass,
                type?.black?.className
            ].filter(Boolean))
            {
                classes.set(name, type);
            }
        }
    }
    return classes;
}

function projectBlackClasses(schema, readerName, classMap, enumNames)
{
    const classes = new Map();

    for (const family of schema.families || [])
    {
        for (const type of family.classes || [])
        {
            const projected = projectBlackClass(type, classMap, enumNames);
            if (!projected) continue;
            if (!Object.keys(projected.fields).length && !hasConcreteBlueDefinition(type)) continue;

            if (classes.has(projected.className))
            {
                throw new Error(`${readerName} duplicate Black class definition "${projected.className}"`);
            }

            classes.set(projected.className, projected);
        }
    }

    return Array.from(classes.values()).sort((a, b) => a.className.localeCompare(b.className));
}

function projectBlackClass(type, classMap = null, enumNames = null)
{
    const className = type.black?.className || type.className || type.blueClass || type.cppClass || type.name || null;
    if (!className) return null;

    return {
        className,
        fields: projectBlackFields(type, classMap, enumNames)
    };
}

function projectBlackFields(type, classMap, enumNames, seen = new Set())
{
    const className = classInfoName(type);
    if (className && seen.has(className)) return {};

    const branch = new Set(seen);
    if (className) branch.add(className);

    const fields = {};
    for (const base of resolveBlackInheritanceParents(type, classMap))
    {
        Object.assign(fields, projectBlackFields(base, classMap, enumNames, branch));
    }

    for (const field of type.black?.fields || type.blackFields || [])
    {
        const projected = projectCompactBlackField(type, field, classMap, enumNames);
        if (!projected) continue;
        fields[projected.name] = projected.value;
    }

    return fields;
}

/**
 * Resolves the parents whose persisted fields this class inherits.
 *
 * Carbon Blue persistence inheritance is declared by EXPOSURE_CHAINTO, not by
 * the C++ base list: an exposure ending with EXPOSURE_END inherits NO
 * persisted surface even when the C++ class has Blue bases
 * (BlueExposureMacros.h:130-138). Merging every C++ base overexposed fields
 * on the classes whose chain is narrower than their inheritance (textured
 * point lights gaining lightColor, extension buckets gaining the placement
 * surface, EveRootTransform gaining EveTransform-only fields).
 *
 * Tri-state on the scanned data:
 * - chain captured with a name: project ONLY through that chain parent
 *   (falling back to the legacy merge if the named parent cannot be resolved,
 *   so an incomplete class map narrows nothing silently);
 * - chain captured as null (EXPOSURE_END): no inherited persisted fields;
 * - legacy schema docs without chain capture: the historical merge of every
 *   C++ base, so pre-chainTo schema builds keep decoding identically.
 */
function resolveBlackInheritanceParents(type, classMap)
{
    const blue = type.blue;
    const chainCaptured = Boolean(blue)
        && Object.prototype.hasOwnProperty.call(blue, "chainTo")
        && Array.isArray(blue.exposures)
        && blue.exposures.length > 0;

    if (chainCaptured)
    {
        const chainName = blue.chainTo?.name ?? blue.chainTo ?? null;
        if (chainName === null) return [];
        const chainParent = classMap?.get(cleanBaseName(chainName));
        if (chainParent) return [ chainParent ];
    }

    const parents = [];
    for (const base of type.bases || [])
    {
        const baseType = classMap?.get(cleanBaseName(base));
        if (baseType) parents.push(baseType);
    }
    return parents;
}

function hasConcreteBlueDefinition(type)
{
    return (type.blue?.defines || []).some(item => item?.macro === "BLUE_DEFINE");
}

function projectBlackEnums(enumsDocument)
{
    const enums = {};
    for (const item of enumsDocument?.enums || [])
    {
        if (!item?.name || !Array.isArray(item.values)) continue;
        enums[item.name] = Object.fromEntries(item.values
            .filter(value => value && value.name !== undefined)
            .map(value => [ value.name, value.value ]));
    }

    return enums;
}

function projectCompactBlackField(type, field, classMap = null, enumNames = null)
{
    if (!field || typeof field !== "object") return null;

    const
        names = field.names || null,
        blackName = field.name ||
            getNameRole(names, "name") ||
            field.nameExpression ||
            null,
        fieldName = field.fieldName ||
            getNameRole(names, "fieldName") ||
            blackName ||
            null,
        sourceField = findBlackSourceField(type, field, classMap),
        normalizedField = normalizeProjectedBlackField(type, field, sourceField, blackName || fieldName, enumNames),
        fieldType = compactBlackFieldType(normalizedField, sourceField, blackName || fieldName);

    if (!blackName && !fieldName) return null;

    const spec = compactObject({
        type: fieldType.type,
        field: fieldName && fieldName !== blackName ? fieldName : null,
        index: normalizedField.indexKey !== undefined ? normalizedField.indexKey : null,
        token: normalizedField.indexToken || null,
        enum: normalizedField.enumType || null,
        length: fieldType.length || null
    });

    return {
        name: blackName || fieldName,
        value: Object.keys(spec).length === 1 ? fieldType.type : spec
    };
}

function normalizeProjectedBlackField(type, field, sourceField, fieldName, enumNames)
{
    const cppType = sourceField?.cppType || field.cppType || null;
    const inferred = inferBlackWireType(cppType, {
        macro: field.macro,
        flags: field.flags || []
    }, enumNames);
    const override = resolveBlackFieldOverride(type, fieldName);
    const wire = override ? { ...inferred, ...override } : inferred;

    return {
        ...field,
        cppType,
        enumType: wire.wireType === "enum"
            ? inferBlackEnumType(cppType, enumNames)
            : null,
        beType: wire.beType || field.beType || null,
        wireType: wire.wireType || field.wireType || null,
        container: wire.container || field.container || null,
        length: wire.length ?? field.length ?? null,
        signed: wire.signed
    };
}

function compactBlackFieldType(field, sourceField, fieldName)
{
    const
        jsType = field.jsType || sourceField?.jsType || null,
        kind = jsType?.kind || null,
        cppType = sourceField?.cppType || (isUsefulCppType(field.cppType) ? field.cppType : field.cppType || null);

    if (kind === "path") return { type: "path" };
    if (kind === "expression") return { type: "expression" };

    switch (field.beType)
    {
        case "BOOL":
            return { type: "boolean" };
        case "CSTRING":
        case "STDSTRING":
        case "SHAREDSTRING":
        case "REFERENCE":
            return { type: isPathLikeField(fieldName, cppType) ? "path" : "string" };
        case "WCSTRING":
        case "STDWSTRING":
        case "SHAREDSTRINGW":
        case "WREFERENCE":
            return { type: "wstring" };
        case "FLOAT":
            return { type: "float" };
        case "DOUBLE":
            return { type: "double" };
        case "LONG":
            return { type: field.enumType ? "enum" : "int" };
        case "ULONG":
            return { type: "uint" };
        case "INT64":
            return { type: "int64" };
        case "UINT64":
            return { type: "uint64" };
        case "BYTE":
            return { type: field.signed ? "byte" : "ubyte" };
        case "SHORT":
            return { type: field.signed ? "short" : "ushort" };
        case "FLOATARRAY":
            return compactFloatArrayType(field.length || jsType?.length || 0, cppType, fieldName, kind);
        case "BINARYBLOCK":
            return { type: "binaryBlock" };
        case "IROOTPTR":
        case "IROOTWEAKREF":
            return { type: "object" };
        case "IROOT":
            if (field.container === "dict") return { type: "dict" };
            if (field.container === "list" && cppType && /StructureList/.test(String(cppType))) return { type: "structList" };
            if (field.container === "list" || field.container === "set") return { type: "array" };
            return compactObjectLikeType(cppType, kind);
        default:
            break;
    }

    return { type: compactKindName(kind) || "unknown" };
}

function compactObjectLikeType(cppType, kind)
{
    if (kind === "color") return { type: "color" };
    if (kind === "vector2") return { type: "vector2" };
    if (kind === "vector3") return { type: "vector3" };
    if (kind === "vector4") return { type: "vector4" };
    if (kind === "quaternion") return { type: "quaternion" };
    if (/Color/.test(String(cppType || ""))) return { type: "color" };
    if (/Vector2/.test(String(cppType || ""))) return { type: "vector2" };
    if (/Vector3/.test(String(cppType || ""))) return { type: "vector3" };
    if (/Vector4/.test(String(cppType || ""))) return { type: "vector4" };
    return { type: "rawStruct" };
}

function compactFloatArrayType(length, cppType = null, fieldName = null, kind = null)
{
    if (length === 4)
    {
        if (kind === "color" || /(?:^|::)(?:Color|ColorRGBA|LinearColor)$/.test(String(cppType || "")))
        {
            return { type: "color" };
        }

        if (kind === "quaternion" ||
            /(?:^|::)(?:Quaternion|Quat)$/.test(String(cppType || "")) ||
            /rotation/i.test(String(fieldName || "")))
        {
            return { type: "quaternion" };
        }
    }

    switch (length)
    {
        case 2:
            return { type: "vector2" };
        case 3:
            return { type: "vector3" };
        case 4:
            return { type: "vector4" };
        case 9:
            return { type: "matrix3" };
        case 16:
            return { type: "matrix4" };
        default:
            return {
                type: "floatArray",
                length
            };
    }
}

function compactKindName(kind)
{
    if (!kind) return null;
    if (kind === "float32") return "float";
    if (kind === "float64") return "double";
    if (kind === "int32") return "int";
    if (kind === "uint32") return "uint";
    if (kind === "objectRef") return "object";
    return kind;
}

function isPathLikeField(fieldName, cppType)
{
    const text = `${fieldName || ""} ${cppType || ""}`;
    return /(?:^|[_\s])(res)?path|res(file)?$/i.test(text) ||
        /respath|filepath|texture|shader|geometry|granny|sprite|sound|effect/i.test(text);
}

function findBlackSourceField(type, blackField, classMap = null)
{
    const fields = (type.fields || []).filter(field => field && typeof field === "object");

    const names = blackField.names || null;
    const fieldName = blackField.fieldName || getNameRole(names, "fieldName") || blackField.name || getNameRole(names, "name") || null;
    const memberNames = [
        blackField.cppName,
        blackField.member,
        blackField.memberPath,
        blackField.memberRoot,
        getNameRole(names, "cppName"),
        getNameRole(names, "member"),
        getNameRole(names, "memberPath"),
        getNameRole(names, "memberRoot")
    ].filter(Boolean);

    for (const memberName of memberNames)
    {
        const found = findFieldInfo(type, memberName, classMap, new Set());
        if (found) return found.field;
    }

    const memberNameSet = new Set(memberNames);

    let best = null;
    let bestScore = -1;
    for (let i = 0; i < fields.length; i++)
    {
        const field = fields[i];
        let score = 0;
        if (field.cppName && memberNameSet.has(field.cppName)) score += 20;
        if (field.name && field.name === fieldName) score += 10;
        if (field.fieldName && field.fieldName === fieldName) score += 10;
        if (isUsefulCppType(field.cppType)) score += 4;
        if (isUsefulCppType(field.cppType) && field.cppType === blackField.cppType) score += 3;
        if (field.jsType) score += 2;
        if (field.default) score += 1;

        if (score > bestScore)
        {
            best = field;
            bestScore = score;
        }
    }

    return bestScore > 0 ? best : null;
}

function isUsefulCppType(value)
{
    const text = String(value || "").trim();
    return !!text &&
        text !== "return" &&
        !text.endsWith("=") &&
        !/^(?:min|max)\s*=/.test(text);
}

function writeSchemaFiles(schema, outputRoot, readerName)
{
    const root = path.resolve(outputRoot);
    const files = [];
    const write = (relativePath, value, kind) =>
    {
        const file = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        files.push({ kind, path: relativePath.replace(/\\/g, "/") });
    };

    const kind = documentKind(schema);
    if (kind === "bundle")
    {
        write("index.json", schema.index, "rootIndex");
        write("enums.json", schema.enums, "enums");
        for (const family of schema.families)
        {
            write(path.join(family.name, "index.json"), family.index, "familyIndex");
            for (const type of family.classes)
            {
                write(path.join(family.name, `${type.blueClass || type.cppClass}.json`), type, "class");
            }
        }
    }
    else if (kind === "class")
    {
        const family = schema.family || "schema";
        write(path.join(family, `${schema.blueClass || schema.cppClass}.json`), schema, "class");
    }
    else if (kind === "familyIndex")
    {
        write(path.join(schema.family, "index.json"), schema, "familyIndex");
    }
    else if (kind === "enums")
    {
        write("enums.json", schema, "enums");
    }
    else if (kind === "rootIndex")
    {
        write("index.json", schema, "rootIndex");
    }
    else
    {
        throw new TypeError(`${readerName} cannot write unknown schema document`);
    }

    return {
        schema: SCHEMA_NAME,
        schemaVersion: schema.schemaVersion,
        outputRoot: root,
        files
    };
}

function writeBlackDefinitionFiles(definitions, outputRoot, readerName)
{
    const root = path.resolve(outputRoot);
    const files = [];
    const write = (relativePath, value, kind) =>
    {
        const file = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        files.push({ kind, path: relativePath.replace(/\\/g, "/") });
    };

    if (definitions.schema === BLACK_DEFINITIONS_SCHEMA_NAME && definitions.classes && typeof definitions.classes === "object")
    {
        write(blackDefinitionFileName(definitions), definitions, "blackSchema");
    }
    else if (definitions.className)
    {
        const singleClassDefinition = {
            schema: BLACK_DEFINITIONS_SCHEMA_NAME,
            version: BLACK_DEFINITIONS_SCHEMA_VERSION,
            generatedAt: null,
            enums: {},
            classes: { [definitions.className]: definitions.fields || {} }
        };
        write(blackDefinitionFileName(singleClassDefinition), singleClassDefinition, "blackSchema");
    }
    else
    {
        throw new TypeError(`${readerName} cannot write unknown Black definition document`);
    }

    return {
        schema: BLACK_DEFINITIONS_SCHEMA_NAME,
        schemaVersion: BLACK_DEFINITIONS_SCHEMA_VERSION,
        outputRoot: root,
        files
    };
}

function blackDefinitionFileName(definitions)
{
    const
        version = String(definitions.version || BLACK_DEFINITIONS_SCHEMA_VERSION).replace(/[^\w.-]/g, ""),
        date = blackDefinitionDate(definitions.generatedAt);

    return `black-schema-v${version}${date ? `-${date}` : ""}.json`;
}

function blackDefinitionDate(value)
{
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ""));
    return match ? match[1] : null;
}

export function toJsonValue(value, seen = new WeakSet())
{
    if (value === null || typeof value !== "object") return value;
    if (ArrayBuffer.isView(value)) return Array.from(value, item => toJsonValue(item, seen));
    if (Array.isArray(value)) return value.map(item => toJsonValue(item, seen));

    if (seen.has(value))
    {
        throw new TypeError("Reader.toJSON cannot convert circular data");
    }

    if (typeof value.toJSON === "function")
    {
        seen.add(value);
        const json = toJsonValue(value.toJSON(), seen);
        seen.delete(value);
        return json;
    }

    seen.add(value);
    const out = {};
    for (const key of Object.keys(value))
    {
        out[key] = toJsonValue(value[key], seen);
    }
    seen.delete(value);
    return out;
}
