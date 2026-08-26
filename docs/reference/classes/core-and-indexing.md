# Core and indexing class catalog

Status: Evolving
Scope: `@carbonenginejs/tools-core` core, audio, cache, character, indexing, library, prefetch, and proxy classes
Audience: Users, maintainers, and automated readers
Summary: Provides source-backed purpose descriptors for tools-core foundations and indexed resource tooling.

<!-- class:CjsToolAudio -->
## `CjsToolAudio`

Front-facing audio-library build tool.

- Export: `@carbonenginejs/tools-core/audio`
- Source: `src/audio/CjsToolAudio.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolAudioBuilder -->
## `CjsToolAudioBuilder`

Node target-policy wrapper around the runtime audio optional library builder.

- Export: `@carbonenginejs/tools-core/audio`
- Source: `src/audio/CjsToolAudioBuilder.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolAudioMediaBuilder -->
## `CjsToolAudioMediaBuilder`

Materializes raw Wwise bank members as a hash-safe generated resource index.

- Export: `@carbonenginejs/tools-core/audio`
- Source: `src/audio/CjsToolAudioMediaBuilder.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolAudioPrefetch -->
## `CjsToolAudioPrefetch`

Supplies indexed audio-library paths to the generic prefetch executor.

- Export: `@carbonenginejs/tools-core/audio`
- Source: `src/audio/CjsToolAudioPrefetch.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolAudioRepository -->
## `CjsToolAudioRepository`

Opens exact-build prepared audio libraries and their indexed byte sources.

- Export: `@carbonenginejs/tools-core/audio`
- Source: `src/audio/CjsToolAudioRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSofRepository -->
## `CjsToolSofRepository`

Opens exact-build runtime SOF catalogs lazily by default, with an explicit full `data.black` mode.

- Export: `@carbonenginejs/tools-core/sof`
- Source: `src/sof/CjsToolSofRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSofCatalog -->
## `CjsToolSofCatalog`

Provides read-only catalog and asynchronous lazy detail/DNA answers for one exact runtime SOF build.

- Export: `@carbonenginejs/tools-core/sof`
- Source: `src/sof/CjsToolSofRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSofBundle -->
## `CjsToolSofBundle`

Writes one self-contained SOF bundle: the GPU-free carbon.document plus its geometry and decoded textures, laid out for consumers that cannot run Carbon shaders or decode BC7/BC5 payloads themselves (the Blender add-ons).

- Export: `@carbonenginejs/tools-core/sof`
- Source: `src/sof/CjsToolSofBundle.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolAudioSource -->
## `CjsToolAudioSource`

Resolves and reads playable media from one immutable audio library.

- Export: `@carbonenginejs/tools-core/audio`
- Source: `src/audio/CjsToolAudioSource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolMusicSource -->
## `CjsToolMusicSource`

Lists and reads explicitly cataloged neutral music tracks from one local directory.

- Export: `@carbonenginejs/tools-core/audio`
- Source: `src/audio/CjsToolMusicSource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolBlack -->
## `CjsToolBlack`

Front-facing Black (`.black`) resource reader: fetch through an index source, then parse.

- Export: `@carbonenginejs/tools-core/black`
- Source: `src/black/CjsToolBlack.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCache -->
## `CjsToolCache`

Shared game-compatible cache for every CarbonEngineJS Node tool.

- Export: `@carbonenginejs/tools-core/cache`
- Source: `src/cache/CjsToolCache.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacter -->
## `CjsToolCharacter`

Front-facing exact-target character-library build tool.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacter.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterBuilder -->
## `CjsToolCharacterBuilder`

Node target-policy wrapper around the runtime-owned character builder.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterBuilder.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterCatalogGatherer -->
## `CjsToolCharacterCatalogGatherer`

Gathers decoded or declared character JSON and materializes effective part-source versions.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterCatalogGatherer.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterDefinitionCompiler -->
## `CjsToolCharacterDefinitionCompiler`

Retains decoded definitions losslessly and adds typed catalogs from an exact resource index.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterDefinitionCompiler.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterRepository -->
## `CjsToolCharacterRepository`

Opens exact-build prepared character libraries from the shared tool cache.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCore -->
## `CjsToolCore`

Public Node composition root for cache, identity, and graph tooling.

- Export: `@carbonenginejs/tools-core`
- Source: `src/CjsToolCore.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexGraph -->
## `CjsToolIndexGraph`

Complete immutable app/res index graph for one provider and exact build.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexGraph.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexAnswerCatalog -->
## `CjsToolIndexAnswerCatalog`

Immutable target/build answers derived from one composed resource view.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexAnswerCatalog.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexBuildResolver -->
## `CjsToolIndexBuildResolver`

Resolves an exact build or provider channel to one exact remote build.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexBuildResolver.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexCache -->
## `CjsToolIndexCache`

Index-module adapter over tools-core's one shared cache.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexCache.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexEntry -->
## `CjsToolIndexEntry`

One immutable resource entry from an app/res index.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexEntry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexGroup -->
## `CjsToolIndexGroup`

One immutable appfileindex or resfileindex parsed as an ordered group.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexGroup.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexGeneratedStore -->
## `CjsToolIndexGeneratedStore`

Persists exact-build generated resfileindex groups over shared hash-safe payloads.

- Export: Internal
- Source: `src/indexing/CjsToolIndexGeneratedStore.js`
- Visibility: Internal
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexOverlaySource -->
## `CjsToolIndexOverlaySource`

Composes persistent target overlays around one official immutable index source.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexOverlaySource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexOverlay -->
## `CjsToolIndexOverlay`

One opened persistent or remote overlay and its immutable resource index.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexOverlayStore.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexOverlayStore -->
## `CjsToolIndexOverlayStore`

Persistent target-specific resource overlays stored outside disposable caches.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexOverlayStore.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexTargetProfile -->
## `CjsToolIndexTargetProfile`

Immutable target-selected acquisition profile. Game and provider are metadata.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexTargetProfile.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexTargetProfileRegistry -->
## `CjsToolIndexTargetProfileRegistry`

Immutable registry of target-keyed acquisition profiles.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexTargetProfileRegistry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexReader -->
## `CjsToolIndexReader`

Reads the complete immutable app/res index graph for one target/build.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexReader.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndexSource -->
## `CjsToolIndexSource`

Cached, read-only remote payload source opened from one complete index graph.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndexSource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndex -->
## `CjsToolIndex`

Facade for complete indexes and cached remote app/res file retrieval.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndex.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolBoundedFetch -->
## `CjsToolBoundedFetch`

Shared deadlines, cancellation, and streaming response limits for remote reads.

- Source: `src/internal/CjsToolBoundedFetch.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsToolBoundedFetchError -->
## `CjsToolBoundedFetchError`

Stable internal failure emitted by the bounded network boundary.

- Source: `src/internal/CjsToolBoundedFetch.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsToolLibraryArtifact -->
## `CjsToolLibraryArtifact`

Writes one canonical JSON library and its deterministic gzip sibling.

- Export: `@carbonenginejs/tools-core/library`
- Source: `src/library/CjsToolLibraryArtifact.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolPrefetch -->
## `CjsToolPrefetch`

Plans and acquires exact-build resource sets supplied by named profiles.

- Export: `@carbonenginejs/tools-core/prefetch`
- Source: `src/prefetch/CjsToolPrefetch.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolHttpProxy -->
## `CjsToolHttpProxy`

Minimal optional HTTP adapter over a CjsToolCore instance.

- Export: `@carbonenginejs/tools-core/proxy`
- Source: `src/proxy/CjsToolHttpProxy.js`
- Visibility: Public
- Kind: CarbonEngineJS
