import { performance } from "node:perf_hooks";

/**
 * Coordinates idle expiry and request-safe retirement of service build caches.
 *
 * This is Node service policy for multiple client builds, not a port of Carbon's
 * resource cache. JavaScript garbage collection does not expose deterministic
 * external-owner reference counts, so HTTP handler completion is the explicit
 * safe boundary for closing SQLite handles and retiring dependent composers.
 */
export class CjsToolBuildCache
{
    #maps = [];
    #groups = new Map();
    #current = new Map();
    #active = 0;
    #drained = null;
    #maintenance = null;
    #timer = null;
    #now;
    #closed = false;

    /** Creates one service policy; standalone repositories need not opt in. */
    constructor({ idleMs = 60000, currentIdleMs = 600000, currentBuildsPerTarget = 1,
        maximumBuilds = 2, maximumEntries = 64, sweepMs = 10000,
        now = () => performance.now() } = {})
    {
        for (const [name, value] of Object.entries({ idleMs, currentIdleMs,
            currentBuildsPerTarget, maximumBuilds, maximumEntries, sweepMs }))
        {
            if (!Number.isSafeInteger(value) || value < 1)
            {
                throw new TypeError(`${name} must be a positive integer`);
            }
        }
        this.idleMs = idleMs;
        this.currentIdleMs = currentIdleMs;
        this.currentBuildsPerTarget = currentBuildsPerTarget;
        this.maximumBuilds = maximumBuilds;
        this.maximumEntries = maximumEntries;
        this.sweepMs = sweepMs;
        this.#now = now;
    }

    /** Registers a Map whose normal deletion never disposes a live owner. */
    CreateMap(name, identity, { close = null, dependent = false } = {})
    {
        const map = new Map();
        const entries = new Map();
        const descriptor = { name, map, entries, identity, close, dependent };
        this.#maps.push(descriptor);
        const touch = key =>
        {
            if (!Map.prototype.has.call(map, key)) return;
            const pair = entries.get(key) ?? identity(key);
            this.#Touch(pair);
        };
        map.get = key =>
        {
            touch(key);
            return Map.prototype.get.call(map, key);
        };
        map.has = key =>
        {
            touch(key);
            return Map.prototype.has.call(map, key);
        };
        map.set = (key, value) =>
        {
            const pair = entries.get(key) ?? identity(key);
            entries.set(key, pair);
            this.#Touch(pair);
            return Map.prototype.set.call(map, key, value);
        };
        map.delete = key =>
        {
            entries.delete(key);
            return Map.prototype.delete.call(map, key);
        };
        map.clear = () =>
        {
            entries.clear();
            Map.prototype.clear.call(map);
        };
        return map;
    }

    /** Associates a resolved fallback with its actual target/build identity. */
    SetIdentity(map, key, target, build, facet = null)
    {
        const descriptor = this.#maps.find(item => item.map === map);
        if (!descriptor || !Map.prototype.has.call(map, key)) return;
        const previous = descriptor.entries.get(key);
        const requested = descriptor.identity(key);
        if (previous)
        {
            for (const currentFacet of facet === null ? [] : [facet])
            {
                const currentKey = JSON.stringify([previous[0], currentFacet]);
                const values = this.#current.get(currentKey);
                if (values && previous[0] === target)
                {
                    this.#current.set(currentKey, [...new Set(values.map(value =>
                        value === String(previous[1]) || value === String(requested[1]) ? String(build) : value))]);
                }
            }
        }
        descriptor.entries.set(key, [target, String(build)]);
        this.#Touch([target, String(build)]);
    }

    /** Remembers resources and SDE independently as one current target pair. */
    MarkCurrent(target, facet, build)
    {
        const key = JSON.stringify([target, facet]);
        const values = this.#current.get(key) ?? [];
        const value = String(build);
        this.#current.set(key, [value, ...values.filter(item => item !== value)]
            .slice(0, this.currentBuildsPerTarget));
    }

    /** Protects the complete handler, including asynchronous source adoption. */
    async Run(operation)
    {
        while (this.#maintenance) await this.#maintenance;
        if (this.#closed) throw new Error("Build cache is closed");
        this.#active++;
        try
        {
            return await operation();
        }
        finally
        {
            this.#active--;
            if (this.#active === 0 && this.#drained) this.#drained();
            // Count limits are a backstop after expiry, including under steady traffic.
            if (!this.#maintenance && this.#OverBudget())
            {
                void this.Sweep().catch(error => process.emitWarning(error));
            }
        }
    }

    /** Starts the service's single unref'd expiry timer. */
    Start()
    {
        if (!this.#timer)
        {
            this.#timer = setInterval(() =>
            {
                void this.Sweep().catch(error => process.emitWarning(error));
            }, this.sweepMs);
            this.#timer.unref();
        }
    }

    /** Retires idle groups first, then the oldest groups above total budgets. */
    Sweep()
    {
        if (this.#maintenance) return this.#maintenance;
        // Defer work until the barrier is published, so new handlers wait even
        // when the first retirement can complete without yielding.
        const work = Promise.resolve().then(async () =>
        {
            if (this.#active) await new Promise(resolve => { this.#drained = resolve; });
            this.#drained = null;
            this.#PruneGroups();
            const now = this.#now();
            const expired = new Set();
            for (const [key, group] of this.#groups)
            {
                const ttl = this.#IsCurrent(group) ? this.currentIdleMs : this.idleMs;
                if (this.#closed || now - group.lastUsed >= ttl) expired.add(key);
            }
            await this.#Retire(expired);
            while (this.#OverBudget())
            {
                const candidates = new Map();
                for (const [key, group] of this.#groups)
                {
                    const unit = this.#UnitKey(key, group);
                    const candidate = candidates.get(unit) ?? { keys: new Set(), lastUsed: -Infinity };
                    candidate.keys.add(key);
                    candidate.lastUsed = Math.max(candidate.lastUsed, group.lastUsed);
                    candidates.set(unit, candidate);
                }
                let oldest = null;
                for (const candidate of candidates.values())
                {
                    if (!oldest || candidate.lastUsed < oldest.lastUsed) oldest = candidate;
                }
                if (!oldest) break;
                await this.#Retire(oldest.keys);
            }
        });
        this.#maintenance = work.finally(() => { this.#maintenance = null; });
        return this.#maintenance;
    }

    /** Stops the timer, waits for handlers, and closes every retained owner. */
    async Close()
    {
        this.#closed = true;
        clearInterval(this.#timer);
        this.#timer = null;
        if (this.#maintenance) await this.#maintenance;
        await this.Sweep();
        this.#current.clear();
    }

    /** Reports reference counts without guessing retained bytes or forcing GC. */
    GetStats()
    {
        this.#PruneGroups();
        return {
            activeRequests: this.#active,
            builds: this.#groups.size,
            residentUnits: this.#Units(),
            entries: this.#maps.reduce((sum, item) => sum + item.map.size, 0),
            owners: Object.fromEntries(this.#maps.map(item => [item.name, item.map.size]))
        };
    }

    /** Refreshes one exact owner identity on a successful cache access. */
    #Touch([target, build])
    {
        const key = JSON.stringify([target, String(build)]);
        this.#groups.set(key, { target, build: String(build), lastUsed: this.#now() });
    }

    /** Tests whether either current facet still identifies this build. */
    #IsCurrent(group)
    {
        return ["resources", "sde"].some(facet =>
            (this.#current.get(JSON.stringify([group.target, facet])) ?? []).includes(group.build));
    }

    /** Counts a current resources/SDE pair once and each pinned build separately. */
    #Units()
    {
        let units = 0;
        const current = new Map();
        for (const group of this.#groups.values())
        {
            if (!this.#IsCurrent(group))
            {
                units++;
                continue;
            }
            const counts = current.get(group.target) ?? { resources: 0, sde: 0 };
            for (const facet of ["resources", "sde"])
            {
                if ((this.#current.get(JSON.stringify([group.target, facet])) ?? []).includes(group.build))
                {
                    counts[facet]++;
                }
            }
            current.set(group.target, counts);
        }
        for (const counts of current.values()) units += Math.max(counts.resources, counts.sde);
        // Several requested SDE builds may fall back to the same actual build,
        // but each opening can still own a distinct database and decoded tables.
        // Charge these duplicates separately instead of hiding them in one pair.
        let duplicates = 0;
        for (const item of this.#maps)
        {
            if (!item.close) continue;
            const owners = new Map();
            for (const [key, value] of item.map)
            {
                const identity = JSON.stringify(item.entries.get(key));
                const values = owners.get(identity) ?? new Set();
                values.add(value);
                owners.set(identity, values);
            }
            for (const values of owners.values()) duplicates += values.size - 1;
        }
        return units + duplicates;
    }

    /** Keeps current facets of a target together during budget retirement. */
    #UnitKey(key, group)
    {
        return this.#IsCurrent(group) ? JSON.stringify([group.target, "current"]) : key;
    }

    /** Checks the secondary service-wide count limits. */
    #OverBudget()
    {
        this.#PruneGroups();
        return this.#Units() > this.maximumBuilds
            || this.#maps.reduce((sum, item) => sum + item.map.size, 0) > this.maximumEntries;
    }

    /** Drops bookkeeping for failed loads and ordinary recency deletions. */
    #PruneGroups()
    {
        const present = new Set();
        for (const item of this.#maps)
        {
            for (const key of item.map.keys()) present.add(JSON.stringify(item.entries.get(key)));
        }
        for (const key of this.#groups.keys()) if (!present.has(key)) this.#groups.delete(key);
    }

    /** Removes every reference before closing selected SDE sources. */
    async #Retire(keys)
    {
        if (!keys.size) return;
        const closing = [];
        for (const item of this.#maps)
        {
            for (const [key, value] of item.map)
            {
                if (!keys.has(JSON.stringify(item.entries.get(key)))) continue;
                item.map.delete(key);
                if (item.close) closing.push({ value, close: item.close });
            }
        }
        if (closing.length)
        {
            // Localisation may retain an English-reference SDE from another
            // target. Invalidate all SDE-dependent composers before any close.
            for (const item of this.#maps) if (item.dependent) item.map.clear();
        }
        this.#PruneGroups();
        const closed = new Set();
        const results = await Promise.allSettled(closing.map(async item =>
        {
            let value;
            try
            {
                value = await item.value;
            }
            catch
            {
                return;
            }
            if (closed.has(value)) return;
            closed.add(value);
            await item.close(value);
        }));
        const failure = results.find(result => result.status === "rejected");
        if (failure) throw failure.reason;
    }
}
