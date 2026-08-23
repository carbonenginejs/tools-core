function deepFreeze(value)
{
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
}

// Reviewed class purposes that are not source-extracted Carbon declarations.
// Keys are family-qualified because Carbon class names are not globally unique.
export const DEFAULT_SCHEMA_CLASS_PURPOSES = deepFreeze({
    "eve/child/EveChildCloud": "Describes a transformable volumetric cloud child, including its effect, editable volume, tessellation, LOD, and bounds state.",
    "eve/child/EveCloudEditableVolume": "Holds the editable voxel dimensions, bitmap and texture backing, control balls, and curve sets used to author a cloud volume.",
    "eve/child/EveCloudVolumeTextureParameter": "Binds an editable cloud volume to a named effect texture parameter and records whether the effect consumes it.",
    "eve/child/IEveLightingOverride": "Defines prioritized multipliers for sun, background, reflection, and aggregate lighting overrides on an EVE child.",
    "eve/child/lineSetPaths/EveLineChildContainer": "Groups line-path children beneath an EveChildTransform with shared naming and visibility state.",
    "eve/effect/EveOccluder": "Groups sprite occlusion elements that can be displayed as one named EVE scene effect.",
    "eve/effect/EveStarfield": "Defines a procedurally seeded starfield with distance, flashing, effect, and star-count controls.",
    "eve/EveDamageOverlay": "Carries armor-impact, repair, shader, and hull-damage state for a space object's self-contained damage surface.",
    "eve/EveModularObjectModifier": "Carries the object, part data, SOF builder, and instanced-mesh state associated with Carbon's transient modular-object edit session.",
    "eve/scene/EvePendingPickingReadback": "Carries the coordinates, frame, buffers, decoded data, and debug geometry for a pending asynchronous picking readback.",
    "eve/scene/EveSpaceSceneRenderDriver": "Collects camera, quality, pass-toggle, overlay, background, and post-process state for driving an EVE space-scene frame.",
    "eve/ui/EveSprite2dBracketRenderer": "Binds a bracket collection and icon atlas for rendering EVE UI markers in the 2D sprite scene.",
    "font/Tr2FontManager": "Tracks font-loading policy together with the glyph-cache memory budget and occupancy.",
    "font/Tr2FontMeasurer": "Accumulates cursor position, vertical metrics, spacing, limits, and decoration bounds while measuring laid-out text.",
    "font/Tr2SBitWrapper": "Models Carbon's cached font-glyph wrapper, including placement coordinates and buffer-copy entry points.",
    "particle/ITr2GenericEmitter": "Defines the update and particle-spawn contract shared by emitters attached to Tr2ParticleSystem.",
    "particle/Tr2GpuParticleSystem": "Describes the GPU particle pipeline's capacity, visible-count controls, and compute and render effect stages.",
    "raytracing/Tr2RaytracingGeometry": "Collects mesh-area, material, transforms, skinning buffers, bindless resources, and acceleration-structure state for ray-traced geometry.",
    "raytracing/Tr2RaytracingManager": "Carries shadow-effect, denoiser, enablement, and sun-angle state for Carbon's ray-tracing manager.",
    "raytracing/Tr2RaytracingMesh": "Tracks one ray-tracing mesh's geometry, transforms, skinning and morph offsets, screen size, and selected LOD.",
    "raytracing/Tr2RaytracingPipelineStateManager": "Tracks a ray-tracing pipeline descriptor, compiled state, pending name, and dirty-rebuild flag.",
    "renderJob/Tr2StepExecuteRenderNode": "Carries configuration for a render-job step that executes one render node into an optional destination target and clears it on failure.",
    "renderJob/TriStepRemoteUpdate": "Carries the view, projection, viewport, and shared-memory handles for a render step that publishes remote frame updates.",
    "sprite2d/Tr2Sprite2d": "Adds opacity, saturation, texture-sized dimensions, and picking radius to a textured 2D sprite.",
    "sprite2d/Tr2Sprite2dArc": "Defines a filled or outlined 2D arc with angular span, radius, colors, widths, and primary and secondary textures.",
    "sprite2d/Tr2Sprite2dContainer": "Defines a pickable 2D sprite container with clipping, depth range, coordinate mode, and optional content caching.",
    "sprite2d/Tr2Sprite2dDisplayList": "Caches batched 2D sprite vertices, indices, textures, effect state, transforms, and draw ranges for one owner.",
    "sprite2d/Tr2Sprite2dFrame": "Defines a textured frame with corner sizing, corner scaling, center-fill, and offset controls.",
    "sprite2d/Tr2Sprite2dLayer": "Defines a sprite container layer with blend and effect state plus optional background clearing.",
    "sprite2d/Tr2Sprite2dLine": "Defines a textured 2D line segment with endpoint positions, colors, widths, and texture offsets.",
    "sprite2d/Tr2Sprite2dPickingMask": "Defines channel, threshold, edge, and texture-mask constraints used when hit-testing a 2D sprite.",
    "sprite2d/Tr2Sprite2dScene": "Owns a 2D sprite tree together with display transforms, clipping, picking, batching limits, background, and render-mode state.",
    "sprite2d/Tr2Sprite2dStretch": "Defines a horizontally stretchable textured sprite with independent edge widths, center fill, offset, opacity, and DPI scaling.",
    "sprite2d/Tr2Sprite2dStretchVertical": "Defines a vertically stretchable textured sprite with independent edge heights, center fill, opacity, and saturation.",
    "sprite2d/Tr2Sprite2dTextObject": "Defines a 2D text sprite's measured extent, primary texture, picking radius, shadow-effect mode, and tooltip flag.",
    "sprite2d/Tr2Sprite2dTexture": "Describes a named 2D texture transform around separate rotation and scaling centers.",
    "sprite2d/Tr2SpriteObject": "Provides shared color, depth, blending, effect, glow, outline, shadow, and render-target state for drawable 2D sprites.",
    "sprite2d/Tr2TexturedSpriteObject": "Adds primary and secondary texture bindings to the shared 2D sprite render state.",
    "trinityCore/ITr2ImpostorSource": "Carries the view and up directions required to capture an object into an impostor atlas.",
    "trinityCore/ITr2InstanceData": "Describes a contiguous instance-data slice by buffer, byte offset, stride, and item count.",
    "trinityCore/Tr2AtlasTexture": "Describes one named subtexture's resource path, pixel rectangle, and owning atlas dimensions.",
    "trinityCore/Tr2Denoiser": "Carries depth, normal, and plane weights together with radius, step size, and bypass state for spatial denoising.",
    "trinityCore/Tr2GpuProfiler": "Carries nested GPU timing zones, frame fences, messages, and capture state for one profiling owner.",
    "trinityCore/Tr2GpuStructuredBuffer": "Describes the element count, stride, and creation flags of a GPU structured buffer.",
    "trinityCore/Tr2GrannyPrimitiveSet": "Associates a primitive set with a Granny resource path and object while controlling solid rendering.",
    "trinityCore/Tr2HostBitmap": "Describes a CPU-resident bitmap's dimensions, format, mip count, image type, and diagnostic name.",
    "trinityCore/Tr2ImpostorManager": "Carries an impostor atlas, tile dimensions, capture effect, and per-frame update budget.",
    "trinityCore/Tr2PrimitiveScene": "Groups display primitives, positioned text labels, and an optional manipulation tool into one scene.",
    "trinityCore/Tr2PrimitiveText": "Positions a displayable text label with its font and content inside a primitive scene.",
    "trinityCore/Tr2ReflectionProbe": "Carries periodic reflection-capture textures, position locking, resolution, and backlight treatment.",
    "trinityCore/Tr2RingBuffer": "Carries buffer storage, mirrored data, dirty and locked regions, frame, head, tail, stride, and offset for ring allocation.",
    "trinityCore/Tr2RotationTool": "Extends the manipulation tool with quaternion rotation state and angular precision.",
    "trinityCore/Tr2SSSSS": "Configures screen-space subsurface scattering width, front-scatter color, scene presence, and enablement.",
    "trinityCore/Tr2StreamingBitmapSaver": "Models Carbon's incremental bitmap saver through its dimensions, pixel format, current offset, and batch-copy entry points.",
    "trinityCore/Tr2TextureArray": "Describes a texture array's elements, dimensions, resource usage, upload increment, backing texture, and change callback.",
    "trinityCore/Tr2TextureAtlas": "Carries texture-atlas dimensions, format, mip levels, margins, empty-area painting, and removal-compaction policy.",
    "trinityCore/Tr2TextureAtlasMan": "Holds the collection of texture atlases exposed through Carbon's atlas allocation service.",
    "trinityCore/Tr2TextureReference": "Models Carbon's reference-counted texture holder and its texture-change notification surface.",
    "trinityCore/Tr2TransientTextureReference": "Models Carbon's caller-owned texture pointer wrapper without claiming responsibility for the texture's lifetime.",
    "trinityCore/Tr2TranslationTool": "Extends the manipulation tool with the current three-axis translation result."
});

/** Normalizes one optional purpose into a safe, one-sentence metadata value. */
export function normalizeSchemaClassPurpose(value)
{
    if (value === undefined || value === null) return null;
    if (typeof value !== "string")
    {
        throw new TypeError("Carbon schema class purpose must be a string.");
    }

    const purpose = value.trim().replace(/\s+/g, " ");
    if (!purpose) return null;
    if (purpose.includes("*/"))
    {
        throw new TypeError("Carbon schema class purpose cannot close a JSDoc comment.");
    }
    return purpose;
}

/** Resolves one reviewed family-qualified class purpose, or null. */
export function resolveSchemaClassPurpose(family, className)
{
    if (!family || !className) return null;
    return DEFAULT_SCHEMA_CLASS_PURPOSES[`${family}/${className}`] || null;
}
