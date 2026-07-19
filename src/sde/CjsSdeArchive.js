import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

import unzipper from "unzipper";

import { CjsSdeDatabase } from "./CjsSdeDatabase.js";
import * as utils from "../utils.js";

const DEFAULT_LATEST_URL =
    "https://developers.eveonline.com/static-data/tranquility/latest.jsonl";

const DEFAULT_ARCHIVE_URL_TEMPLATE =
    "https://developers.eveonline.com/static-data/tranquility/"
    + "eve-online-static-data-{build}-jsonl.zip";

const PREPARED_TABLES = Object.freeze([
    "types",
    "graphics",
    "skins",
    "skinMaterials",
    "skinLicenses",
    "materialSets",
    "graphicMaterialSets"
]);

const REQUIRED_TABLES = Object.freeze(PREPARED_TABLES.filter(name => name !== "materialSets"));

/** Acquires exact-build CCP JSONL archives and prepares CjsSde input tables. */
export class CjsSdeArchive
{

    #fetch;

    #latestUrl;

    #archiveUrlTemplate;

    #timeoutMs;

    /** Creates an archive reader with injectable network access for offline tests. */
    constructor(options = {})
    {
        this.#fetch = options.fetch ?? globalThis.fetch;
        this.#latestUrl = String(options.latestUrl ?? DEFAULT_LATEST_URL);
        this.#archiveUrlTemplate = String(
            options.archiveUrlTemplate ?? DEFAULT_ARCHIVE_URL_TEMPLATE
        );
        this.#timeoutMs = NormalizeTimeout(options.timeoutMs ?? 5 * 60 * 1000);

        if (typeof this.#fetch !== "function")
        {
            throw new TypeError("CjsSdeArchive requires a fetch implementation");
        }

        if (!this.#archiveUrlTemplate.includes("{build}"))
        {
            throw new TypeError("SDE archive URL template must contain {build}");
        }
    }

    /** Resolves CCP's latest metadata to one exact numeric SDE build. */
    async ResolveLatest()
    {
        const response = await this.#Fetch(this.#latestUrl);
        const text = await response.text();
        const records = ParseJsonLines(text, this.#latestUrl);
        const selected = records.find(record => record?._key === "sde") ?? records[0];
        const build = utils.normalizeExactBuildNumber(selected?.buildNumber, {
            message: `Invalid exact SDE build "${selected?.buildNumber}"`,
        });

        return Object.freeze({
            build,
            releaseDate: NormalizeOptionalText(selected?.releaseDate),
            source: this.#latestUrl
        });
    }

    /** Downloads and prepares the official archive for one exact numeric build. */
    async Prepare(options = {})
    {
        const build = utils.normalizeExactBuildNumber(options.build, {
            message: `Invalid exact SDE build "${options.build}"`,
        });
        const source = String(
            options.archiveUrl
            ?? this.#archiveUrlTemplate.replace("{build}", String(build))
        );
        const response = await this.#Fetch(source);

        return this.Read(response.body, {
            build,
            releaseDate: options.releaseDate,
            source
        });
    }

    /** Downloads every official table into one exact-build SQLite database. */
    async PrepareDatabase(options = {})
    {
        const build = utils.normalizeExactBuildNumber(options.build, {
            message: `Invalid exact SDE build "${options.build}"`,
        });
        const source = String(
            options.archiveUrl
            ?? this.#archiveUrlTemplate.replace("{build}", String(build))
        );
        const response = await this.#Fetch(source);

        return this.WriteDatabase(response.body, {
            ...options,
            build,
            source,
        });
    }

    /** Writes a caller-supplied official JSONL ZIP into an exact-build database. */
    async WriteDatabase(input, options = {})
    {
        if (!options.databasePath)
        {
            throw new TypeError("SDE database preparation requires databasePath");
        }

        const databasePath = path.resolve(String(options.databasePath));
        const importOptions = {
            build: utils.normalizeExactBuildNumber(options.build, {
                message: `Invalid exact SDE build "${options.build}"`,
            }),
            releaseDate: options.releaseDate,
            source: options.source,
        };

        if (!await FileExists(databasePath))
        {
            return WriteNewDatabase(input, databasePath, importOptions, false);
        }

        let database;

        try
        {
            database = await CjsSdeDatabase.open(databasePath, { readOnly: false });
        }
        catch
        {
            return WriteNewDatabase(input, databasePath, importOptions, true);
        }

        try
        {
            await database.Import(input, importOptions);

            return database;
        }
        catch (error)
        {
            await database.Close();
            throw error;
        }
    }

    /** Prepares CjsSde input from caller-supplied ZIP bytes or a readable body. */
    async Read(input, options = {})
    {
        const build = utils.normalizeExactBuildNumber(options.build, {
            message: `Invalid exact SDE build "${options.build}"`,
        });
        const source = NormalizeOptionalText(options.source);
        const tables = Object.fromEntries(PREPARED_TABLES.map(name => [ name, {} ]));
        const found = new Set();
        const archive = ToReadable(input).pipe(unzipper.Parse({ forceStream: true }));

        for await (const entry of archive)
        {
            const tableName = TableName(entry.path);

            if (!tableName || !PREPARED_TABLES.includes(tableName))
            {
                entry.autodrain();
                continue;
            }

            if (found.has(tableName))
            {
                entry.autodrain();
                throw new Error(`SDE archive contains duplicate table ${tableName}`);
            }

            found.add(tableName);
            tables[tableName] = await ReadTable(entry, tableName);
        }

        const missing = REQUIRED_TABLES.filter(name => !found.has(name));

        if (missing.length)
        {
            throw new Error(`SDE archive is missing required tables: ${missing.join(", ")}`);
        }

        return Object.freeze({
            schema: "carbon.sde.prepared",
            version: 1,
            build,
            source: source
                ? Object.freeze({ format: "ccp-jsonl-zip", url: source })
                : Object.freeze({ format: "ccp-jsonl-zip" }),
            releaseDate: NormalizeOptionalText(options.releaseDate),
            ...tables
        });
    }

    async #Fetch(url)
    {
        const controller = new AbortController();
        const timer = globalThis.setTimeout(() => controller.abort(), this.#timeoutMs);

        try
        {
            const response = await this.#fetch(url, { signal: controller.signal });

            if (!response?.ok)
            {
                throw new Error(
                    `SDE fetch failed for ${url} with status ${response?.status ?? "unknown"}`
                );
            }

            return response;
        }
        finally
        {
            globalThis.clearTimeout(timer);
        }
    }

}

async function WriteNewDatabase(input, databasePath, importOptions, replaceInvalid)
{
    const temporaryPath = `${databasePath}.${randomUUID()}.tmp`;
    const database = await CjsSdeDatabase.create(temporaryPath);

    try
    {
        await database.Import(input, importOptions);
        await database.Close();
        await InstallDatabase(temporaryPath, databasePath, replaceInvalid);

        return CjsSdeDatabase.open(databasePath, { readOnly: false });
    }
    catch (error)
    {
        await database.Close();
        throw error;
    }
    finally
    {
        await RemoveDatabaseFiles(temporaryPath);
    }
}

async function InstallDatabase(temporaryPath, databasePath, replaceInvalid)
{
    if (!replaceInvalid)
    {
        await fs.link(temporaryPath, databasePath);
        return;
    }

    const backupPath = `${databasePath}.${randomUUID()}.invalid`;
    let replaced = false;

    await fs.rename(databasePath, backupPath);

    try
    {
        await fs.rename(temporaryPath, databasePath);
        replaced = true;
    }
    catch (error)
    {
        await fs.rename(backupPath, databasePath);
        throw error;
    }
    finally
    {
        if (replaced)
        {
            await RemoveDatabaseFiles(backupPath);
        }
    }
}

async function RemoveDatabaseFiles(databasePath)
{
    await Promise.all([
        databasePath,
        `${databasePath}-journal`,
        `${databasePath}-shm`,
        `${databasePath}-wal`,
    ].map(filePath => fs.rm(filePath, { force: true })));
}

async function FileExists(filePath)
{
    try
    {
        await fs.access(filePath);
        return true;
    }
    catch (error)
    {
        if (error?.code === "ENOENT")
        {
            return false;
        }

        throw error;
    }
}

async function ReadTable(entry, tableName)
{
    const rows = {};
    const lines = createInterface({ input: entry, crlfDelay: Infinity });
    let lineNumber = 0;

    for await (const rawLine of lines)
    {
        lineNumber += 1;
        const line = rawLine.trim();

        if (!line)
        {
            continue;
        }

        let record;

        try
        {
            record = JSON.parse(line);
        }
        catch (error)
        {
            throw new Error(
                `Invalid JSON Lines record in ${tableName} at line ${lineNumber}: `
                + error.message
            );
        }

        const id = RecordId(record, tableName);

        if (Object.hasOwn(rows, id))
        {
            throw new Error(`Duplicate ${tableName} record ID ${id}`);
        }

        rows[id] = record;
    }

    return SortRecords(rows);
}

function SortRecords(records)
{
    return Object.fromEntries(Object.entries(records).sort(([ left ], [ right ]) =>
        left.localeCompare(right, "en", { numeric: true })
    ));
}

function RecordId(record, tableName)
{
    if (!record || typeof record !== "object" || Array.isArray(record))
    {
        throw new TypeError(`${tableName} JSON Lines entries must be objects`);
    }

    const value = record._key ?? record._recordId ?? record.id;
    const id = String(value ?? "").trim();

    if (!id)
    {
        throw new Error(`${tableName} record does not define _key`);
    }

    return id;
}

function TableName(value)
{
    const normalized = String(value ?? "").replaceAll("\\", "/");
    const fileName = normalized.split("/").pop();

    return fileName?.endsWith(".jsonl")
        ? fileName.slice(0, -".jsonl".length)
        : null;
}

function ToReadable(value)
{
    if (value instanceof Uint8Array || value instanceof ArrayBuffer)
    {
        return Readable.from([ Buffer.from(value) ]);
    }

    if (value && typeof value.pipe === "function")
    {
        return value;
    }

    if (value && typeof value.getReader === "function")
    {
        return Readable.fromWeb(value);
    }

    throw new TypeError("SDE archive input must be ZIP bytes or a readable body");
}

function ParseJsonLines(value, source)
{
    return String(value ?? "")
        .split(/\r?\n/gu)
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index) =>
        {
            try
            {
                return JSON.parse(line);
            }
            catch (error)
            {
                throw new Error(
                    `Invalid JSON Lines record in ${source} at line ${index + 1}: `
                    + error.message
                );
            }
        });
}

function NormalizeTimeout(value)
{
    const timeout = Number(value);

    if (!Number.isSafeInteger(timeout) || timeout <= 0)
    {
        throw new TypeError(`Invalid SDE timeout "${value}"`);
    }

    return timeout;
}

function NormalizeOptionalText(value)
{
    const text = String(value ?? "").trim();

    return text || null;
}

export { PREPARED_TABLES as CJS_SDE_PREPARED_TABLES };
