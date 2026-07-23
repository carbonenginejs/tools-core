import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CjsRealtimeError } from "../CjsRealtimeError.js";
import { REALTIME_ROUTE } from "../CjsRealtimeProtocol.js";

const ENTRY_TOPIC = "resource.watch.entry.changed";
const STATUS_TOPIC = "resource.watch.status.changed";

/** Materialized logical-file service backed by an injected filesystem observer. */
export class CjsRealtimeResourceWatchService
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
        this.logicalRoot = CjsRealtimeResourceWatchService.normalizeLogicalRoot(logicalRoot);
        this.#accepting = false;
        this.#filesystem = filesystem;
        this.#clock = clock;
        this.#settleMs = CjsRealtimeResourceWatchService.normalizeLimit(
            settleMs,
            "settleMs",
            true,
        );
        this.#maxEntries = CjsRealtimeResourceWatchService.normalizeLimit(
            maxEntries,
            "maxEntries",
        );
        this.#maxPendingPaths = CjsRealtimeResourceWatchService.normalizeLimit(
            maxPendingPaths,
            "maxPendingPaths",
        );
        this.#maxDepth = CjsRealtimeResourceWatchService.normalizeLimit(
            maxDepth,
            "maxDepth",
        );
        this.#observe = observe ?? (options =>
            CjsRealtimeResourceWatchService.observe(this.#filesystem, options));
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
        this.#sourceStatus = CjsRealtimeResourceWatchService.createStatus(
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
        const relativePath = CjsRealtimeResourceWatchService.normalizeResourcePath(resourcePath);
        const entry = this.#catalog.get(relativePath);

        if (!entry)
        {
            throw new CjsRealtimeError("resource_not_found", "Resource was not found", {
                statusCode: 404,
            });
        }

        if (request.revision !== entry.revision)
        {
            throw CjsRealtimeResourceWatchService.revisionMismatch();
        }

        let handle;

        try
        {
            const physicalPath = this.#PhysicalPath(relativePath);
            const fileStat = await this.#filesystem.promises.lstat(physicalPath);

            if (fileStat.isSymbolicLink() || !fileStat.isFile())
            {
                this.#Schedule(relativePath, this.#clock());

                throw CjsRealtimeResourceWatchService.revisionMismatch();
            }

            const realPath = await this.#filesystem.promises.realpath(physicalPath);

            if (!CjsRealtimeResourceWatchService.isWithin(this.#rootRealPath, realPath))
            {
                throw new CjsRealtimeError("invalid_path", "Resource path escapes its root", {
                    statusCode: 400,
                });
            }

            handle = await this.#filesystem.promises.open(physicalPath, "r");
            const openedStat = await handle.stat();
            const openedEntry = this.#CreateEntry(relativePath, openedStat);

            if (openedEntry.revision !== request.revision)
            {
                this.#Schedule(relativePath, this.#clock());

                throw CjsRealtimeResourceWatchService.revisionMismatch();
            }

            const resource = {
                revision: openedEntry.revision,
                contentType: CjsRealtimeResourceWatchService.contentType(relativePath),
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

                throw CjsRealtimeResourceWatchService.revisionMismatch();
            }

            throw error;
        }
    }

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
            const relativePath = CjsRealtimeResourceWatchService.normalizeObserverPath(
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

    #OnObserverError()
    {
        if (this.#accepting)
        {
            this.#TrackHealth("observer_failed");
        }
    }

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

    #Track(operation, failureCode)
    {
        const tracked = Promise.resolve(operation).then(
            () => undefined,
            () => this.#SetHealth(failureCode),
        );

        this.#operations.add(tracked);
        tracked.then(() => this.#operations.delete(tracked));
    }

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

    #TrackHealth(code)
    {
        const operation = this.#SetHealth(code);

        this.#operations.add(operation);
        operation.then(
            () => this.#operations.delete(operation),
            () => this.#operations.delete(operation),
        );
    }

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

                this.#sourceStatus = CjsRealtimeResourceWatchService.createStatus(
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

    async #Apply(relativePath, scanned, occurredAt, context)
    {
        const currentPaths = [ ...this.#catalog.keys() ].filter(candidate =>
            CjsRealtimeResourceWatchService.isSameOrChild(relativePath, candidate));
        const finalSize = this.#catalog.size - currentPaths.length + scanned.size;

        if (finalSize > this.#maxEntries)
        {
            throw new CjsRealtimeError(
                "resource_limit",
                "Resource watch catalog exceeds its configured entry limit",
            );
        }

        const removed = currentPaths
            .filter(candidate => !scanned.has(candidate))
            .sort(CjsRealtimeResourceWatchService.compareRemovedPaths);

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

    async #Scan(relativePath)
    {
        const catalog = new Map();

        await this.#ScanPath(relativePath, 0, catalog);

        return catalog;
    }

    async #ScanPath(relativePath, depth, catalog)
    {
        if (depth > this.#maxDepth)
        {
            throw new CjsRealtimeError(
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

        if (!CjsRealtimeResourceWatchService.isWithin(this.#rootRealPath, realPath))
        {
            throw new CjsRealtimeError("invalid_path", "Resource path escapes its root");
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
            const normalized = CjsRealtimeResourceWatchService.normalizeObserverPath(
                childPath,
                this.root,
            );

            await this.#ScanPath(normalized, depth + 1, catalog);

            if (catalog.size > this.#maxEntries)
            {
                throw new CjsRealtimeError(
                    "resource_limit",
                    "Resource watch catalog exceeds its configured entry limit",
                );
            }
        }
    }

    #CreateEntry(relativePath, fileStat)
    {
        const revision = CjsRealtimeResourceWatchService.createRevision(fileStat);
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

    #PhysicalPath(relativePath)
    {
        const segments = relativePath === "" ? [] : relativePath.split("/");
        const candidate = path.resolve(this.root, ...segments);

        if (!CjsRealtimeResourceWatchService.isWithin(this.root, candidate))
        {
            throw new CjsRealtimeError("invalid_path", "Resource path escapes its root", {
                statusCode: 400,
            });
        }

        return candidate;
    }

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
            throw new CjsRealtimeError("invalid_path", "Resource path is invalid", {
                statusCode: 400,
            });
        }

        const segments = value.split("/");

        if (segments.some(segment => segment === "" || segment === "." || segment === ".."))
        {
            throw new CjsRealtimeError("invalid_path", "Resource path is invalid", {
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

        return CjsRealtimeResourceWatchService.normalizeResourcePath(candidate);
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
        return new CjsRealtimeError(
            "revision_mismatch",
            "Resource revision no longer matches",
            { statusCode: 409, retryable: true },
        );
    }

}
