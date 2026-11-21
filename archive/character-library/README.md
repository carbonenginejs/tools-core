# Archived character library builder

Reference source from tools-core revision `9cf7fc8`. The builder, its
repository, its target policy and its build script are excluded from the live
entry points, the service and the npm package. This directory is not an
executable compatibility package.

The builder was built on the old runtime character library
(`CjsCharacterLibraryBuilder`, `CjsCharacterLibraryManager`), which the runtime
deleted in `c852afa2d`. It is retired until the character library is remade;
then a builder over the new catalogue's prebuilt document replaces it. See the
organization's data-supply-modes specification (mode 2, a prebuilt payload) and
its generated-library-delivery architecture page.

Files under `src/character/` retain their original text from `src/character/`,
and `scripts/build_character_library.js` its original text from `scripts/`.
Files under `test/` retain their original text from `test/`, with a
`.reference` suffix so the test runner does not execute them.

Retired with it: the service's `GET /<target>/<build>/character` and
`/character/library.json` route, its `character` health capability, the
service's character repository, the `./character` package export, the
`build:character` package script, and the `character` library of the `eve`
target.

Original relative imports are preserved for provenance; do not import from
live modules, and do not add this archive to package exports or `files`.
