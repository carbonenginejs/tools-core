import { normalizeLogicalPath } from "../indexing/CjsIndexEntry.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import { normalizeTargetId } from "../target/CjsToolTarget.js";
import * as utils from "../utils.js";

const ProfilePattern = /^effect\.[a-z0-9][a-z0-9._-]*$/u;

/** Immutable compiled-shader target over one public game target and profile. */
export class CjsShaderTarget
{

    constructor(data)
    {
        if (!data || typeof data !== "object" || Array.isArray(data))
        {
            throw new TypeError("Shader target must be an object");
        }

        this.id = normalizeTargetId(data.id);
        this.target = normalizeTargetId(data.target);
        this.format = normalizeFormat(data.format);
        this.sourceProfile = normalizeProfile(data.sourceProfile);
        this.outputProfile = normalizeProfile(data.outputProfile);
        this.qualityTiers = Object.freeze(normalizeQualityTiers(data.qualityTiers));
        this.sourceFamilies = Object.freeze(normalizeSourceFamilies(data.sourceFamilies));
        this.selectionPolicy = utils.freezeData(normalizeSelectionPolicy(data.selectionPolicy));
        this.qualificationPolicy = utils.freezeData(
            normalizeQualificationPolicy(data.qualificationPolicy),
        );
        this.overlay = normalizeTargetId(data.overlay ?? this.outputProfile);

        if (this.sourceProfile === this.outputProfile)
        {
            throw new TypeError("Shader target source and output profiles must differ");
        }

        if (this.target === "frontier" && this.format === "CEWGPU"
            && (this.qualificationPolicy.level !== "native-hlslcc"
                || this.qualificationPolicy.nativeComparison !== "required"))
        {
            throw new TypeError(
                "Frontier WebGPU targets must require native HLSLcc comparison",
            );
        }

        Object.freeze(this);
    }

    /** Checks whether an exact source path belongs to this audited target. */
    SupportsSourcePath(value)
    {
        try
        {
            this.MapSourcePath(value);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /** Maps one source effect to the disjoint compiled output profile. */
    MapSourcePath(value)
    {
        const logicalPath = normalizeLogicalPath(value);
        const sourceRoot = `res:/graphics/${this.sourceProfile}/`;

        if (!logicalPath.startsWith(sourceRoot))
        {
            throw new Error(`Shader source is outside ${this.sourceProfile}: ${logicalPath}`);
        }

        const tierMatch = logicalPath.match(/\.sm_([a-z0-9_]+)$/u);
        const qualityTier = tierMatch?.[1] ?? null;

        if (!qualityTier || !this.qualityTiers.includes(qualityTier))
        {
            throw new Error(`Shader source quality is not audited for ${this.id}: ${logicalPath}`);
        }

        return `res:/graphics/${this.outputProfile}/${logicalPath.slice(sourceRoot.length)}`;
    }

    /**
     * Catalogs exact source/output paths without performing conversion.
     * The format package remains the owner of CEWG generation.
     */
    CreateCatalog(sourcePaths, { build, targets = new CjsToolTargetRegistry() } = {})
    {
        if (!Array.isArray(sourcePaths) || !sourcePaths.length)
        {
            throw new TypeError("Shader target catalog requires source paths");
        }

        const exactBuild = utils.normalizeExactBuild(build, {
            message: `Shader target catalog requires an exact build: ${build}`,
        });

        const toolTarget = targets.RequireLibrary(this.target, "shader");
        const entries = [];
        const seen = new Set();

        for (const value of sourcePaths)
        {
            const sourcePath = normalizeLogicalPath(value);
            if (seen.has(sourcePath))
            {
                throw new Error(`Duplicate shader target source: ${sourcePath}`);
            }

            seen.add(sourcePath);
            entries.push(Object.freeze({
                sourcePath,
                outputPath: this.MapSourcePath(sourcePath),
            }));
        }

        entries.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

        return Object.freeze({
            id: this.id,
            target: toolTarget.id,
            game: toolTarget.game,
            provider: toolTarget.provider,
            client: toolTarget.client,
            build: exactBuild,
            format: this.format,
            sourceProfile: this.sourceProfile,
            outputProfile: this.outputProfile,
            sourceFamilies: this.sourceFamilies,
            selectionPolicy: this.selectionPolicy,
            qualificationPolicy: this.qualificationPolicy,
            overlay: `${this.overlay}-${exactBuild}`,
            entries: Object.freeze(entries),
        });
    }

    /** Catalogs index resolutions only after their target/build identity agrees. */
    CreateCatalogFromResolutions(resolutions, { targets = new CjsToolTargetRegistry() } = {})
    {
        if (!Array.isArray(resolutions) || !resolutions.length)
        {
            throw new TypeError("Shader target catalog requires index resolutions");
        }

        const toolTarget = targets.RequireLibrary(this.target, "shader");
        let exactBuild = null;
        const sourcePaths = [];

        for (const resolution of resolutions)
        {
            if (!resolution || typeof resolution !== "object" || Array.isArray(resolution))
            {
                throw new TypeError("Shader target index resolution must be an object");
            }

            const sourceTarget = normalizeTargetId(resolution.target);
            const sourceBuild = utils.normalizeExactBuild(resolution.build, {
                message: `Shader source requires an exact build: ${resolution.build}`,
            });

            if (sourceTarget !== toolTarget.id
                || String(resolution.game) !== toolTarget.game
                || String(resolution.provider).toLowerCase() !== toolTarget.provider)
            {
                throw new Error(
                    `Shader source identity does not match target ${toolTarget.id}: ` +
                    `${resolution.target}/${resolution.game}/${resolution.provider}`,
                );
            }

            if (exactBuild !== null && sourceBuild !== exactBuild)
            {
                throw new Error(`Shader source builds are mixed: ${exactBuild} and ${sourceBuild}`);
            }

            exactBuild = sourceBuild;
            sourcePaths.push(resolution.logicalPath);
        }

        return this.CreateCatalog(sourcePaths, { build: exactBuild, targets });
    }

    toJSON()
    {
        return {
            id: this.id,
            target: this.target,
            format: this.format,
            sourceProfile: this.sourceProfile,
            outputProfile: this.outputProfile,
            qualityTiers: this.qualityTiers,
            sourceFamilies: this.sourceFamilies,
            selectionPolicy: this.selectionPolicy,
            qualificationPolicy: this.qualificationPolicy,
            overlay: this.overlay,
        };
    }

    static from(value)
    {
        return value instanceof this ? value : new this(value);
    }

}

function normalizeFormat(value)
{
    const format = String(value ?? "").trim().toUpperCase();

    if (![ "CEWG", "CEWGPU" ].includes(format))
    {
        throw new TypeError(`Unsupported shader target format: ${value}`);
    }

    return format;
}

function normalizeSourceFamilies(value)
{
    if (!Array.isArray(value) || !value.length)
    {
        throw new TypeError("Shader target sourceFamilies must be a non-empty array");
    }

    return [ ...new Set(value.map((family) =>
    {
        const normalized = String(family ?? "").trim().toLowerCase();

        if (!/^[a-z0-9][a-z0-9._-]*$/u.test(normalized))
        {
            throw new TypeError(`Invalid shader source family: ${family}`);
        }

        return normalized;
    })) ].sort();
}

function normalizeSelectionPolicy(value)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("Shader target selectionPolicy must be an object");
    }

    const permutationMode = String(value.permutationMode ?? "all").trim().toLowerCase();
    const sourceFamily = String(value.sourceFamily ?? "").trim().toLowerCase();

    if (![ "all", "selected" ].includes(permutationMode))
    {
        throw new TypeError(`Invalid shader permutation mode: ${value.permutationMode}`);
    }

    if (!sourceFamily)
    {
        throw new TypeError("Shader target selectionPolicy requires sourceFamily");
    }

    return {
        ...value,
        permutationMode,
        sourceFamily,
    };
}

function normalizeQualificationPolicy(value)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("Shader target qualificationPolicy must be an object");
    }

    const level = String(value.level ?? "").trim().toLowerCase();
    const nativeComparison = String(value.nativeComparison ?? "").trim().toLowerCase();

    if (![ "package", "structural", "native-hlslcc" ].includes(level))
    {
        throw new TypeError(`Invalid shader qualification level: ${value.level}`);
    }

    if (![ "not-applicable", "pending-audit", "required" ].includes(nativeComparison))
    {
        throw new TypeError(
            `Invalid shader native comparison policy: ${value.nativeComparison}`,
        );
    }

    if (level === "native-hlslcc" && nativeComparison !== "required")
    {
        throw new TypeError("Native HLSLcc qualification must require native comparison");
    }

    return { level, nativeComparison };
}

function normalizeProfile(value)
{
    const profile = String(value ?? "").trim().toLowerCase();

    if (!ProfilePattern.test(profile))
    {
        throw new TypeError(`Invalid shader profile: ${value}`);
    }

    return profile;
}

function normalizeQualityTiers(value)
{
    if (!Array.isArray(value) || !value.length)
    {
        throw new TypeError("Shader target quality tiers must be a non-empty array");
    }

    return [...new Set(value.map((tier) =>
    {
        const normalized = String(tier ?? "").trim().toLowerCase().replace(/^sm_/u, "");

        if (!/^[a-z0-9_]+$/u.test(normalized))
        {
            throw new TypeError(`Invalid shader quality tier: ${tier}`);
        }

        return normalized;
    }))].sort();
}
