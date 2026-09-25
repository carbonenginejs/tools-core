/**
 * `@carbonenginejs/tools-core`: the package root.
 *
 * Re-exports the audio, black, build, cache, fsd, icons, index, library,
 * prefetch, auth, proxy, sde, shader, skin, sof, target, weapon and utils
 * surfaces, plus `CjsToolCore`, the facade that resolves SDE identity to SOF
 * DNA and builds SOF values. Character, dogma, fitting, identity, industry,
 * localisation, map, market, schema and skills are reachable only through their
 * own subpaths. Prefer the narrowest subpath that owns a capability.
 */
export * from "./audio/index.js";
export * from "./black/index.js";
export * from "./build/index.js";
export * from "./cache/index.js";
export * from "./fsd/index.js";
export * from "./icons/index.js";
export * from "./indexing/index.js";
export * from "./library/index.js";
export * from "./prefetch/index.js";
export * from "./auth/index.js";
export * from "./proxy/index.js";
export * from "./sde/index.js";
export * from "./shader/index.js";
export * from "./skin/index.js";
export * from "./sof/index.js";
export * from "./target/index.js";
export * from "./weapon/index.js";
export { CjsToolCore } from "./CjsToolCore.js";
export * from "./utils.js";
