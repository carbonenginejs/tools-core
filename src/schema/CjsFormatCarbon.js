import {
    BLACK_DEFINITIONS_SCHEMA_NAME,
    BLACK_DEFINITIONS_SCHEMA_VERSION,
    CLASS_KEYS,
    SCHEMA_NAME,
    SCHEMA_VERSION
} from "./core/schema.js";
import {
    DEFAULT_VALUES,
    OUTPUT_JSON,
    OUTPUT_RAW,
    inspectWithValues,
    readWithValues,
    readBlackDefinitionsWithValues,
    normalizeValues,
    toJsonValue,
    validateClass,
    validateClassKey,
    writeBlackDefinitionsWithValues,
    writeWithValues
} from "./core/helpers.js";

const FORMAT_NAME = "CjsFormatCarbon";

/**
 * CarbonEngineJS-facing Carbon format profile.
 *
 * This package emits the current CarbonEngineJS schema document shape from
 * Carbon Blue scan reports or already-emitted schema JSON files.
 */
export class CjsFormatCarbon
{

    #emit = DEFAULT_VALUES.emit;
    #fieldResolutions = DEFAULT_VALUES.fieldResolutions;
    #schema = DEFAULT_VALUES.schema;
    #strictSchema = DEFAULT_VALUES.strictSchema;
    #version = DEFAULT_VALUES.version;
    #classes = {};

    /**
     * Create a reusable format profile.
     *
     * @param {object} [options] Default format values.
     */
    constructor(options = {})
    {
        this.SetValues(options);
    }

    /**
     * Set format values for this reusable profile.
     *
     * @param {object} [options] Values to merge into the profile.
     * @returns {CjsFormatCarbon} This format profile.
     */
    SetValues(options = {})
    {
        const values = normalizeValues(this.GetValues(), options, CLASS_KEYS, FORMAT_NAME);
        this.#emit = values.emit;
        this.#fieldResolutions = values.fieldResolutions;
        this.#schema = values.schema;
        this.#strictSchema = values.strictSchema;
        this.#version = values.version;
        this.#classes = values.classes;
        return this;
    }

    /**
     * Get this profile's current values, optionally with per-call overrides.
     *
     * @param {object} [options] Optional values to merge into a copy.
     * @returns {object} A copy of the effective values.
     */
    GetValues(options = {})
    {
        return normalizeValues({
            emit: this.#emit,
            fieldResolutions: this.#fieldResolutions,
            schema: this.#schema,
            strictSchema: this.#strictSchema,
            version: this.#version,
            classes: this.#classes
        }, options, CLASS_KEYS, FORMAT_NAME);
    }

    /**
     * Set multiple node-class constructors for this profile.
     *
     * @param {object} [classes] Map of node class keys to constructors.
     * @returns {CjsFormatCarbon} This format profile.
     */
    SetClasses(classes = {})
    {
        return this.SetValues({ classes });
    }

    /**
     * Set one node-class constructor for this profile.
     *
     * @param {string} type Node class key.
     * @param {Function|null|undefined} Class Constructor to use, or nullish to delete.
     * @returns {CjsFormatCarbon} This format profile.
     */
    SetClass(type, Class)
    {
        validateClassKey(CLASS_KEYS, type, FORMAT_NAME);
        if (Class === null || Class === undefined)
        {
            delete this.#classes[type];
            return this;
        }

        validateClass(CLASS_KEYS, type, Class, FORMAT_NAME);
        this.#classes = { ...this.#classes, [type]: Class };
        return this;
    }

    /**
     * Get a configured node-class constructor.
     *
     * @param {string} type Node class key.
     * @returns {Function|undefined} The registered constructor, if any.
     */
    GetClass(type)
    {
        validateClassKey(CLASS_KEYS, type, FORMAT_NAME);
        return this.#classes[type];
    }

    /**
     * Whether this format profile has a constructor registered for a node key.
     *
     * @param {string} type Node class key.
     * @returns {boolean} True when a constructor is registered.
     */
    HasClass(type)
    {
        return !!this.GetClass(type);
    }

    /**
     * Read Carbon data with this profile's values.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report,
     * emitted schema JSON object, JSON text, UTF-8 bytes, or a JSON file path.
     * @param {object} [options] Per-call value overrides.
     * @returns {object} Canonical schema output.
     */
    Read(input, options = {})
    {
        return CjsFormatCarbon.read(input, this.GetValues(options));
    }

    /**
     * Inspect Carbon data with this profile's values.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report,
     * emitted schema JSON object, JSON text, UTF-8 bytes, or a JSON file path.
     * @param {object} [options] Per-call value overrides.
     * @returns {object} Plain summary data.
     */
    Inspect(input, options = {})
    {
        return CjsFormatCarbon.inspect(input, this.GetValues(options));
    }

    /**
     * Write emitted schema JSON files to disk.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report
     * or emitted schema document.
     * @param {string} outputRoot Output directory.
     * @param {object} [options] Per-call value overrides.
     * @returns {object} Write manifest.
     */
    Write(input, outputRoot, options = {})
    {
        return CjsFormatCarbon.write(input, outputRoot, this.GetValues(options));
    }

    /**
     * Project Carbon schemas to the Black/public-facing definition surface.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report,
     * emitted schema document, or emitted schema directory.
     * @param {object} [options] Per-call value overrides.
     * @returns {object} Black definition output.
     */
    ReadBlackDefinitions(input, options = {})
    {
        return CjsFormatCarbon.readBlackDefinitions(input, this.GetValues(options));
    }

    /**
     * Write Black/public-facing definition JSON files to disk.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report,
     * emitted schema document, or emitted schema directory.
     * @param {string} outputRoot Output directory.
     * @param {object} [options] Per-call value overrides.
     * @returns {object} Write manifest.
     */
    WriteBlackDefinitions(input, outputRoot, options = {})
    {
        return CjsFormatCarbon.writeBlackDefinitions(input, outputRoot, this.GetValues(options));
    }

    /**
     * Convert format output to JSON-compatible data.
     *
     * @param {any} value Format output to convert.
     * @returns {any} Plain JSON-compatible data.
     */
    ToJSON(value)
    {
        return toJsonValue(value);
    }

    /**
     * Static one-shot read. Static methods use camelCase by convention.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report,
     * emitted schema JSON object, JSON text, UTF-8 bytes, or a JSON file path.
     * @param {object} [options] Format values.
     * @returns {object} Canonical schema output.
     */
    static read(input, options = {})
    {
        return readWithValues(input, normalizeValues(DEFAULT_VALUES, options, CLASS_KEYS, FORMAT_NAME), FORMAT_NAME);
    }

    /**
     * Static one-shot inspection.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report,
     * emitted schema JSON object, JSON text, UTF-8 bytes, or a JSON file path.
     * @param {object} [options] Format values.
     * @returns {object} Plain summary data.
     */
    static inspect(input, options = {})
    {
        return inspectWithValues(input, normalizeValues(DEFAULT_VALUES, options, CLASS_KEYS, FORMAT_NAME), FORMAT_NAME);
    }

    /**
     * Static one-shot schema writer.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report
     * or emitted schema document.
     * @param {string} outputRoot Output directory.
     * @param {object} [options] Format values.
     * @returns {object} Write manifest.
     */
    static write(input, outputRoot, options = {})
    {
        return writeWithValues(input, outputRoot, normalizeValues(DEFAULT_VALUES, options, CLASS_KEYS, FORMAT_NAME), FORMAT_NAME);
    }

    /**
     * Static one-shot Black definition projection.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report,
     * emitted schema document, or emitted schema directory.
     * @param {object} [options] Format values.
     * @returns {object} Black definition output.
     */
    static readBlackDefinitions(input, options = {})
    {
        return readBlackDefinitionsWithValues(input, normalizeValues(DEFAULT_VALUES, options, CLASS_KEYS, FORMAT_NAME), FORMAT_NAME);
    }

    /**
     * Static one-shot Black definition writer.
     *
     * @param {object|string|Uint8Array|ArrayBuffer|DataView} input Carbon Blue scan report,
     * emitted schema document, or emitted schema directory.
     * @param {string} outputRoot Output directory.
     * @param {object} [options] Format values.
     * @returns {object} Write manifest.
     */
    static writeBlackDefinitions(input, outputRoot, options = {})
    {
        return writeBlackDefinitionsWithValues(input, outputRoot, normalizeValues(DEFAULT_VALUES, options, CLASS_KEYS, FORMAT_NAME), FORMAT_NAME);
    }

    /**
     * Static JSON-compatible conversion.
     *
     * @param {any} value Format output to convert.
     * @returns {any} Plain JSON-compatible data.
     */
    static toJSON(value)
    {
        return toJsonValue(value);
    }

    static OUTPUT_JSON = OUTPUT_JSON;
    static OUTPUT_RAW = OUTPUT_RAW;
    static SCHEMA_NAME = SCHEMA_NAME;
    static SCHEMA_VERSION = SCHEMA_VERSION;
    static BLACK_DEFINITIONS_SCHEMA_NAME = BLACK_DEFINITIONS_SCHEMA_NAME;
    static BLACK_DEFINITIONS_SCHEMA_VERSION = BLACK_DEFINITIONS_SCHEMA_VERSION;
    static CLASS_KEYS = CLASS_KEYS;
    static type = Object.freeze([ "schema" ]);
    static mediaTypes = Object.freeze([ "schema" ]);
    static inputTypes = Object.freeze([ "json" ]);
    static outputTypes = Object.freeze([ OUTPUT_JSON ]);
    static debugOutputTypes = Object.freeze([ OUTPUT_RAW ]);

}

export default CjsFormatCarbon;
