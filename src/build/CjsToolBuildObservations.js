/**
 * What builds have been seen, when, and where they came from.
 *
 * The discovery half of the build authority, and deliberately a separate store
 * from the policy half: this records what upstream *had*, never what we chose
 * to serve. Merge the two and "is that build missing, or refused?" stops having
 * an answer.
 *
 * ## Why a log rather than a ledger
 *
 * `known-builds.json` was a set of build numbers per target — enough to protect
 * a build from a prune, and nothing else. It could not answer when a build
 * appeared, how often upstream moves, or which channel a number came from,
 * because it recorded only that the number existed.
 *
 * Those questions are the ones actually asked. "How often does upstream
 * publish?" decided the polling schedule; it was answered by reading
 * `releaseDate` out of prepared databases, because nothing had written it down.
 * A log of dated facts answers it without an archaeology session.
 *
 * ## Append-only, one JSON object per line
 *
 *     <data>/observations.jsonl
 *
 * Appending is the whole design. A rewritten file can be truncated by a crash
 * or a concurrent writer; an appended line either lands or does not, and a
 * partial last line is discarded on read. Two processes appending cannot
 * corrupt each other's records the way two processes rewriting a JSON document
 * can.
 *
 * It lives in the durable root, never the cache: this is the one thing here
 * that cannot be re-acquired by downloading. Upstream publishes what exists
 * *now*, and build numbers cannot be enumerated, so a build never written down
 * is not merely uncached — it is unknowable.
 *
 * ## What a record is
 *
 * ```jsonc
 * { "at": "2026-08-15T11:07:01Z",   // when we observed it
 *   "target": "eve",
 *   "facet": "resources",           // or "sde"
 *   "build": "3000000",
 *   "released": "2026-08-13T11:07:01Z", // when upstream says it was published
 *   "source": "client-metadata",    // how we learned it
 *   "url": "https://…" }            // what we read, when there is one
 * ```
 *
 * `at` and `released` are different facts and both are kept. A build observed
 * late still says when it was published, which is what makes the publish window
 * measurable from history rather than from a live watch.
 *
 * @see /docs/internal/decisions/build-authority.md
 */
import fs from "node:fs/promises";
import path from "node:path";

/** The append-only log, in the durable data root. */
export const OBSERVATIONS_FILE = "observations.jsonl";

export class CjsToolBuildObservations
{

    #directory;

    #records;

    constructor(directory, records = [])
    {
        this.#directory = String(directory);
        this.#records = records;
        Object.freeze(this);
    }

    /**
     * Reads the log. An absent file is an empty log, not an error — a fresh
     * install has observed nothing yet, which is a normal state rather than a
     * fault.
     *
     * A malformed line is skipped rather than failing the read. The log is
     * append-only and a partial last line is what a crash mid-append leaves;
     * refusing to read the other ten thousand records because of it would lose
     * exactly the history this exists to keep.
     */
    static async read(dataDirectory)
    {
        const file = path.join(dataDirectory, OBSERVATIONS_FILE);
        let text;

        try
        {
            text = await fs.readFile(file, "utf8");
        }
        catch (error)
        {
            if (error?.code === "ENOENT") return new CjsToolBuildObservations(dataDirectory);

            throw error;
        }

        const records = [];

        for (const line of text.split("\n"))
        {
            if (!line.trim()) continue;

            try
            {
                records.push(Object.freeze(JSON.parse(line)));
            }
            catch
            {
                // A truncated final line from an interrupted append.
            }
        }

        return new CjsToolBuildObservations(dataDirectory, records);
    }

    /** Every record, oldest first. */
    All()
    {
        return this.#records;
    }

    /** The newest observation for one target and facet, or null. */
    Latest(target, facet)
    {
        const wanted = this.#Match(target, facet);

        return wanted.length ? wanted[wanted.length - 1] : null;
    }

    /** Every distinct build seen for one target and facet, newest first. */
    Builds(target, facet)
    {
        const seen = new Set();

        for (const record of this.#Match(target, facet)) seen.add(String(record.build));

        return [ ...seen ].sort((left, right) => Number(right) - Number(left));
    }

    /**
     * Appends an observation, unless it repeats the last one.
     *
     * Repeats are dropped because the schedule asks upstream on a timer whether
     * or not anything changed, and a log that grows by three lines a day
     * regardless of events is a log nobody reads. What matters is the
     * transitions, so a record is written when the build differs from the last
     * one seen for that target and facet.
     *
     * @returns {Promise<Object|null>} the record written, or null if unchanged
     */
    async Record({ target, facet, build, released = null, source = null, url = null, at = null })
    {
        if (!target || !facet || build === null || build === undefined) return null;

        const previous = this.Latest(target, facet);

        if (previous && String(previous.build) === String(build)) return null;

        const record = Object.freeze({
            at: at ?? new Date().toISOString(),
            target: String(target),
            facet: String(facet),
            build: String(build),
            released,
            source,
            url,
        });

        await fs.mkdir(this.#directory, { recursive: true });
        await fs.appendFile(
            path.join(this.#directory, OBSERVATIONS_FILE),
            `${JSON.stringify(record)}\n`,
            "utf8",
        );
        this.#records.push(record);

        return record;
    }

    /**
     * How often a target's builds actually changed, from the log itself.
     *
     * This is the question the polling schedule was guessed at before there was
     * a log to ask.
     *
     * @returns {Object} `{ count, first, last, medianHoursBetween, hours }`
     */
    Cadence(target, facet)
    {
        const records = this.#Match(target, facet);
        // `released` only, never `at`. They are different facts: `at` is when we
        // looked, `released` is when upstream published. Falling back to `at`
        // reported the publish hour of every undated record as the hour the log
        // was seeded — forty-two records agreeing on a time that was just the
        // clock at the moment they were written down.
        const times = records.map(record => Date.parse(record.released))
            .filter(Number.isFinite)
            .sort((left, right) => left - right);
        const gaps = [];

        for (let index = 1; index < times.length; ++index)
        {
            gaps.push((times[index] - times[index - 1]) / 3600000);
        }

        gaps.sort((left, right) => left - right);

        return {
            count: records.length,
            // How many of those carry a publish date at all. A cadence drawn
            // from three of twenty records is a different claim from one drawn
            // from twenty, and the caller cannot tell without this.
            dated: times.length,
            first: times.length ? new Date(times[0]).toISOString() : null,
            last: times.length ? new Date(times[times.length - 1]).toISOString() : null,
            medianHoursBetween: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
            // The UTC hour each build was published, which is what the publish
            // window is measured from.
            hours: times.map(time => new Date(time).getUTCHours()),
        };
    }

    #Match(target, facet)
    {
        const wantedTarget = String(target ?? "").toLowerCase();

        return this.#records.filter(record =>
            String(record.target).toLowerCase() === wantedTarget
            && String(record.facet) === String(facet));
    }

}
