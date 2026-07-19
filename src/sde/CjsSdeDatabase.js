import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

import Database from "better-sqlite3";
import unzipper from "unzipper";
import * as utils from "../utils.js";

const DATABASE_SCHEMA = "carbon.sde.sqlite";
const DATABASE_VERSION = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;
const TableNamePattern = /^[A-Za-z0-9_]+$/u;
const FieldNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const RECORD_ORDER = "CASE WHEN record_id NOT GLOB '*[^0-9]*' "
    + "THEN 0 ELSE 1 END, CAST(record_id AS INTEGER), record_id";

/** Exact-build SQLite store for every table in an official EVE SDE archive. */
export class CjsSdeDatabase
{

    #database;

    #readOnly;

    constructor(database, filePath, readOnly)
    {
        this.#database = database;
        this.filePath = path.resolve(filePath);
        this.#readOnly = readOnly;
    }

    /** Opens an existing database and verifies the tools-core schema. */
    static async open(filePath, options = {})
    {
        const readOnly = options.readOnly !== false;
        const database = OpenDatabase(filePath, { readOnly });
        const result = new this(database, filePath, readOnly);

        try
        {
            await result.#Verify();

            return result;
        }
        catch (error)
        {
            await result.Close();
            throw error;
        }
    }

    /** Creates or opens a writable database ready for an atomic archive import. */
    static async create(filePath)
    {
        const resolved = path.resolve(filePath);

        await fs.mkdir(path.dirname(resolved), { recursive: true });

        const database = OpenDatabase(resolved);
        const result = new this(database, resolved, false);

        try
        {
            await result.#Initialize();

            return result;
        }
        catch (error)
        {
            await result.Close();
            throw error;
        }
    }

    /** Replaces the current contents from one exact-build official JSONL ZIP. */
    async Import(input, options = {})
    {
        if (this.#readOnly)
        {
            throw new Error("Cannot import an SDE archive into a read-only database");
        }

        const metadata = NormalizeImportMetadata(options);
        const archive = ToReadable(input).pipe(unzipper.Parse({ forceStream: true }));
        const found = new Set();
        const tables = [];

        await Run(this.#database, "BEGIN IMMEDIATE");

        try
        {
            await Run(this.#database, "DELETE FROM sde_rows");
            await Run(this.#database, "DELETE FROM sde_tables");
            await Run(this.#database, "DELETE FROM sde_metadata");

            for await (const entry of archive)
            {
                const tableName = TableName(entry.path);

                if (!tableName)
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

                const rowCount = await this.#ImportTable(entry, tableName);

                tables.push(Object.freeze({ name: tableName, rowCount }));
            }

            if (!tables.length)
            {
                throw new Error("SDE archive does not contain JSONL tables");
            }

            for (const [ key, value ] of Object.entries(metadata))
            {
                await Run(
                    this.#database,
                    "INSERT INTO sde_metadata (key, value) VALUES (?, ?)",
                    [ key, JSON.stringify(value) ],
                );
            }

            await Run(this.#database, "COMMIT");
        }
        catch (error)
        {
            try
            {
                Run(this.#database, "ROLLBACK");
            }
            catch
            {
                // Preserve the original import failure.
            }

            throw error;
        }

        tables.sort((left, right) => left.name.localeCompare(right.name, "en"));

        return Object.freeze({
            ...metadata,
            tables: Object.freeze(tables),
        });
    }

    /** Returns exact source metadata and the complete table catalog. */
    async Describe()
    {
        const metadata = await this.GetMetadata();
        const tables = await this.ListTables();

        return Object.freeze({ ...metadata, tables });
    }

    /** Returns the exact-build metadata stored with the imported archive. */
    async GetMetadata()
    {
        const rows = await All(
            this.#database,
            "SELECT key, value FROM sde_metadata ORDER BY key",
        );
        const metadata = {};

        for (const row of rows)
        {
            metadata[row.key] = ParseStoredJson(row.value, `metadata ${row.key}`);
        }

        return Object.freeze(metadata);
    }

    /** Lists every imported table and its exact row count. */
    async ListTables()
    {
        const rows = await All(
            this.#database,
            "SELECT name, row_count AS rowCount FROM sde_tables ORDER BY name",
        );

        return Object.freeze(rows.map(row => Object.freeze({
            name: row.name,
            rowCount: Number(row.rowCount),
        })));
    }

    /** Returns whether an official table is present in this build. */
    async HasTable(name)
    {
        const tableName = NormalizeTableName(name);
        const row = await Get(
            this.#database,
            "SELECT 1 AS present FROM sde_tables WHERE name = ?",
            [ tableName ],
        );

        return Boolean(row);
    }

    /** Returns a minimal wrapper over one official table. */
    Table(name)
    {
        return new CjsSdeTable(this.#database, NormalizeTableName(name));
    }

    /** Loads selected tables into the existing in-memory CjsSde input shape. */
    async LoadTables(names)
    {
        if (!Array.isArray(names) || !names.length)
        {
            throw new TypeError("SDE table load requires at least one table name");
        }

        const metadata = await this.GetMetadata();
        const output = { build: metadata.build };

        for (const name of names.map(NormalizeTableName))
        {
            const rows = await All(
                this.#database,
                "SELECT record_id AS id, payload FROM sde_rows "
                    + `WHERE table_name = ? ORDER BY ${RECORD_ORDER}`,
                [ name ],
            );

            output[name] = Object.fromEntries(rows.map(row => [
                row.id,
                ParseStoredJson(row.payload, `${name} ${row.id}`),
            ]));
        }

        return output;
    }

    /** Closes the SQLite handle. */
    async Close()
    {
        if (!this.#database)
        {
            return;
        }

        const database = this.#database;

        this.#database = null;
        await CloseDatabase(database);
    }

    async #Initialize()
    {
        await Run(this.#database, "PRAGMA foreign_keys = ON");
        await Run(this.#database, `PRAGMA user_version = ${DATABASE_VERSION}`);
        await Run(this.#database, `
            CREATE TABLE IF NOT EXISTS sde_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);
        await Run(this.#database, `
            CREATE TABLE IF NOT EXISTS sde_tables (
                name TEXT PRIMARY KEY,
                row_count INTEGER NOT NULL
            )
        `);
        await Run(this.#database, `
            CREATE TABLE IF NOT EXISTS sde_rows (
                table_name TEXT NOT NULL,
                record_id TEXT NOT NULL,
                search_name TEXT,
                payload TEXT NOT NULL,
                PRIMARY KEY (table_name, record_id),
                FOREIGN KEY (table_name) REFERENCES sde_tables(name) ON DELETE CASCADE
            )
        `);
        await Run(this.#database, `
            CREATE INDEX IF NOT EXISTS sde_rows_search_name
            ON sde_rows (table_name, search_name)
        `);
    }

    async #Verify()
    {
        const version = await Get(this.#database, "PRAGMA user_version");

        if (Number(version?.user_version) !== DATABASE_VERSION)
        {
            throw new Error(
                `Unsupported SDE database version ${version?.user_version ?? "unknown"}`,
            );
        }

        const metadata = await this.GetMetadata();

        if (metadata.schema !== DATABASE_SCHEMA)
        {
            throw new Error(`Unsupported SDE database schema ${metadata.schema ?? "unknown"}`);
        }
    }

    async #ImportTable(entry, tableName)
    {
        await Run(
            this.#database,
            "INSERT INTO sde_tables (name, row_count) VALUES (?, 0)",
            [ tableName ],
        );

        const statement = await Prepare(this.#database, `
            INSERT INTO sde_rows (table_name, record_id, search_name, payload)
            VALUES (?, ?, ?, ?)
        `);
        const lines = createInterface({ input: entry, crlfDelay: Infinity });
        let lineNumber = 0;
        let rowCount = 0;

        try
        {
            for await (const rawLine of lines)
            {
                lineNumber += 1;

                const line = rawLine.trim();

                if (!line)
                {
                    continue;
                }

                const record = ParseRecord(line, tableName, lineNumber);
                const recordID = RecordId(record, lineNumber);

                StatementRun(statement, [
                    tableName,
                    recordID,
                    SearchName(record),
                    JSON.stringify(record),
                ]);
                rowCount += 1;
            }
        }
        finally
        {
            await Finalize(statement);
        }

        await Run(
            this.#database,
            "UPDATE sde_tables SET row_count = ? WHERE name = ?",
            [ rowCount, tableName ],
        );

        return rowCount;
    }

}

/** Minimal paginated interface over one official EVE SDE table. */
export class CjsSdeTable
{

    #database;

    constructor(database, name)
    {
        this.#database = database;
        this.name = name;
        Object.freeze(this);
    }

    /** Returns the table row count, or null when the table is absent. */
    async Count()
    {
        const row = await Get(
            this.#database,
            "SELECT row_count AS rowCount FROM sde_tables WHERE name = ?",
            [ this.name ],
        );

        return row ? Number(row.rowCount) : null;
    }

    /** Returns one record by its official key, or null when absent. */
    async Get(id)
    {
        const recordID = NormalizeRecordId(id);
        const row = await Get(
            this.#database,
            "SELECT record_id AS id, payload FROM sde_rows "
                + "WHERE table_name = ? AND record_id = ?",
            [ this.name, recordID ],
        );

        return row ? SerializeRow(this.name, row) : null;
    }

    /** Lists one deterministic page in official record-key order. */
    async List(options = {})
    {
        const { limit, offset } = NormalizePage(options);
        const rows = await All(
            this.#database,
            "SELECT record_id AS id, payload FROM sde_rows "
                + `WHERE table_name = ? ORDER BY ${RECORD_ORDER} LIMIT ? OFFSET ?`,
            [ this.name, limit, offset ],
        );

        return Object.freeze(rows.map(row => SerializeRow(this.name, row)));
    }

    /** Searches common name fields and raw JSON without table-specific schema. */
    async Search(query, options = {})
    {
        const text = String(query ?? "").trim().toLocaleLowerCase("en-US");

        if (!text)
        {
            throw new TypeError("SDE table search query must be non-empty");
        }

        const { limit, offset } = NormalizePage(options);
        const pattern = `%${EscapeLike(text)}%`;
        const rows = await All(
            this.#database,
            "SELECT record_id AS id, payload FROM sde_rows "
                + "WHERE table_name = ? AND (search_name LIKE ? ESCAPE '\\' "
                + "OR lower(payload) LIKE ? ESCAPE '\\') "
                + `ORDER BY ${RECORD_ORDER} LIMIT ? OFFSET ?`,
            [ this.name, pattern, pattern, limit, offset ],
        );

        return Object.freeze(rows.map(row => SerializeRow(this.name, row)));
    }

    /** Filters a scalar field or JSON array without requiring a table schema. */
    async Find(field, value, options = {})
    {
        const jsonPath = NormalizeJsonPath(field);
        const expected = NormalizeFilterValue(value);
        const { limit, offset } = NormalizePage(options);
        const contains = options.contains === true;
        const predicate = contains
            ? "EXISTS (SELECT 1 FROM json_each(sde_rows.payload, ?) AS item "
                + "WHERE CAST(item.value AS TEXT) = ?)"
            : "CAST(json_extract(payload, ?) AS TEXT) = ?";
        const rows = await All(
            this.#database,
            "SELECT record_id AS id, payload FROM sde_rows "
                + `WHERE table_name = ? AND ${predicate} `
                + `ORDER BY ${RECORD_ORDER} LIMIT ? OFFSET ?`,
            [ this.name, jsonPath, expected, limit, offset ],
        );

        return Object.freeze(rows.map(row => SerializeRow(this.name, row)));
    }

}

function NormalizeImportMetadata(options)
{
    const build = utils.normalizeExactBuildNumber(options.build, {
        message: `Invalid exact SDE build "${options.build}"`,
    });

    return Object.freeze({
        schema: DATABASE_SCHEMA,
        version: DATABASE_VERSION,
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build,
        releaseDate: NormalizeOptionalText(options.releaseDate),
        source: NormalizeSource(options.source),
    });
}

function NormalizeSource(value)
{
    if (value && typeof value === "object" && !Array.isArray(value))
    {
        return Object.freeze({ ...value });
    }

    const url = NormalizeOptionalText(value);

    return Object.freeze({
        format: "ccp-jsonl-zip",
        ...(url ? { url } : {}),
    });
}

function NormalizeOptionalText(value)
{
    const text = String(value ?? "").trim();

    return text || null;
}

function TableName(value)
{
    const normalized = String(value ?? "").replaceAll("\\", "/");
    const fileName = normalized.split("/").pop();

    return fileName?.endsWith(".jsonl")
        ? NormalizeTableName(fileName.slice(0, -".jsonl".length))
        : null;
}

function NormalizeTableName(value)
{
    const name = String(value ?? "").trim();

    if (!TableNamePattern.test(name))
    {
        throw new TypeError(`Invalid SDE table name "${value}"`);
    }

    return name;
}

function NormalizeRecordId(value)
{
    const id = String(value ?? "").trim();

    if (!id)
    {
        throw new TypeError("SDE record ID must be non-empty");
    }

    return id;
}

function NormalizeJsonPath(value)
{
    const fields = String(value ?? "").trim().split(".");

    if (!fields.length || fields.some(field => !FieldNamePattern.test(field)))
    {
        throw new TypeError(`Invalid SDE field path "${value}"`);
    }

    return `$${fields.map(field => `."${field}"`).join("")}`;
}

function NormalizeFilterValue(value)
{
    if (value === true || String(value).toLowerCase() === "true")
    {
        return "1";
    }

    if (value === false || String(value).toLowerCase() === "false")
    {
        return "0";
    }

    const normalized = String(value ?? "").trim();

    if (!normalized)
    {
        throw new TypeError("SDE field filter value must be non-empty");
    }

    return normalized;
}

function ParseRecord(value, tableName, lineNumber)
{
    try
    {
        const record = JSON.parse(value);

        if (!record || typeof record !== "object" || Array.isArray(record))
        {
            throw new TypeError("record must be an object");
        }

        return record;
    }
    catch (error)
    {
        throw new Error(
            `Invalid JSON Lines record in ${tableName} at line ${lineNumber}: ${error.message}`,
        );
    }
}

function RecordId(record, lineNumber)
{
    return NormalizeRecordId(
        record._key
        ?? record._recordId
        ?? record.id
        ?? lineNumber,
    );
}

function SearchName(record)
{
    const value = record.name
        ?? record.typeName
        ?? record.internalName
        ?? record.displayName
        ?? null;

    if (value && typeof value === "object" && !Array.isArray(value))
    {
        return NormalizeOptionalText(
            value.en
            ?? value.enUS
            ?? value.en_us
            ?? Object.values(value)[0],
        )?.toLocaleLowerCase("en-US") ?? null;
    }

    return NormalizeOptionalText(value)?.toLocaleLowerCase("en-US") ?? null;
}

function NormalizePage(options)
{
    const limit = Number(options.limit ?? DEFAULT_PAGE_SIZE);
    const offset = Number(options.offset ?? 0);

    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE)
    {
        throw new TypeError(`SDE page limit must be between 1 and ${MAX_PAGE_SIZE}`);
    }

    if (!Number.isSafeInteger(offset) || offset < 0)
    {
        throw new TypeError("SDE page offset must be a non-negative integer");
    }

    return { limit, offset };
}

function EscapeLike(value)
{
    return value.replace(/[\\%_]/gu, match => `\\${match}`);
}

function SerializeRow(table, row)
{
    return Object.freeze({
        table,
        id: String(row.id),
        payload: ParseStoredJson(row.payload, `${table} ${row.id}`),
    });
}

function ParseStoredJson(value, label)
{
    try
    {
        return JSON.parse(value);
    }
    catch (error)
    {
        throw new Error(`Invalid stored JSON for ${label}: ${error.message}`);
    }
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

function OpenDatabase(filePath, options = {})
{
    return new Database(filePath, {
        readonly: options.readOnly === true,
        fileMustExist: options.readOnly === true,
    });
}

function CloseDatabase(database)
{
    database.close();
}

function Run(database, sql, parameters = [])
{
    return database.prepare(sql).run(...parameters);
}

function Get(database, sql, parameters = [])
{
    return database.prepare(sql).get(...parameters) ?? null;
}

function All(database, sql, parameters = [])
{
    return database.prepare(sql).all(...parameters);
}

function Prepare(database, sql)
{
    return database.prepare(sql);
}

function StatementRun(statement, parameters)
{
    return statement.run(...parameters);
}

function Finalize(_statement)
{
    // better-sqlite3 statements are finalized with their owning connection.
}

export {
    DATABASE_SCHEMA as CJS_SDE_DATABASE_SCHEMA,
    DATABASE_VERSION as CJS_SDE_DATABASE_VERSION,
};
