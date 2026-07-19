import { CjsIndexEntry } from "../indexing/CjsIndexEntry.js";
import { CjsShaderTargetRegistry } from "./CjsShaderTargetRegistry.js";

/** Builds a deterministic exact-build source inventory for one shader target. */
export function buildShaderTargetCatalog(
{
    shaderTarget,
    build,
    indexEntries,
    generatedAt = null,
    shaderTargets = new CjsShaderTargetRegistry(),
} = {})
{
    if (!Array.isArray(indexEntries))
    {
        throw new TypeError("Shader target catalog indexEntries must be an array");
    }

    const target = shaderTargets.Get(shaderTarget);
    const matching = indexEntries
        .map((entry) => CjsIndexEntry.from(entry))
        .filter((entry) => target.SupportsSourcePath(entry.logicalPath));

    if (!matching.length)
    {
        throw new Error(`Shader target ${target.id} has no matching source resources`);
    }

    const plan = target.CreateCatalog(matching.map((entry) => entry.logicalPath), { build });
    const records = new Map(matching.map((entry) => [ entry.logicalPath, entry ]));
    const entries = plan.entries.map((entry) =>
    {
        const record = records.get(entry.sourcePath);

        return Object.freeze({
            sourcePath: entry.sourcePath,
            plannedOutputPath: entry.outputPath,
            storagePath: record.location,
            checksum: record.checksum,
            uncompressedSize: record.uncompressedSize,
            compressedSize: record.compressedSize,
        });
    });

    return Object.freeze({
        schema: "carbon.shader-target-catalog",
        version: 1,
        generatedAt: generatedAt === null ? null : normalizeTimestamp(generatedAt),
        status: "source-inventory",
        shaderTarget: plan.id,
        target: plan.target,
        game: plan.game,
        provider: plan.provider,
        client: plan.client,
        build: plan.build,
        format: plan.format,
        sourceProfile: plan.sourceProfile,
        outputProfile: plan.outputProfile,
        overlay: plan.overlay,
        sourceCount: entries.length,
        entries: Object.freeze(entries),
    });
}

function normalizeTimestamp(value)
{
    const date = new Date(value);

    if (!Number.isFinite(date.getTime()))
    {
        throw new TypeError(`Invalid shader catalog timestamp: ${value}`);
    }

    return date.toISOString();
}
