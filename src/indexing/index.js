/**
 * `@carbonenginejs/tools-core/index`: exact-build `app:`/`res:` indexes and
 * validated bytes. `CjsToolIndex` is the facade over complete indexes and cached
 * retrieval; readers, sources and parsers cover the game's comma-separated index
 * and the JSON `carbon.resource-index`; `CjsToolIndexOverlayStore` holds
 * persistent overlays and `CjsToolIndexSuppliedStore` supplied indexes.
 */
export { CjsToolIndexReader } from "./CjsToolIndexReader.js";
export { CjsToolIndexBuildResolver } from "./CjsToolIndexBuildResolver.js";
export {
    CjsToolIndexGroup,
    JsonIndexSchema,
    JsonIndexVersion,
    formatJsonIndex,
    parseFileIndex,
    parseFileIndexLine,
    parseIndexGroup,
    parseIndexGroupNamed,
    parseJsonIndexGroup,
} from "./CjsToolIndexGroup.js";
export {
    CjsToolIndexEntry,
    normalizeLogicalPath,
    normalizeStoragePath,
    parseIndexEntry,
} from "./CjsToolIndexEntry.js";
export {
    CjsToolIndexTargetProfile,
    normalizeBuildReference,
    normalizeGame,
    normalizeIndexTargetId,
    normalizeProviderId,
} from "./CjsToolIndexTargetProfile.js";
export { CjsToolIndexTargetProfileRegistry } from "./CjsToolIndexTargetProfileRegistry.js";
export { CjsToolIndexSource } from "./CjsToolIndexSource.js";
export { CjsToolIndexOverlaySource } from "./CjsToolIndexOverlaySource.js";
export { CjsToolIndexOverlay, CjsToolIndexOverlayStore } from "./CjsToolIndexOverlayStore.js";
export { CjsToolIndexCache } from "./CjsToolIndexCache.js";
export { CjsToolIndexSuppliedStore } from "./CjsToolIndexSuppliedStore.js";
export { CjsToolIndexGraph } from "./CjsToolIndexGraph.js";
export { CjsToolIndexAnswerCatalog } from "./CjsToolIndexAnswerCatalog.js";
export { CjsToolIndex } from "./CjsToolIndex.js";
export { DefaultIndexProfileData } from "./defaultIndexProfiles.js";
export { createPathMatcher, hasPathWildcard } from "./pathMatcher.js";
