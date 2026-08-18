import { CjsBuildObservations } from "./CjsBuildObservations.js";
import { CjsBuildPolicy, REASONS } from "./CjsBuildPolicy.js";

/**
 * Which builds exist, which one a caller is served, and therefore which ones
 * the cache keeps.
 *
 * The three parts this assembles already existed and each answers one question
 * well: `CjsBuildObservations` records what upstream had and when,
 * `CjsBuildPolicy` decides what we serve and why, and `CjsIndexBuildResolver`
 * turns an alias into one exact remote build. What did not exist was anything
 * owning the sequence, so every caller assembled it for itself and each
 * rediscovered the same facts — which is how `latest` came to mean a different
 * build per facet, silently, and for a while a different *world*.
 *
 * See `/docs/internal/decisions/build-authority.md`. This is the service that
 * page proposes; the measurements and the argument are there rather than
 * repeated here.
 *
 * ## It does not know how to reach a remote
 *
 * Discovery is injected. The authority never imports a resolver, an archive or
 * an HTTP client: it is handed `discover(target, facet)` and calls it. That is
 * not testing convenience, it is the boundary — `CjsIndexBuildResolver` already
 * means "resolve an alias to one exact remote build, with no opinion", and this
 * is the opinion. Two remote channels feed it, one per facet, and neither
 * belongs inside a policy layer.
 *
 * ## Failure is a designed answer, not an exception
 *
 * Making one service authoritative makes it a single point of failure, so
 * unreachable upstream serves the last observed build and says so. The
 * observation log is durable precisely to make that possible: a resolution is
 * still available when discovery is not.
 *
 * The one thing that does fail loudly is the keep-set. An unreadable target
 * must never silently shrink it, because a short keep-set deletes another
 * target's files.
 */
export class CjsToolBuildAuthority
{

    #observations;
    #policy;
    #discover;
    #requireVerified;

    /**
     * @param {Object} parts
     * @param {CjsBuildObservations} parts.observations
     * @param {CjsBuildPolicy} parts.policy
     * @param {Function} parts.discover - async (target, facet) => build id, or
     *   an object carrying `{ build, released, source, url }`. May throw or
     *   answer null; both mean "upstream did not say".
     * @param {Boolean} [parts.requireVerified] - serve the newest *verified*
     *   build rather than the newest observed one
     */
    constructor({ observations, policy, discover, requireVerified = false })
    {
        if (typeof discover !== "function")
        {
            throw new TypeError("CjsToolBuildAuthority requires a discover function");
        }

        this.#observations = observations;
        this.#policy = policy;
        this.#discover = discover;
        this.#requireVerified = Boolean(requireVerified);
    }

    /** Opens the authority over one durable data root. */
    static async open({ dataDirectory, discover, requireVerified = false })
    {
        const [ observations, policy ] = await Promise.all([
            CjsBuildObservations.read(dataDirectory),
            CjsBuildPolicy.read(dataDirectory),
        ]);

        return new CjsToolBuildAuthority({ observations, policy, discover, requireVerified });
    }

    /** The observation log, for callers that want the history rather than an answer. */
    get observations()
    {
        return this.#observations;
    }

    /** The policy, for reporting pins and stale rules. */
    get policy()
    {
        return this.#policy;
    }

    /**
     * Resolves one build reference for one target and facet.
     *
     * A concrete build id is passed straight back. It is not a policy decision
     * and must not be dressed as one: somebody naming an exact build is telling
     * us what they want, and answering "newest-observed" would claim we chose
     * it. `requested` is this module's word, deliberately outside the policy's
     * REASONS, because inventing a policy reason for the absence of a policy
     * decision is how vocabularies rot.
     *
     * @param {Object} request
     * @param {String} request.target
     * @param {String} [request.facet] - `resources` or `sde`
     * @param {String} [request.buildRef] - a build id, or an alias like `latest`
     * @param {Boolean} [request.refresh] - ask upstream; false answers from the log
     * @returns {Promise<Object>} `{ target, facet, build, reason, observedLatest,
     *   verified, since, note }`
     */
    async Resolve({ target, facet = "resources", buildRef = "latest", refresh = true })
    {
        const name = String(target ?? "").toLowerCase();

        if (!name) throw new TypeError("CjsToolBuildAuthority.Resolve requires a target");

        if (IsConcreteBuild(buildRef))
        {
            return Freeze({
                target: name,
                facet,
                build: String(buildRef),
                reason: AUTHORITY_REASONS.requested,
                observedLatest: this.#Observed(name, facet),
                verified: this.IsVerified(name, facet, buildRef),
            });
        }

        const observedLatest = refresh
            ? await this.#Discover(name, facet)
            : this.#Observed(name, facet);

        // What we already know of, newest first. This is what the policy falls
        // back to when upstream said nothing, and it is read from the log rather
        // than the cache: the cache is the store an operator is invited to
        // delete, and a decision a cache clean can erase is not one.
        const known = this.#observations.Builds(name, facet);
        const answer = this.#policy.Decide({
            target: name,
            facet,
            observedLatest,
            cached: known[0] ?? null,
        });

        return Freeze({
            target: name,
            facet,
            ...this.#ApplyVerificationGate(name, facet, answer),
        });
    }

    /**
     * Resolves both facets together.
     *
     * The pairing is the point. `latest` is two numbers and they are published
     * on different schedules when either side is acquired, so a caller that
     * asks for one and assumes the other is the same is making the mistake
     * this whole service exists to stop.
     */
    async ResolveAll({ target, buildRef = "latest", refresh = true, facets = FACETS })
    {
        const answers = await Promise.all(facets.map(facet =>
            this.Resolve({ target, facet, buildRef, refresh })));

        return Object.freeze(Object.fromEntries(
            answers.map(answer => [ answer.facet, answer ])));
    }

    /**
     * Records that a build was verified — that something loaded real files from
     * it and they still parse.
     *
     * A verification is a *fact*, so it belongs in the observation log beside
     * the build it concerns, never in the policy. Policy decides; the log
     * remembers. Putting it in the policy would make that document a history as
     * well as a decision, and the two rot differently.
     *
     * What it guards against is a changed `.black` definition, which no
     * comparison of build numbers can detect — a build number tells you
     * something is new, never whether it still parses. That is not theoretical:
     * one target's faction data carries a logo slot Carbon does not declare, on
     * builds that look correct by every other measure.
     */
    async Verify({ target, facet = "resources", build, at = null, source = "verification", note = null })
    {
        if (build === null || build === undefined)
        {
            throw new TypeError("CjsToolBuildAuthority.Verify requires a build");
        }

        return this.#observations.Record({
            target: String(target).toLowerCase(),
            facet: VerifiedFacet(facet),
            build,
            at,
            source,
            url: note,
        });
    }

    /** The newest build recorded as verified for one target and facet, or null. */
    Verified(target, facet = "resources")
    {
        return this.#observations.Builds(String(target).toLowerCase(), VerifiedFacet(facet))[0] ?? null;
    }

    /** Whether one exact build has been verified. */
    IsVerified(target, facet, build)
    {
        if (build === null || build === undefined) return false;

        return this.#observations
            .Builds(String(target).toLowerCase(), VerifiedFacet(facet))
            .includes(String(build));
    }

    /**
     * Every build the cache must keep.
     *
     * A consequence of what is served, not a separate decision — which is the
     * whole reason `cjs-tools-cache-prune` should stop taking `--target` and
     * `--build`. A caller choosing the keep-set is a caller given a decision it
     * cannot make correctly: resource files are content-addressed and shared,
     * so a file Serenity needs may be one Tranquility never mentions, and the
     * first version of that prune deleted exactly those.
     *
     * Refuses rather than shrinks. If any target cannot be resolved the whole
     * set is unusable, because the missing entries are indistinguishable from
     * builds nobody keeps — and pruning against a short set is how the data
     * loss happens. Frontier answering 401 for part of its index already stops
     * an all-target prune by design; that behaviour belongs here.
     *
     * @param {Object} request
     * @param {Array<String>} request.targets
     * @param {Number} [request.window] - how many recent builds to keep per facet
     * @returns {Promise<Object>} `{ builds: Map<target, Set<build>>, reasons }`
     */
    async KeepSet({ targets, window = 2, facets = FACETS, refresh = false })
    {
        if (!Array.isArray(targets) || !targets.length)
        {
            throw new TypeError("CjsToolBuildAuthority.KeepSet requires targets");
        }

        const builds = new Map();
        const reasons = [];
        const failed = [];

        for (const target of targets)
        {
            const name = String(target).toLowerCase();
            const kept = new Set();

            for (const facet of facets)
            {
                try
                {
                    const answer = await this.Resolve({ target: name, facet, refresh });

                    // A null build is a failure, not an empty contribution.
                    //
                    // It means upstream said nothing AND the log has never seen
                    // this target — so there is no build to protect and no way
                    // to know which files are its. Accepting it would let the
                    // target contribute zero paths to a keep-set that is then
                    // applied to a store its files share, which is the exact
                    // shape of the deletion this refuses to perform. It read as
                    // success because `Resolve` correctly did not throw:
                    // answering `last-observed` with nothing observed is honest,
                    // and only becomes dangerous here.
                    if (!answer.build)
                    {
                        failed.push(`${name}/${facet}: no build could be resolved, and none has ever been observed`);
                        continue;
                    }

                    kept.add(String(answer.build));
                    reasons.push(answer);
                }
                catch (error)
                {
                    failed.push(`${name}/${facet}: ${error?.message ?? error}`);
                    continue;
                }

                // Pins are kept whether or not they are what is currently
                // served: a pin exists because somebody decided something, and
                // collecting the build it names would undo that decision the
                // next time it was applied.
                const rule = this.#policy.Rule(name, facet);

                if (rule?.pin) kept.add(String(rule.pin));

                // The retention window, so the build before the current one
                // survives long enough to be compared against.
                for (const build of this.#observations.Builds(name, facet).slice(0, window))
                {
                    kept.add(String(build));
                }
            }

            builds.set(name, kept);
        }

        if (failed.length)
        {
            throw new Error(
                `Refusing to report a keep-set: ${failed.join("; ")}. `
                + "A short keep-set deletes files another target needs, and a "
                + "missing entry is indistinguishable from a build nobody keeps.",
            );
        }

        return Object.freeze({ builds, reasons: Object.freeze(reasons) });
    }

    /** Pins that have outlived their reason, which is the likely rot. */
    StalePins(days = 30, now = new Date())
    {
        return this.#policy.StaleRules(days, now);
    }

    /**
     * Asks upstream, records what it said, and answers null when it says
     * nothing.
     *
     * A throw from discovery is not propagated. Upstream being unreachable is a
     * condition this service is designed for, not a failure of it — the policy
     * turns a null into `last-observed`, which is an honest answer where an
     * exception would take the caller down with the network.
     */
    async #Discover(target, facet)
    {
        try
        {
            const answer = await this.#discover(target, facet);
            const build = answer && typeof answer === "object" ? answer.build : answer;

            if (build === null || build === undefined) return null;

            await this.#observations.Record({
                target,
                facet,
                build,
                released: answer?.released ?? null,
                source: answer?.source ?? null,
                url: answer?.url ?? null,
            });

            return String(build);
        }
        catch
        {
            return null;
        }
    }

    /** The newest build the log has seen for one target and facet. */
    #Observed(target, facet)
    {
        return this.#observations.Latest(target, facet)?.build ?? null;
    }

    /**
     * Substitutes the newest verified build when the gate is on.
     *
     * Applied here rather than inside `CjsBuildPolicy.Decide` because the
     * policy has no way to express it yet: a rule carries `pin`, `hold`,
     * `since` and `note`, and nothing else. `REASONS.newestVerified` exists and
     * is unused, which is the shape of a decision made and not yet wired.
     *
     * When it moves into the policy — as a rule key, so it can differ per target
     * and facet rather than being one flag for the service — this override
     * should go with it. Until then the reason is corrected here so an answer
     * never claims to be the newest build when it is deliberately not.
     *
     * A pin outranks the gate. Someone naming an exact build has already made
     * this decision, and overriding them would make a pin conditional on a
     * verification they may have pinned *around*.
     */
    #ApplyVerificationGate(target, facet, answer)
    {
        const verified = this.Verified(target, facet);

        if (!this.#requireVerified || answer.reason === REASONS.pinned)
        {
            return { ...answer, verified: this.IsVerified(target, facet, answer.build) };
        }

        // Nothing verified yet: serve what the policy chose and say plainly that
        // it is unverified. Refusing to answer would make the gate an outage on
        // any target nobody has run the check against, which would guarantee it
        // gets turned off.
        if (!verified) return { ...answer, verified: false };

        if (String(answer.build) === verified) return { ...answer, verified: true };

        return {
            ...answer,
            build: verified,
            reason: REASONS.newestVerified,
            verified: true,
        };
    }

}

/** The two independently published bodies of data a target serves. */
export const FACETS = Object.freeze([ "resources", "sde" ]);

/**
 * Reasons the authority can give that are not policy decisions.
 *
 * Kept separate from `REASONS` on purpose. The policy's vocabulary answers "why
 * did we choose this", and a caller naming an exact build did not ask us to
 * choose anything.
 */
export const AUTHORITY_REASONS = Object.freeze({
    ...REASONS,
    requested: "requested",
});

/** A build reference that names one exact build rather than asking for a choice. */
function IsConcreteBuild(buildRef)
{
    return /^\d+$/u.test(String(buildRef ?? "").trim());
}

/**
 * The log facet a verification is recorded under.
 *
 * A separate facet rather than a flag on the record, because the log's `Record`
 * drops a repeat of the last build for a facet — which is exactly right for
 * observations and exactly wrong for verifications, where re-verifying the
 * build we already serve is the common case and worth having a date for.
 */
function VerifiedFacet(facet)
{
    return `${facet}:verified`;
}

function Freeze(answer)
{
    return Object.freeze({
        since: null,
        note: null,
        ...answer,
    });
}

export default CjsToolBuildAuthority;
