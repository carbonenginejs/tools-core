import { CjsCharacterLibraryBuilder, CjsCharacterLibraryManager } from "@carbonenginejs/runtime/character";
import { blue } from "@carbonenginejs/runtime/blue";
import { CjsToolResFileSystemLocal } from "../indexing/CjsToolResFileSystemLocal.js";

/** The build in progress: `blue.paths` serves one exact build at a time. */
let building = Promise.resolve();

/**
 * tools-core's character library build: the runtime's library builder (`CjsCharacterLibraryBuilder`) over one exact
 * build, as `CjsToolAudioBuilder` wraps the audio builder. tools-core only provides the files: it registers the build's
 * local file system (`CjsToolResFileSystemLocal`) on the one `blue.paths`, and the runtime builder reads through Blue's
 * resMan as anywhere else (resman-in-the-browser.md § *File systems are the providers*). What the library reads and
 * how it records it is the runtime's, so the two cannot drift (operator, 2026-11-10).
 */
export class CjsToolCharacterBuilder extends CjsCharacterLibraryBuilder
{

    /**
     * Builds the complete character library of one exact build: every configured source read. Builds run one at a
     * time, since `blue.paths` serves one build's files at a time.
     * @param {{ Match: function(string, object): Array<object>, Fetch: function(string): Promise<{ bytes: ArrayBufferView|ArrayBuffer }> }} source
     *   The exact-build source (`CjsToolIndex.OpenTarget`).
     * @returns {Promise<import("@carbonenginejs/runtime/character").CjsCharacterLibrary>} The library.
     */
    static buildFromSource(source)
    {
        const run = building.then(() => BuildOne(source));
        building = run.catch(() => {});
        return run;
    }

}

/**
 * One build: the build's file system registered on `blue.paths` for its length; resMan cleared before and after, as it
 * caches reads by path and another build's file has the same path.
 */
async function BuildOne(source)
{
    const fileSystem = new CjsToolResFileSystemLocal(source);
    blue.resMan.Clear();
    blue.paths.RegisterFileSystem(fileSystem);
    // Blue's resMan prepares what it loads in its per-frame Update (BlueResMan::OnTick); a Node host has no frame
    // loop, so the build drives one while it reads.
    const frame = setInterval(() => blue.resMan.Update(), 1);
    try
    {
        const builder = new CjsCharacterLibraryBuilder({ paths: blue.paths, resMan: blue.resMan });
        new CjsCharacterLibraryManager(null, { sourceBuilder: builder }).Initialize({ resMan: blue.resMan });
        return await builder.Build({ lazy: false });
    }
    finally
    {
        clearInterval(frame);
        blue.paths.UnregisterFileSystem(fileSystem);
        blue.resMan.Clear();
    }
}
