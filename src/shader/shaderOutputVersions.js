/**
 * A build-side cache key for reuse. NOT a version of anything we emit.
 *
 * Read that twice before touching this file, because the nearby idea - giving
 * our WebGL2 and WebGPU output a version of its own - is a road this project has
 * already driven down and lost months on. CCP dictates the effect container and
 * it carries THEIR version; there is no field in it that is ours, and nothing
 * here proposes one. This number is never written into a payload, never read
 * back from one, and no consumer can observe it. It exists in one place only:
 * the value in `ResFiles/converters.json` that decides whether an already-stored
 * translation may be reused instead of rebuilt.
 *
 * So the question it answers is not "what version is this output" but "was this
 * stored payload produced by the emitter we have now". Getting it wrong costs a
 * rebuild, which is seconds; it cannot corrupt a payload or reach anything that
 * reads one.
 *
 * ## What triggers a bump: changed STORED BYTES, not a changed emitter
 *
 * Our WebGL2 and WebGPU output can change freely, as long as it stays inside the
 * Carbon effect format. The test is narrower than "did the emitter change" - it
 * is whether the same input now produces different bytes on disk. Two worked
 * cases, from the runtime side:
 *
 *  - `hasDynamicOffset` is never written; it is synthesised on READ from the
 *    resource kind and type. Flipping it changes behaviour and changes no stored
 *    byte, so existing payloads stay valid and must keep being reused. No bump.
 *  - Bind-group indices ARE written, and are baked into the emitted WGSL text.
 *    Splitting or renumbering groups changes stored bytes, so every machine
 *    would otherwise reuse stale translations that look correct. Bump.
 *
 * ## Why the format package cannot answer this
 *
 * `CjsWebglFormat.packageVersion` and its WebGPU counterpart look like the
 * answer and are not: they are CCP's container version, not ours. Keying reuse
 * on them would be wrong in both directions - unchanged when our emitter
 * changes, so stale payloads are reused and look correct; and changed when CCP's
 * container moves, discarding a store of translations that were still good.
 *
 * Adding a version to those formats is not the fix either. They read and write
 * CCP's format; a second version field there is the confusion above, invited.
 * That failure already happened once from the other end: a leading byte in the
 * backend block was misnamed a version, and the two backends emitted `1` meaning
 * different things - see `carbonEffectBackendBlock.js` in the runtime formats. A
 * version nobody can interpret is worse than no version, which is why the one
 * here is a private cache key and says so.
 *
 * ## While you are iterating
 *
 * `--rebuild` forces one run and records nothing different, so a later build
 * without it reuses whatever that run stored. Bumping this is the durable
 * answer, for when the change is finished and other machines must rebuild too.
 */
export const ShaderOutputVersions = Object.freeze({
    webgl2: "1",
    webgpu: "1",
});

/**
 * Gets the declared output version for one payload suffix.
 *
 * An unknown suffix is not defaulted. A backend nobody has declared a version
 * for cannot have its reuse decided, and silently choosing "1" would reuse
 * across a change nobody recorded.
 */
export function GetShaderOutputVersion(suffix)
{
    const version = ShaderOutputVersions[suffix];

    if (!version)
    {
        throw new Error(
            `No declared output version for shader payloads suffixed .${suffix}. `
            + "Add one to shaderOutputVersions.js; it decides when stored "
            + "translations may be reused.",
        );
    }

    return version;
}
