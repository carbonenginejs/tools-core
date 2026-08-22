/**
 * Which build a caller is served, and why.
 *
 * This is the *policy* half of the build authority. It is deliberately not the
 * discovery half: what builds exist upstream is an observed fact, and merging
 * the two stores is the mistake the design exists to avoid — once they are one
 * document, "is that build missing, or refused?" stops having an answer.
 *
 * So this reads a small operator-owned file of pins and holds, and answers
 * questions of the form "upstream says N, what do I serve?". It never fetches
 * anything, never writes, and has no opinion about what upstream said.
 *
 * ## Every answer says why
 *
 *     { build, reason, observedLatest, since?, note? }
 *
 * That is the point of the whole exercise, not decoration. `latest` resolving
 * silently across two different worlds produced a number that was accurate and
 * unattributed, and an agent drew a confident wrong architectural conclusion
 * from it. A resolution that explains itself kills that class of error.
 *
 * ## The file
 *
 *     <data>/build-policy.json
 *
 * ```jsonc
 * {
 *   "schema": "carbon.buildPolicy",
 *   "version": 1,
 *   "targets": {
 *     "eve": {
 *       "resources": { "pin": "3000000", "since": "2026-08-15", "note": "why" },
 *       "sde": { "hold": true, "since": "2026-08-15", "note": "why" }
 *     }
 *   }
 * }
 * ```
 *
 * A pin and a hold are different intents. **Pinned** names a build and serves
 * it whatever upstream does. **Held** refuses to move past what is already
 * cached — the caller keeps whatever it has rather than following a new build —
 * which is what an operator wants during an incident, when the newest build is
 * suspected rather than known bad.
 *
 * `since` and `note` are not optional in spirit. A pin outliving its reason is
 * the likely rot here, and a pin with no date cannot be reported as stale.
 *
 * @see /docs/internal/decisions/build-authority.md
 */
import fs from "node:fs/promises";
import path from "node:path";

/** The file an operator edits, at the durable data root. */
export const POLICY_FILE = "build-policy.json";

const SCHEMA = "carbon.buildPolicy";
const SCHEMA_VERSION = 1;

/** Why a build was chosen. Every answer carries exactly one of these. */
export const REASONS = Object.freeze({
    /** Nothing said otherwise; this is what upstream reports. */
    newestObserved: "newest-observed",
    /**
     * The newest build that passed verification, which is not always the newest
     * that exists.
     *
     * A deployment that holds one SDE and one file index per target cannot
     * roll back by keeping the old one, so moving is a decision rather than a
     * default. What makes it safe is a gate that runs ccpwgl against the
     * candidate and loads real files, because the failure being guarded against
     * is a changed `.black` definition — which no amount of comparing build
     * numbers can detect.
     *
     * A verification is a *fact* and belongs in the observation log with the
     * build it concerns; this reason is the policy consuming it.
     */
    newestVerified: "newest-verified",
    /** An operator named this exact build. */
    pinned: "pinned",
    /** An operator refused to advance; this is what was already held. */
    held: "held",
    /** Upstream could not be reached, and this is the last thing we knew. */
    lastObserved: "last-observed",
});

export class CjsToolBuildPolicy
{

    #targets;

    constructor(document = {})
    {
        this.#targets = NormalizeTargets(document?.targets);
        this.schema = document?.schema ?? SCHEMA;
        this.version = Number(document?.version ?? SCHEMA_VERSION);
        Object.freeze(this);
    }

    /**
     * Reads the policy from the durable data root — never the cache, which is
     * the store an operator is invited to delete. A pin is a decision, and a
     * decision that a cache clean can erase is not one.
     *
     * An absent file is the normal case and means "no pins, no holds" — never
     * an error, because a policy that has to exist is a policy someone will
     * create empty and stop maintaining.
     */
    static async read(dataDirectory)
    {
        try
        {
            const text = await fs.readFile(path.join(dataDirectory, POLICY_FILE), "utf8");

            return new CjsToolBuildPolicy(JSON.parse(text));
        }
        catch (error)
        {
            if (error?.code === "ENOENT") return new CjsToolBuildPolicy();

            throw new Error(
                `Cannot read ${POLICY_FILE}: ${error?.message ?? error}. `
                + "Refusing to fall back to an empty policy - a pin that silently "
                + "stops applying is worse than a failure that says so.",
            );
        }
    }

    /** The rule for one target and facet, or null. */
    Rule(target, facet)
    {
        return this.#targets.get(String(target ?? "").toLowerCase())?.[facet] ?? null;
    }

    /**
     * Decides what to serve.
     *
     * @param {Object} request
     * @param {String} request.target
     * @param {String} request.facet - `resources` or `sde`
     * @param {String|null} [request.observedLatest] - what upstream reports now
     * @param {String|null} [request.cached] - the newest build already held
     * @returns {Object} `{ build, reason, observedLatest, since, note }`
     */
    Decide({ target, facet, observedLatest = null, cached = null })
    {
        const rule = this.Rule(target, facet);
        const observed = observedLatest === null ? null : String(observedLatest);

        if (rule?.pin)
        {
            return Answer(rule.pin, REASONS.pinned, observed, rule);
        }

        if (rule?.hold)
        {
            // Holding with nothing cached cannot invent a build. Answering with
            // the observed one and saying so is better than failing: the caller
            // gets something usable and the reason records that the hold could
            // not be honoured.
            const build = cached ?? observed;

            return Answer(build, cached ? REASONS.held : REASONS.newestObserved, observed, rule);
        }

        if (observed !== null)
        {
            return Answer(observed, REASONS.newestObserved, observed, rule);
        }

        // Upstream unreachable and no policy: the last thing known is the only
        // honest answer, and it is marked as such rather than presented as
        // current.
        return Answer(cached, cached ? REASONS.lastObserved : null, observed, rule);
    }

    /** Pins older than `days`, which are the likely rot. */
    StaleRules(days = 30, now = new Date())
    {
        const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
        const stale = [];

        for (const [ target, facets ] of this.#targets)
        {
            for (const [ facet, rule ] of Object.entries(facets))
            {
                const since = rule.since ? Date.parse(rule.since) : NaN;

                if (!Number.isFinite(since) || since < cutoff)
                {
                    stale.push({ target, facet, ...rule });
                }
            }
        }

        return stale;
    }

}

function Answer(build, reason, observedLatest, rule)
{
    return Object.freeze({
        build: build === null || build === undefined ? null : String(build),
        reason,
        observedLatest,
        since: rule?.since ?? null,
        note: rule?.note ?? null,
    });
}

function NormalizeTargets(targets)
{
    const normalized = new Map();

    for (const [ target, facets ] of Object.entries(targets ?? {}))
    {
        const rules = {};

        for (const [ facet, rule ] of Object.entries(facets ?? {}))
        {
            if (!rule || typeof rule !== "object") continue;

            rules[facet] = Object.freeze({
                pin: rule.pin === undefined || rule.pin === null ? null : String(rule.pin),
                hold: rule.hold === true,
                since: rule.since ?? null,
                note: rule.note ?? null,
            });
        }

        normalized.set(String(target).toLowerCase(), Object.freeze(rules));
    }

    return normalized;
}
