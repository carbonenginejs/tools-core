import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

/** Writes one canonical JSON library and its deterministic gzip sibling. */
export class CjsToolLibraryArtifact
{

    static encode(value, { compact = false } = {})
    {
        const text = `${JSON.stringify(value, null, compact ? 0 : 2)}\n`;

        return new TextEncoder().encode(text);
    }

    static compress(jsonBytes, { gzipLevel = 9 } = {})
    {
        return gzipSync(jsonBytes, {
            level: gzipLevel,
            mtime: 0,
        });
    }

    static async write(filePath, value, options = {})
    {
        const jsonPath = path.resolve(filePath);

        if (path.extname(jsonPath).toLowerCase() !== ".json")
        {
            throw new TypeError(`Library artifact path must end in .json: ${filePath}`);
        }

        const gzipPath = `${jsonPath}.gz`;
        const json = this.encode(value, options);
        const gzip = this.compress(json, options);

        await Promise.all([
            WriteReplace(jsonPath, json),
            WriteReplace(gzipPath, gzip),
        ]);

        return Object.freeze({
            jsonPath,
            gzipPath,
            jsonBytes: json.byteLength,
            gzipBytes: gzip.byteLength,
        });
    }

}

async function WriteReplace(filePath, bytes)
{
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;

    try
    {
        await fs.writeFile(temporary, bytes, { flag: "wx" });

        try
        {
            await fs.rename(temporary, filePath);
        }
        catch (error)
        {
            if (![ "EEXIST", "EPERM" ].includes(error?.code))
            {
                throw error;
            }

            await fs.rm(filePath, { force: true });
            await fs.rename(temporary, filePath);
        }
    }
    finally
    {
        await fs.rm(temporary, { force: true });
    }
}
