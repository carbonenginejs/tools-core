import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseIndexGroupNamed } from "./CjsToolIndexGroup.js";
import { normalizeTargetId } from "../target/CjsToolTarget.js";
import { resolveDataRoot } from "../cache/resolveDataRoot.js";
import * as utils from "../utils.js";

/**
 * Resource indexes an operator hands us, for a client whose binaries are not
 * public.
 *
 * The app file index exists to DISCOVER two things: which resource indexes a
 * build has, and where their bytes are. A target that already holds those
 * bytes needs neither, and Frontier is that target - `resfileindex.txt` is a
 * hashed payload on a binaries host that answers 401 to everyone, while every
 * resource the index names is served publicly. One file stands between a
 * complete resource tree and nothing at all, and it is the one file that cannot
 * be fetched.
 *
 * So it is supplied instead, from an installed client or from whoever has one,
 * and this reads what was supplied. Nothing else about the target changes:
 * payloads still resolve against `remote.resBaseUrl`, content-addressed, and
 * the index still parses through `parseIndexGroupNamed` exactly as a fetched
 * one does.
 *
 * ## The builds that exist are the builds that were supplied
 *
 * A metadata file still answers "latest" with whatever the publisher shipped
 * this morning, and for a supplied target that answer is a build we cannot
 * read. The newest supplied build is the honest one: it is the newest we can
 * actually serve, and the number always names the index behind it.
 *
 * ## Layout
 *
 * ```
 * <data root>/games/<target>/indexes/<build>/resfileindex.txt
 *                                           /resfileindex_windows.txt
 *                                           /resfileindex_prefetch.txt
 * ```
 *
 * The file name carries the group name, the same rule the app index declares
 * by: `resfileindex.txt` is `main` and `resfileindex_<name>.txt` is `<name>`.
 * A build with no `resfileindex.txt` is not a supplied build, because a
 * resource tree with no main index is not one either.
 */
export class CjsToolIndexSuppliedStore
{

    /** Creates a store over the durable data root that holds supplied indexes. */
    constructor(dataRoot = resolveDataRoot())
    {
        this.directory = path.resolve(String(dataRoot));
        Object.freeze(this);
    }

    /** The directory one target's supplied build lives in. */
    GetDirectory(target, build)
    {
        return path.join(
            this.directory,
            "games",
            normalizeTargetId(target),
            "indexes",
            utils.normalizeExactBuild(build, {
                message: `Supplied indexes require an exact build: ${build}`,
            }),
        );
    }

    /** Every exact build supplied for one target, newest first. */
    async ListBuilds(target)
    {
        const root = path.join(
            this.directory,
            "games",
            normalizeTargetId(target),
            "indexes",
        );
        let names;

        try
        {
            names = await fs.readdir(root, { withFileTypes: true });
        }
        catch
        {
            // Nothing supplied is an ordinary state, not a failure: every other
            // target reads its index from the app index and has no such
            // directory at all.
            return [];
        }

        const builds = [];

        for (const entry of names)
        {
            if (!entry.isDirectory() || !utils.isExactBuild(entry.name)) continue;

            // A directory is only a build once its main index is in it. A half
            // copied drop - the directory made, the file still arriving - would
            // otherwise become the newest build and answer every request with
            // an empty tree.
            try
            {
                await fs.access(path.join(root, entry.name, "resfileindex.txt"));
                builds.push(entry.name);
            }
            catch { /* no main index: not a supplied build */ }
        }

        return builds.sort((left, right) => Number(right) - Number(left));
    }

    /** The build a reference means here: an exact one as given, anything else the newest. */
    async ResolveBuild(target, buildRef)
    {
        if (utils.isExactBuild(buildRef)) return String(buildRef).trim();

        const [ newest = null ] = await this.ListBuilds(target);

        return newest;
    }

    /**
     * Reads one supplied build's index groups, keyed by group name.
     *
     * @returns {Promise<Object|null>} null when that build was never supplied
     */
    async ReadGroups(target, build)
    {
        const directory = this.GetDirectory(target, build);
        let names;

        try
        {
            names = await fs.readdir(directory);
        }
        catch
        {
            return null;
        }

        const groups = {};

        for (const fileName of names.sort())
        {
            const match = fileName.match(/^resfileindex(?:_([^/]+))?\.(?:txt|json)$/iu);

            if (!match) continue;

            const name = (match[1] ?? "main").toLowerCase();
            const location = path.join(directory, fileName);

            groups[name] = parseIndexGroupNamed(
                fileName,
                await fs.readFile(location, "utf8"),
                {
                    kind: "resfileindex",
                    name,
                    root: "res",
                    // The path it was read from, because an index that came off
                    // this disk has no URL and saying `unknown://index` would
                    // hide the one thing worth knowing about it.
                    sourceUrl: pathToFileURL(location).href,
                },
            );
        }

        return groups.main ? groups : null;
    }

}
