import { CjsCharacterLibraryBuilder, CjsCharacterLibraryManager } from "@carbonenginejs/runtime/character";
import { blue } from "@carbonenginejs/runtime/blue";
import { CjsToolBlueHost } from "../indexing/CjsToolBlueHost.js";
import { CjsToolResFileSystemLocal } from "../indexing/CjsToolResFileSystemLocal.js";

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
     * time and alone (`CjsToolBlueHost.runExclusive`), since the build's files are served as `res:` and resMan is
     * cleared around it.
     * @param {{ Match: function(string, object): Array<object>, Fetch: function(string): Promise<{ bytes: ArrayBufferView|ArrayBuffer }> }} source
     *   The exact-build source (`CjsToolIndex.OpenTarget`).
     * @returns {Promise<import("@carbonenginejs/runtime/character").CjsCharacterLibrary>} The library.
     */
    static buildFromSource(source)
    {
        return CjsToolBlueHost.runExclusive(() => BuildOne(source));
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
    // resMan's frame runs for the length of the run (CjsToolBlueHost.runExclusive).
    try
    {
        const builder = new CjsCharacterLibraryBuilder({ paths: blue.paths, resMan: blue.resMan });
        new CjsCharacterLibraryManager(null, { sourceBuilder: builder }).Initialize({ resMan: blue.resMan });
        return await builder.Build({ lazy: false });
    }
    finally
    {
        blue.paths.UnregisterFileSystem(fileSystem);
        blue.resMan.Clear();
    }
}
