import { blue } from "@carbonenginejs/runtime/blue";
import { CjsBlackFormat } from "@carbonenginejs/runtime/blue/formats/black";
import { CjsToolResFileSystemLocal } from "./CjsToolResFileSystemLocal.js";

/** Readers holding Blue's resMan now (`runShared`). */
const shared = new Set();

/** The exclusive run queued last; the next waits for it. */
let exclusiveTail = Promise.resolve();

/** How many runs need resMan's frame now, and the frame while any does. */
let active = 0;
let frame = null;

/** The build file systems registered on `blue.paths`, by protocol. */
const buildProtocols = new Map();

/**
 * tools-core's host side of Blue: the one `blue.resMan` and `blue.paths`, shared by every exact build tools-core serves.
 *
 * Each build's files are registered once under a protocol of its own (`eve3435006:`), so many builds sit on the one
 * `blue.paths` together and resMan caches them apart; only tools-core's internal reads use those protocols, and
 * everything it publishes keeps `res:`. A run that clears resMan or swaps the `res:` file system (the character build)
 * is exclusive; a read through a build protocol is shared. Blue's resMan prepares what it loads in its per-frame
 * `Update` (BlueResMan::OnTick), and a Node host has no frame loop, so a frame runs while any run is active.
 */
export class CjsToolBlueHost
{

    /**
     * The protocol a build's files are read under: the target and build, lowercased to letters and digits.
     * @param {{ target: string, build: string|number }} source The exact-build source.
     * @returns {string} The protocol, without the colon.
     */
    static getBuildProtocol(source)
    {
        const protocol = `${source.target}${source.build}`.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!protocol || protocol === "res") throw new TypeError(`No build protocol for ${source.target} ${source.build}`);
        return protocol;
    }

    /**
     * The `res:` path read under the build's protocol.
     * @param {string} resPath A `res:` path.
     * @param {string} protocol The build protocol.
     * @returns {string} The same path under the build protocol.
     */
    static toBuildPath(resPath, protocol)
    {
        const path = String(resPath);
        if (!/^res:/i.test(path)) throw new TypeError(`Not a res: path: ${path}`);
        return `${protocol}:${path.slice(4)}`;
    }

    /**
     * Loads one object of an exact build through Blue's resMan, as Carbon's LoadObject does, under the build's own
     * protocol. The build's file system is registered on first use and stays.
     * @param {{ target: string, build: string|number, Match: Function, Fetch: Function }} source The exact-build source.
     * @param {string} resPath The object's `res:` path.
     * @returns {Promise<object>} The object resMan built.
     */
    static loadObject(source, resPath)
    {
        const protocol = CjsToolBlueHost.registerBuild(source);
        return CjsToolBlueHost.runShared(() => blue.resMan.LoadObject(CjsToolBlueHost.toBuildPath(resPath, protocol)));
    }

    /**
     * Registers the build's file system under its protocol once.
     * @param {object} source The exact-build source.
     * @returns {string} The build protocol.
     */
    static registerBuild(source)
    {
        const protocol = CjsToolBlueHost.getBuildProtocol(source);
        // The runtime's default configuration registers Black's object builder when CjsLibrary boots
        // (core/configuration.js); tools-core does not boot CjsLibrary, so it registers the same builder itself.
        if (!blue.resMan.GetObjectLoader("black")) blue.resMan.RegisterObjectBuilder("black", CjsBlackFormat.createBlackObjectBuilder);
        if (!buildProtocols.has(protocol))
        {
            const FileSystem = class extends CjsToolResFileSystemLocal
            {
                /** This build's protocol. */
                static protocols = [ protocol ];
            };
            const fileSystem = new FileSystem(source, protocol);
            blue.paths.RegisterFileSystem(fileSystem);
            buildProtocols.set(protocol, fileSystem);
        }
        return protocol;
    }

    /**
     * Runs work that reads through resMan alongside other readers, after any exclusive run.
     * @template T
     * @param {function(): Promise<T>} work The work.
     * @returns {Promise<T>} Its result.
     */
    static runShared(work)
    {
        const run = exclusiveTail.then(() => CjsToolBlueHost.withFrame(work));
        shared.add(run);
        run.then(() => shared.delete(run), () => shared.delete(run));
        return run;
    }

    /**
     * Runs work that clears resMan or swaps the `res:` file system, alone: after the readers in progress, before the
     * next ones.
     * @template T
     * @param {function(): Promise<T>} work The work.
     * @returns {Promise<T>} Its result.
     */
    static runExclusive(work)
    {
        const run = exclusiveTail.then(async () =>
        {
            await Promise.allSettled([ ...shared ]);
            return CjsToolBlueHost.withFrame(work);
        });
        exclusiveTail = run.catch(() => {});
        return run;
    }

    /** Runs work with resMan's frame running. */
    static async withFrame(work)
    {
        if (active++ === 0)
        {
            // Referenced on purpose: resMan settles its loads only in Update, so the frame keeps the process alive
            // while work waits on it, and stops when the last run ends.
            frame = setInterval(() => blue.resMan.Update(), 1);
        }
        try
        {
            return await work();
        }
        finally
        {
            if (--active === 0)
            {
                clearInterval(frame);
                frame = null;
            }
        }
    }

    /**
     * Stable identity for diagnostics and registration.
     * @type {string}
     */
    static className = "CjsToolBlueHost";

}
