import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CjsToolRealtimeError } from "../CjsToolRealtimeError.js";
import { REALTIME_ROUTE } from "../CjsToolRealtimeProtocol.js";

const ENTRY_TOPIC = "resource.watch.entry.changed";
const STATUS_TOPIC = "resource.watch.status.changed";

/** Materialized logical-file service backed by an injected filesystem observer. */
export class CjsToolRealtimeResourceWatchService
{

    #catalog;

    #accepting;

    #clock;

    #context;

    #filesystem;

    #sourceStatus;

    #initializing;

    #maxDepth;

    #maxEntries;

    #maxPendingPaths;

    #observe;

    #observer;

    #operations;

    #pendingChanges;

    #rootRealPath;

    #running;

    #settleMs;

    #timers;

    /**
     * Configures a bounded, symlink-safe filesystem catalog and its debounced
     * realtime observation policy.
     */
    constructor({
        id,
        root,
        logicalRoot = "res:/",
        observe,
        filesystem = fs,
        clock = () => Date.now(),
        settleMs = 50,
        maxEntries = 10000,
        maxPendingPaths = 4096,
        maxDepth = 64,
    } = {})
    {
        if (typeof id !== "string" || id.length === 0)
        {
            throw new TypeError("Resource watch service requires an id");
        }

        if (typeof root !== "string" || root.length === 0)
        {
            throw new TypeError("Resource watch service requires a physical root");
        }

        if (!filesystem?.promises || typeof filesystem.watch !== "function")
        {
            throw new TypeError("Resource watch filesystem must provide promises and watch()");
        }

        if (observe !== undefined && typeof observe !== "function")
        {
            throw new TypeError("Resource watch observe option must be a function");
        }

        if (typeof clock !== "function")
        {
            throw new TypeError("Resource watch clock must be a function");
        }

        this.id = id;
        this.root = path.resolve(root);
        this.logicalRoot = CjsToolRealtimeResourceWatchService.normalizeLogicalRoot(logicalRoot);
        this.#accepting = false;
        this.#filesystem = filesystem;
        this.#clock = clock;
        this.#settleMs = CjsToolRealtimeResourceWatchService.normalizeLimit(
            settleMs,
            "settleMs",
            true,
        );
        this.#maxEntries = CjsToolRealtimeResourceWatchService.normalizeLimit(
            maxEntries,
            "maxEntries",
        );
        this.#maxPendingPaths = CjsToolRealtimeResourceWatchService.normalizeLimit(
            maxPendingPaths,
            "maxPendingPaths",
        );
        this.#maxDepth = CjsToolRealtimeResourceWatchService.normalizeLimit(
            maxDepth,
            "maxDepth",
        );
        this.#observe = observe ?? (options =>
            CjsToolRealtimeResourceWatchService.observe(this.#filesystem, options));
        this.#catalog = new Map();
        this.#context = null;
        this.#sourceStatus = null;
        this.#initializing = false;
        this.#observer = null;
        this.#operations = new Set();
        this.#pendingChanges = new Map();
        this.#rootRealPath = null;
        this.#running = false;
        this.#timers = new Map();
    }

    /** Declares the provider-neutral resource.watch family surface. */
    Describe()
    {
        return {
            family: "resource.watch",
            familyVersion: 1,
            kind: "filesystem.watch",
            id: this.id,
            topics: [
                { name: ENTRY_TOPIC, recovery: "snapshot" },
                { name: STATUS_TOPIC, recovery: "snapshot" },
            ],
            commands: [],
            snapshot: true,
            resources: true,
        };
    }

    /** Starts observation before scanning and reconciles changes that race initialization. */
    async Start(context)
    {
        if (this.#running)
        {
            return;
        }

        this.#context = context;
        this.#accepting = true;
        this.#initializing = true;
        this.#running = true;
        this.#sourceStatus = CjsToolRealtimeResourceWatchService.createStatus(
            "ready",
            null,
            this.#clock(),
        );

        try
        {
            context.signal.addEventListener("abort", () =>
            {
                this.#accepting = false;
            }, { once: true });
            const rootStat = await this.#filesystem.promises.lstat(this.root);

            if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
            {
                throw new TypeError(
                    "Resource watch physical root must be a non-symlink directory",
                );
            }

            this.#rootRealPath = await this.#filesystem.promises.realpath(this.root);
            this.#observer = await this.#observe({
                root: this.root,
                signal: context.signal,
                onChange: change => this.#OnChange(change),
                onError: () => this.#OnObserverError(),
            });

            if (typeof this.#observer !== "function"
                && typeof this.#observer?.Close !== "function"
                && typeof this.#observer?.close !== "function")
            {
                throw new TypeError("Resource watch observer must provide a close operation");
            }

            const catalog = await this.#Scan("");

            this.#catalog = catalog;
            this.#initializing = false;

            for (const [ relativePath, occurredAt ] of this.#pendingChanges)
            {
                this.#Schedule(relativePath, occurredAt);
            }

            this.#pendingChanges.clear();
        }
        catch (error)
        {
            await this.#CloseObserver().catch(() => undefined);
            this.#Reset();

            throw error;
        }
    }

    /** Stops observation, pending timers, and admitted reconciliation work. */
    async Stop()
    {
        if (!this.#running)
        {
            return;
        }

        this.#running = false;
        this.#accepting = false;
        this.#initializing = false;

        for (const timer of this.#timers.values())
        {
            clearTimeout(timer);
        }

        this.#timers.clear();
        this.#pendingChanges.clear();
        const [ closeResult ] = await Promise.allSettled([
            this.#CloseObserver(),
            ...this.#operations,
        ]);

        this.#Reset();

        if (closeResult.status === "rejected")
        {
            throw closeResult.reason;
        }
    }

    /** Returns the current deterministic logical catalog and observer health. */
    async GetSnapshot()
    {
        return {
            logicalRoot: this.logicalRoot,
            revisionStrength: "size-mtime-v1",
            status: this.#sourceStatus,
            entries: [ ...this.#catalog.values() ]
                .sort((left, right) => left.path.localeCompare(right.path)),
        };
    }

    /** Opens one revision-checked logical file without exposing its physical path. */
    async OpenResource(resourcePath, request)
    {
        const relativePath = CjsToolRealtimeResourceWatchService.normalizeResourcePath(resourcePath);
        const entry = this.#catalog.get(relativePath);

        if (!entry)
        {
            throw new CjsToolRealtimeError("resource_not_found", "Resource was not found", {
                statusCode: 404,
            });
        }

        if (request.revision !== entry.revision)
        {
            throw CjsToolRealtimeResourceWatchService.revisionMismatch();
        }

        let handle;

        try
        {
            const physicalPath = this.#PhysicalPath(relativePath);
            const fileStat = await this.#filesystem.promises.lstat(physicalPath);

            if (fileStat.isSymbolicLink() || !fileStat.isFile())
            {
                this.#Schedule(relativePath, this.#clock());

                throw CjsToolRealtimeResourceWatchService.revisionMismatch();
            }

            const realPath = await this.#filesystem.promises.realpath(physicalPath);

            if (!CjsToolRealtimeResourceWatchService.isWithin(this.#rootRealPath, realPath))
            {
                throw new CjsToolRealtimeError("invalid_path", "Resource path escapes its root", {
                    statusCode: 400,
                });
            }

            handle = await this.#filesystem.promises.open(physicalPath, "r");
            const openedStat = await handle.stat();
            const openedEntry = this.#CreateEntry(relativePath, openedStat);

            if (openedEntry.revision !== request.revision)
            {
                this.#Schedule(relativePath, this.#clock());

                throw CjsToolRealtimeResourceWatchService.revisionMismatch();
            }

            const resource = {
                revision: openedEntry.revision,
                contentType: CjsToolRealtimeResourceWatchService.contentType(relativePath),
                contentLength: openedEntry.byteSize,
                lastModified: openedEntry.modifiedAt,
                etag: `"${openedEntry.revision}"`,
            };

            if (request.method === "HEAD")
            {
                await handle.close();
                handle = null;

                return resource;
            }

            resource.body = handle.createReadStream({ autoClose: true });
            handle = null;

            return resource;
        }
        catch (error)
        {
            await handle?.close().catch(() => undefined);

            if ([ "ENOENT", "ENOTDIR" ].includes(error?.code))
            {
                this.#Schedule(relativePath, this.#clock());

                throw CjsToolRealtimeResourceWatchService.revisionMismatch();
            }

            throw error;
        }
    }

    /**
     * Normalizes an observer path and queues it for initialization replay or
     * settled reconciliation.
     */
    #OnChange(change)
    {
        if (!this.#accepting)
        {
            return;
        }

        try
        {
            const source = typeof change === "string" || change === null
                ? { path: change }
                : change;
            const relativePath = CjsToolRealtimeResourceWatchService.normalizeObserverPath(
                source?.path,
                this.root,
            );
            const occurredAt = source?.occurredAt ?? this.#clock();

            if (this.#initializing)
            {
                this.#QueuePending(relativePath, occurredAt);

                return;
            }

            this.#Schedule(relativePath, occurredAt);
        }
        catch
        {
            this.#TrackHealth("invalid_observer_path");
        }
    }

    /** Marks the live source degraded after its filesystem observer fails. */
    #OnObserverError()
    {
        if (this.#accepting)
        {
            this.#TrackHealth("observer_failed");
        }
    }

    /**
     * Debounces one path reconciliation and collapses an overflowing pending set
     * to a root rescan.
     */
    #Schedule(relativePath, occurredAt)
    {
        if (!this.#accepting)
        {
            return;
        }

        if (this.#timers.has(""))
        {
            relativePath = "";
        }
        else if (!this.#timers.has(relativePath)
            && this.#timers.size >= this.#maxPendingPaths)
        {
            for (const timer of this.#timers.values())
            {
                clearTimeout(timer);
            }

            this.#timers.clear();
            relativePath = "";
        }

        const current = this.#timers.get(relativePath);

        if (current)
        {
            clearTimeout(current);
        }

        const timer = setTimeout(() =>
        {
            this.#timers.delete(relativePath);
            const operation = this.#context.Commit(async context =>
            {
                const catalog = await this.#Scan(relativePath);

                await this.#Apply(relativePath, catalog, occurredAt, context);
            });

            this.#Track(operation, "reconcile_failed");
        }, this.#settleMs);

        timer.unref?.();
        this.#timers.set(relativePath, timer);
    }

    /**
     * Keeps reconciliation work drainable and maps rejection to a source-health
     * reason.
     */
    #Track(operation, failureCode)
    {
        const tracked = Promise.resolve(operation).then(
            () => undefined,
            () => this.#SetHealth(failureCode),
        );

        this.#operations.add(tracked);
        tracked.then(() => this.#operations.delete(tracked));
    }

    /**
     * Retains initialization-time changes within the path bound, collapsing
     * overflow to the root.
     */
    #QueuePending(relativePath, occurredAt)
    {
        if (this.#pendingChanges.has(""))
        {
            this.#pendingChanges.set("", occurredAt);

            return;
        }

        if (!this.#pendingChanges.has(relativePath)
            && this.#pendingChanges.size >= this.#maxPendingPaths)
        {
            this.#pendingChanges.clear();
            this.#pendingChanges.set("", occurredAt);

            return;
        }

        this.#pendingChanges.set(relativePath, occurredAt);
    }

    /** Starts and tracks a best-effort degraded-status publication. */
    #TrackHealth(code)
    {
        const operation = this.#SetHealth(code);

        this.#operations.add(operation);
        operation.then(
            () => this.#operations.delete(operation),
            () => this.#operations.delete(operation),
        );
    }

    /**
     * Commits one changed source-health reason while tolerating shutdown or
     * stream replacement.
     */
    async #SetHealth(code)
    {
        if (!this.#accepting || !this.#context || this.#sourceStatus?.reasonCode === code)
        {
            return;
        }

        try
        {
            await this.#context.Commit(async context =>
            {
                if (!this.#accepting || this.#sourceStatus?.reasonCode === code)
                {
                    return;
                }

                this.#sourceStatus = CjsToolRealtimeResourceWatchService.createStatus(
                    "degraded",
                    code,
                    this.#clock(),
                );
                await context.Publish(STATUS_TOPIC, this.#sourceStatus);
            });
        }
        catch
        {
            // Shutdown or stream replacement makes the retained context unusable.
        }
    }

    /**
     * Diffs a rescanned subtree into ordered remove, update, and add events
     * under the catalog bound.
     */
    async #Apply(relativePath, scanned, occurredAt, context)
    {
        const currentPaths = [ ...this.#catalog.keys() ].filter(candidate =>
            CjsToolRealtimeResourceWatchService.isSameOrChild(relativePath, candidate));
        const finalSize = this.#catalog.size - currentPaths.length + scanned.size;

        if (finalSize > this.#maxEntries)
        {
            throw new CjsToolRealtimeError(
                "resource_limit",
                "Resource watch catalog exceeds its configured entry limit",
            );
        }

        const removed = currentPaths
            .filter(candidate => !scanned.has(candidate))
            .sort(CjsToolRealtimeResourceWatchService.compareRemovedPaths);

        for (const candidate of removed)
        {
            const previous = this.#catalog.get(candidate);

            this.#catalog.delete(candidate);
            await context.Publish(ENTRY_TOPIC, {
                operation: "remove",
                path: candidate,
                entry: null,
                previousRevision: previous.revision,
            }, { occurredAt });
        }

        for (const [ candidate, entry ] of [ ...scanned ].sort(([ left ], [ right ]) =>
            left.localeCompare(right)))
        {
            const previous = this.#catalog.get(candidate);

            if (previous?.revision === entry.revision)
            {
                continue;
            }

            const operation = previous ? "update" : "add";

            this.#catalog.set(candidate, entry);
            await context.Publish(ENTRY_TOPIC, {
                operation,
                path: candidate,
                entry,
                previousRevision: previous?.revision ?? null,
            }, { occurredAt });
        }
    }

    /**
     * Builds a fresh catalog for one normalized path by recursively inspecting
     * its subtree.
     */
    async #Scan(relativePath)
    {
        const catalog = new Map();

        await this.#ScanPath(relativePath, 0, catalog);

        return catalog;
    }

    /**
     * Recursively scans safe real paths while skipping links and enforcing depth
     * and entry limits.
     */
    async #ScanPath(relativePath, depth, catalog)
    {
        if (depth > this.#maxDepth)
        {
            throw new CjsToolRealtimeError(
                "resource_limit",
                "Resource watch scan exceeds its configured depth limit",
            );
        }

        const physicalPath = this.#PhysicalPath(relativePath);
        let fileStat;

        try
        {
            fileStat = await this.#filesystem.promises.lstat(physicalPath);
        }
        catch (error)
        {
            if ([ "ENOENT", "ENOTDIR" ].includes(error?.code))
            {
                return;
            }

            throw error;
        }

        if (fileStat.isSymbolicLink())
        {
            return;
        }

        const realPath = await this.#filesystem.promises.realpath(physicalPath);

        if (!CjsToolRealtimeResourceWatchService.isWithin(this.#rootRealPath, realPath))
        {
            throw new CjsToolRealtimeError("invalid_path", "Resource path escapes its root");
        }

        if (fileStat.isFile())
        {
            if (relativePath !== "")
            {
                catalog.set(relativePath, this.#CreateEntry(relativePath, fileStat));
            }

            return;
        }

        if (!fileStat.isDirectory())
        {
            return;
        }

        const entries = await this.#filesystem.promises.readdir(physicalPath, {
            withFileTypes: true,
        });

        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name)))
        {
            const childPath = relativePath === ""
                ? entry.name
                : `${relativePath}/${entry.name}`;
            const normalized = CjsToolRealtimeResourceWatchService.normalizeObserverPath(
                childPath,
                this.root,
            );

            await this.#ScanPath(normalized, depth + 1, catalog);

            if (catalog.size > this.#maxEntries)
            {
                throw new CjsToolRealtimeError(
                    "resource_limit",
                    "Resource watch catalog exceeds its configured entry limit",
                );
            }
        }
    }

    /**
     * Creates immutable file metadata and a revision-pinned realtime content
     * reference.
     */
    #CreateEntry(relativePath, fileStat)
    {
        const revision = CjsToolRealtimeResourceWatchService.createRevision(fileStat);
        const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");

        return Object.freeze({
            path: relativePath,
            type: "file",
            byteSize: fileStat.size,
            modifiedAt: new Date(fileStat.mtimeMs).toISOString(),
            revision,
            contentRef: `${REALTIME_ROUTE}/services/${encodeURIComponent(this.id)}`
                + `/content/${encodedPath}?revision=${encodeURIComponent(revision)}`,
        });
    }

    /**
     * Resolves a relative catalog path and rejects any candidate outside the
     * configured root.
     */
    #PhysicalPath(relativePath)
    {
        const segments = relativePath === "" ? [] : relativePath.split("/");
        const candidate = path.resolve(this.root, ...segments);

        if (!CjsToolRealtimeResourceWatchService.isWithin(this.root, candidate))
        {
            throw new CjsToolRealtimeError("invalid_path", "Resource path escapes its root", {
                statusCode: 400,
            });
        }

        return candidate;
    }

    /**
     * Releases an injected observer through its function, PascalCase, or
     * lowercase close contract.
     */
    async #CloseObserver()
    {
        const observer = this.#observer;

        this.#observer = null;

        if (typeof observer === "function")
        {
            await observer();
        }
        else if (typeof observer?.Close === "function")
        {
            await observer.Close();
        }
        else if (typeof observer?.close === "function")
        {
            await observer.close();
        }
    }

    /**
     * Clears catalog, observer, health, pending changes, timers, operations, and
     * lifecycle state.
     */
    #Reset()
    {
        this.#catalog = new Map();
        this.#accepting = false;
        this.#context = null;
        this.#sourceStatus = null;
        this.#initializing = false;
        this.#observer = null;
        this.#operations = new Set();
        this.#pendingChanges = new Map();
        this.#rootRealPath = null;
        this.#running = false;
        this.#timers = new Map();
    }

    /** Starts the default recursive Node filesystem observer. */
    static observe(filesystem, { root, onChange, onError })
    {
        const watcher = filesystem.watch(root, { recursive: true }, (_eventType, filename) =>
        {
            onChange({
                path: filename === null ? "" : filename.toString(),
            });
        });

        watcher.on("error", onError);

        return watcher;
    }

    /** Validates the public logical root label. */
    static normalizeLogicalRoot(value)
    {
        if (typeof value !== "string" || !/^[a-z][a-z0-9+.-]*:\/$/u.test(value))
        {
            throw new TypeError("Resource watch logicalRoot must use a scheme:/ form");
        }

        return value;
    }

    /** Validates one client-visible relative resource path. */
    static normalizeResourcePath(value)
    {
        if (typeof value !== "string" || value.length === 0 || value.length > 2048
            || value.includes("\\") || value.includes("\0") || value.includes(":")
            || /%(?:00|2e|2f|3a|5c)/iu.test(value))
        {
            throw new CjsToolRealtimeError("invalid_path", "Resource path is invalid", {
                statusCode: 400,
            });
        }

        const segments = value.split("/");

        if (segments.some(segment => segment === "" || segment === "." || segment === ".."))
        {
            throw new CjsToolRealtimeError("invalid_path", "Resource path is invalid", {
                statusCode: 400,
            });
        }

        return segments.join("/");
    }

    /** Normalizes an observer-owned relative or contained absolute path. */
    static normalizeObserverPath(value, root)
    {
        if (value === null || value === undefined || value === "")
        {
            return "";
        }

        if (typeof value !== "string")
        {
            throw new TypeError("Resource observer path must be a string");
        }

        let candidate = value;

        if (path.isAbsolute(candidate) || path.win32.isAbsolute(candidate))
        {
            candidate = path.relative(root, path.resolve(candidate));
        }

        candidate = candidate.replaceAll("\\", "/");

        if (candidate.length === 0)
        {
            return "";
        }

        return CjsToolRealtimeResourceWatchService.normalizeResourcePath(candidate);
    }

    /** Creates an opaque weak revision from stable file metadata. */
    static createRevision(fileStat)
    {
        const source = `file\0${fileStat.size}\0${fileStat.mtimeMs}`;

        return crypto.createHash("sha256").update(source).digest("base64url").slice(0, 32);
    }

    /** Creates one public source-status record without leaking provider errors. */
    static createStatus(state, reasonCode, occurredAt)
    {
        return Object.freeze({
            state,
            reasonCode,
            retryable: false,
            occurredAt: new Date(occurredAt).toISOString(),
        });
    }

    /** Returns a conservative content type for common logical resources. */
    static contentType(resourcePath)
    {
        const extension = path.extname(resourcePath).toLowerCase();
        const types = {
            ".css": "text/css; charset=utf-8",
            ".gif": "image/gif",
            ".html": "text/html; charset=utf-8",
            ".jpeg": "image/jpeg",
            ".jpg": "image/jpeg",
            ".js": "text/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".mjs": "text/javascript; charset=utf-8",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".txt": "text/plain; charset=utf-8",
            ".webp": "image/webp",
        };

        return types[extension] ?? "application/octet-stream";
    }

    /** Returns true when a resolved path is the root or one of its children. */
    static isWithin(root, candidate)
    {
        const relative = path.relative(root, candidate);

        return relative === "" || (!relative.startsWith(`..${path.sep}`)
            && relative !== ".." && !path.isAbsolute(relative));
    }

    /** Returns true when a catalog path belongs to one reconciled subtree. */
    static isSameOrChild(parent, candidate)
    {
        return parent === "" || candidate === parent || candidate.startsWith(`${parent}/`);
    }

    /** Orders removed children before their former parent path. */
    static compareRemovedPaths(left, right)
    {
        const depth = right.split("/").length - left.split("/").length;

        return depth || left.localeCompare(right);
    }

    /** Validates one bounded integer option. */
    static normalizeLimit(value, name, allowZero = false)
    {
        if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
        {
            throw new TypeError(`Resource watch ${name} must be a bounded integer`);
        }

        return value;
    }

    /** Creates the stable response used when revision-pinned bytes have changed. */
    static revisionMismatch()
    {
        return new CjsToolRealtimeError(
            "revision_mismatch",
            "Resource revision no longer matches",
            { statusCode: 409, retryable: true },
        );
    }

}
