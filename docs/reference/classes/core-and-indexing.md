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

Stateless construction of deterministic audio-library artifacts.

- Export: `@carbonenginejs/tools-core/audio`
- Source: `src/audio/CjsToolAudioBuilder.js`
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

<!-- class:CjsToolAudioSource -->
## `CjsToolAudioSource`

Resolves and reads playable media from one immutable audio library.

- Export: `@carbonenginejs/tools-core/audio`
- Source: `src/audio/CjsToolAudioSource.js`
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

Front-facing normalized character-library build tool.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacter.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterAssembler -->
## `CjsToolCharacterAssembler`

Deterministic character catalog and source-reference assembly.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterAssembler.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterCompiler -->
## `CjsToolCharacterCompiler`

Stateless transforms between expanded and compact character-library data.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterCompiler.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterLibrary -->
## `CjsToolCharacterLibrary`

Read-only query API over one prepared character library.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterLibrary.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterNormalizer -->
## `CjsToolCharacterNormalizer`

Stateless normalization of Carbon character authoring profiles.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterNormalizer.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterRepository -->
## `CjsToolCharacterRepository`

Opens exact-build prepared character libraries from the shared tool cache.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCharacterSerializer -->
## `CjsToolCharacterSerializer`

Deterministic character-library JSON serialization.

- Export: `@carbonenginejs/tools-core/character`
- Source: `src/character/CjsToolCharacterSerializer.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolCore -->
## `CjsToolCore`

Public Node composition root for cache, identity, and graph tooling.

- Export: `@carbonenginejs/tools-core`
- Source: `src/CjsToolCore.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndex -->
## `CjsIndex`

Complete immutable app/res index graph for one provider and exact build.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndex.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexAnswerCatalog -->
## `CjsIndexAnswerCatalog`

Immutable target/build answers derived from one composed resource view.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexAnswerCatalog.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexBuildResolver -->
## `CjsIndexBuildResolver`

Resolves an exact build or provider channel to one exact remote build.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexBuildResolver.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexCache -->
## `CjsIndexCache`

Index-module adapter over tools-core's one shared cache.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexCache.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexEntry -->
## `CjsIndexEntry`

One immutable resource entry from an app/res index.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexEntry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexGroup -->
## `CjsIndexGroup`

One immutable appfileindex or resfileindex parsed as an ordered group.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexGroup.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexOverlaySource -->
## `CjsIndexOverlaySource`

Composes persistent target overlays around one official immutable index source.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexOverlaySource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexOverlay -->
## `CjsIndexOverlay`

One opened persistent or remote overlay and its immutable resource index.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexOverlayStore.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexOverlayStore -->
## `CjsIndexOverlayStore`

Persistent target-specific resource overlays stored outside disposable caches.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexOverlayStore.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexProvider -->
## `CjsIndexProvider`

Immutable remote-provider configuration.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexProvider.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexProviderRegistry -->
## `CjsIndexProviderRegistry`

Immutable registry of remote provider profiles.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexProviderRegistry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexReader -->
## `CjsIndexReader`

Reads the complete immutable app/res index graph for one provider/build.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexReader.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsIndexSource -->
## `CjsIndexSource`

Cached, read-only remote payload source opened from one complete index graph.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsIndexSource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndex -->
## `CjsToolIndex`

Facade for complete indexes and cached remote app/res file retrieval.

- Export: `@carbonenginejs/tools-core/index`
- Source: `src/indexing/CjsToolIndex.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsBoundedFetch -->
## `CjsBoundedFetch`

Shared deadlines, cancellation, and streaming response limits for remote reads.

- Source: `src/internal/CjsBoundedFetch.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsBoundedFetchError -->
## `CjsBoundedFetchError`

Stable internal failure emitted by the bounded network boundary.

- Source: `src/internal/CjsBoundedFetch.js`
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
