import { BlueResFileSystemForm, BlueResFileSystemLocal } from "@carbonenginejs/runtime/blue";
import { CjsToolIndexAnswerCatalog } from "./CjsToolIndexAnswerCatalog.js";

/**
 * tools-core's local file system for one exact build: the Node host's implementation of the runtime's
 * `BlueResFileSystemLocal` stub, which a host extends and the orchestrator registers on `blue.paths`
 * (resman-in-the-browser.md § *File systems are the providers*). What the build holds (existence, directories) comes
 * from its index (`CjsToolIndexAnswerCatalog.createIndexFileSystem`); a file's bytes come from the build's `Fetch`.
 *
 * Carbon: BlueResFileSystemLocal (blue/src/BlueResFileSystemLocal.cpp), over an exact build rather than search paths.
 */
export class CjsToolResFileSystemLocal extends BlueResFileSystemLocal
{

    /** The build's `res:` files. */
    static protocols = [ "res" ];

    /** The build's index, as a file system: existence and listings. */
    _index = null;

    /** The exact-build source (`CjsToolIndex.OpenTarget`). */
    _source = null;

    /**
     * @param {{ Match: function(string, object): Array<object>, Fetch: function(string): Promise<{ bytes: ArrayBufferView|ArrayBuffer }> }} source
     *   The exact-build source.
     */
    constructor(source)
    {
        super();
        this._source = source;
        this._index = CjsToolIndexAnswerCatalog.createIndexFileSystem(source);
    }

    /**
     * Whether the build holds the file.
     * @adapted from the build's index, not search-path folders
     */
    FileExists(filename) { return this._index.FileExists(filename); }

    /**
     * Whether the build holds a directory at the path.
     * @adapted from the build's index, not search-path folders
     */
    IsDirectory(dir) { return this._index.IsDirectory(dir); }

    /**
     * Adds the entries the build holds in the directory.
     * @adapted from the build's index, not search-path folders
     */
    GetDirectoryContents(dir, results) { return this._index.GetDirectoryContents(dir, results); }

    /**
     * The file's bytes, from the build.
     * @adapted asynchronous, answering `{ form: "bytes", data }` (IBlueResFileSystem.js), read through the build's
     *   `Fetch`
     */
    async GetStreamFromPath(resPath, _request)
    {
        const { bytes } = await this._source.Fetch(resPath);
        const data = bytes instanceof Uint8Array ? bytes
            : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
        return { form: BlueResFileSystemForm.BYTES, data };
    }

    /**
     * No disk path: the build's files are read through its source, not opened from a folder.
     * @adapted the build has no search-path folder to resolve into; `null` is Carbon's false
     */
    ResolvePathW(_path) { return null; }

}
