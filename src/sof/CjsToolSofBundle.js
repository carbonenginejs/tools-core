import { deflateSync } from "node:zlib";
import { CjsDdsFormat } from "@carbonenginejs/runtime-resource/formats/dds";

export const SOF_BUNDLE_SCHEMA = "carbon.sof-bundle";
export const SOF_BUNDLE_VERSION = 1;

const MESH_KINDS = new Set([ "Tr2Mesh", "Tr2InstancedMesh" ]);
const TEXTURE_KIND = "TriTextureParameter";
// BC5 stores only two channels; the decoded blue channel is zero and the
// normal's Z has to be reconstructed before a generic image consumer can use
// it (fourCC "ATI2", DXGI_FORMAT_BC5_UNORM/SNORM).
const TWO_CHANNEL_FOURCC = new Set([ "ATI2", "BC5U", "BC5S" ]);
const TWO_CHANNEL_DXGI = new Set([ 83, 84 ]);

/**
 * Writes one self-contained SOF bundle: the GPU-free carbon.document plus its
 * geometry and decoded textures, laid out for consumers that cannot run
 * Carbon shaders or decode BC7/BC5 payloads themselves (the Blender add-ons).
 */
export class CjsToolSofBundle
{

    #dds;

    #writeFile;

    constructor({ dds = new CjsDdsFormat(), writeFile } = {})
    {
        if (typeof writeFile !== "function")
        {
            throw new TypeError("CjsToolSofBundle requires a writeFile(relativePath, bytes) function");
        }

        this.#dds = dds;
        this.#writeFile = writeFile;
        Object.freeze(this);
    }

    /**
     * Builds one DNA and writes its complete bundle.
     *
     * @param {object} options Bundle inputs.
     * @param {object} options.catalog Opened CjsToolSofCatalog.
     * @param {object} options.source Composed exact-build index source.
     * @param {string} options.dna SOF DNA string.
     * @param {boolean} [options.convertTextures] Decode DDS payloads to PNG.
     * @returns {Promise<object>} The written manifest.
     */
    async Write({ catalog, source, dna, convertTextures = true, buildOptions = {} })
    {
        const document = await catalog.BuildDocumentAsync(dna, buildOptions);

        if (document === null)
        {
            throw new Error(`SOF DNA "${dna}" is not buildable for build ${catalog.build}`);
        }

        const geometry = CollectPaths(document, node => MESH_KINDS.has(node.kind)
            ? node.fields?.geometryResPath
            : null);
        const textures = CollectPaths(document, node => node.kind === TEXTURE_KIND
            ? node.fields?.resourcePath
            : null);

        const resources = {};
        const missing = [];

        for (const logicalPath of geometry)
        {
            const written = await this.#WriteResource(source, logicalPath, "geometry", false, missing);

            if (written) resources[logicalPath] = written;
        }

        for (const logicalPath of textures)
        {
            const written = await this.#WriteResource(source, logicalPath, "textures", convertTextures, missing);

            if (written) resources[logicalPath] = written;
        }

        await this.#writeFile("document.json", Buffer.from(JSON.stringify(document, null, 1), "utf8"));

        const manifest = {
            schema: SOF_BUNDLE_SCHEMA,
            version: SOF_BUNDLE_VERSION,
            target: catalog.target,
            provider: catalog.provider,
            build: catalog.build,
            dna,
            document: "document.json",
            texturesConverted: Boolean(convertTextures),
            resources,
            missing,
        };

        await this.#writeFile("bundle.json", Buffer.from(JSON.stringify(manifest, null, 1), "utf8"));

        return manifest;
    }

    async #WriteResource(source, logicalPath, directory, convert, missing)
    {
        let bytes;

        try
        {
            bytes = (await source.Fetch(logicalPath)).bytes;
        }
        catch (error)
        {
            missing.push({ logicalPath, reason: String(error?.message ?? error) });

            return null;
        }

        const relative = `${directory}/${ToRelativePath(logicalPath)}`;

        if (!convert || !logicalPath.toLowerCase().endsWith(".dds"))
        {
            await this.#writeFile(relative, Buffer.from(bytes));

            return relative;
        }

        try
        {
            const png = this.#ConvertTexture(bytes);
            const target = `${relative}.png`;

            await this.#writeFile(target, png);

            return target;
        }
        catch (error)
        {
            // A texture this decoder cannot read is still worth shipping raw;
            // the consumer decides whether it can use the original payload.
            missing.push({ logicalPath, reason: `decode failed: ${String(error?.message ?? error)}` });
            await this.#writeFile(relative, Buffer.from(bytes));

            return relative;
        }
    }

    #ConvertTexture(bytes)
    {
        const header = this.#dds.Inspect(bytes);
        const image = this.#dds.Read(bytes, { emit: "rgba" });
        const pixels = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);

        if (TWO_CHANNEL_FOURCC.has(String(header.fourCc ?? "")) || TWO_CHANNEL_DXGI.has(Number(header.dxgiFormat)))
        {
            RestoreNormalZ(pixels);
        }

        return EncodePng(pixels, image.width, image.height);
    }

}

function CollectPaths(document, select)
{
    const paths = [];
    const seen = new Set();

    for (const node of document.nodes ?? [])
    {
        const value = String(select(node) ?? "").trim();

        if (value && !seen.has(value))
        {
            seen.add(value);
            paths.push(value);
        }
    }

    return paths;
}

function ToRelativePath(logicalPath)
{
    const relative = String(logicalPath).replace(/^res:\/+/iu, "").replace(/\\/gu, "/");

    if (!relative || relative.includes("..") || relative.startsWith("/"))
    {
        throw new Error(`Unsafe resource path: ${logicalPath}`);
    }

    return relative;
}

/** Rebuilds the Z channel of a two-channel (BC5) tangent-space normal map. */
export function RestoreNormalZ(pixels)
{
    for (let offset = 0; offset < pixels.length; offset += 4)
    {
        const x = (pixels[offset] / 255) * 2 - 1;
        const y = (pixels[offset + 1] / 255) * 2 - 1;
        const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));

        pixels[offset + 2] = Math.round(((z + 1) / 2) * 255);
        pixels[offset + 3] = 255;
    }

    return pixels;
}

/** Encodes 8-bit RGBA pixels as a non-interlaced PNG. */
export function EncodePng(pixels, width, height)
{
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    {
        throw new TypeError("EncodePng requires positive integer dimensions");
    }

    if (pixels.length < width * height * 4)
    {
        throw new TypeError("EncodePng requires width * height * 4 bytes of RGBA data");
    }

    const raw = Buffer.allocUnsafe((width * 4 + 1) * height);

    for (let row = 0; row < height; row++)
    {
        const target = row * (width * 4 + 1);

        raw[target] = 0;
        pixels.copy
            ? pixels.copy(raw, target + 1, row * width * 4, (row + 1) * width * 4)
            : Buffer.from(pixels).copy(raw, target + 1, row * width * 4, (row + 1) * width * 4);
    }

    const header = Buffer.alloc(13);

    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;

    return Buffer.concat([
        Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]),
        Chunk("IHDR", header),
        Chunk("IDAT", deflateSync(raw, { level: 6 })),
        Chunk("IEND", Buffer.alloc(0)),
    ]);
}

function Chunk(type, data)
{
    const length = Buffer.alloc(4);

    length.writeUInt32BE(data.length, 0);

    const body = Buffer.concat([ Buffer.from(type, "ascii"), data ]);
    const crc = Buffer.alloc(4);

    crc.writeUInt32BE(Crc32(body), 0);

    return Buffer.concat([ length, body, crc ]);
}

function CreateCrcTable()
{
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index++)
    {
        let value = index;

        for (let bit = 0; bit < 8; bit++)
        {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }

        table[index] = value >>> 0;
    }

    return table;
}

const CRC_TABLE = CreateCrcTable();

function Crc32(buffer)
{
    let crc = 0xffffffff;

    for (const byte of buffer)
    {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    const result = crc ^ 0xffffffff;

    return result >>> 0;
}
