/**
 * When tools-core may ask upstream what exists — the discovery half's rules.
 *
 * These rules existed already, scattered: a patch-window TTL in `utils`, a
 * five-minute default in the build resolver, a separate TTL in the SDE archive,
 * and a twelve-hour check marker in the Blender add-on. Each was a reasonable
 * local guess and none of them agreed. They live here so the build authority
 * owns them, and so correcting one corrects all of them.
 *
 * ## What upstream actually does
 *
 * Stated by the maintainer, 2026-08-15:
 *
 * - Upstream moves **at most once a day**, and resources land at roughly
 *   **11:00–12:00 EVE time**, which is UTC.
 * - It changes again only when something has gone seriously wrong, meaning a
 *   republish to fix a bad build.
 *
 * The SDE facet's timing was not known, so it was measured rather than assumed.
 * Every prepared SDE records its own `releaseDate`, so the ones already on disk
 * are dated observations: five samples over three weeks, all within eleven
 * minutes of 11:00, on four different weekdays. **Both facets share one
 * window**, so one schedule serves them. The oldest databases on disk carry a
 * null `releaseDate` and cannot contribute; that is a limit of the sample, not
 * evidence of a second pattern.
 *
 * So the budget is small and its placement matters more than its size:
 *
 * | Check | Why |
 * | --- | --- |
 * | one after the publish window | catches the daily build within the hour |
 * | one more once a build is seen | catches the follow-up that usually accompanies a bad one |
 * | one halfway through the day | catches a republish outside the window at all |
 *
 * Three metadata requests a day, worst case, and the daily build is known
 * within about an hour of landing.
 *
 * > **The window this replaces was approximately right**, and was briefly made
 * > wrong on the way here. `getEveLatestBuildCacheTTL` polled 09:00–12:00 UTC,
 * > which brackets the real hour with a wide margin; a stated correction to
 * > 23:00–24:00 was applied and then withdrawn the same day. The narrowed
 * > window is the actual one, and the margin it gives up is bought back by the
 * > approach schedule below — the wait shortens as the window nears, so a build
 * > landing early is still seen within the hour.
 *
 * ## This is not a cache of `latest`
 *
 * `latest` must resolve to a build number every time it is used; nothing may
 * store it. What is scheduled here is how often we *ask upstream what exists*,
 * which is a different question with a different answer — the observation log
 * holds the facts, and this decides when to add to it.
 *
 * @see /docs/internal/decisions/build-authority.md
 */

/** The publish window, in UTC hours. EVE time is UTC. */
export const PUBLISH_WINDOW = Object.freeze({ start: 11, end: 12 });

/** How often to ask inside the window, while a build is expected to land. */
const IN_WINDOW_INTERVAL_MS = 5 * 60 * 1000;

/** The extra look after a build is first seen, for the follow-up republish. */
const AFTER_BUILD_INTERVAL_MS = 60 * 60 * 1000;

/** The mid-day look, which is the only thing that catches an off-window fix. */
const OUT_OF_WINDOW_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * How long an observation stays good before upstream is asked again.
 *
 * @param {Object} [state]
 * @param {Number} [state.now] - epoch ms
 * @param {Number} [state.buildSeenAt] - when a build was last observed to change
 * @returns {Number} milliseconds
 */
export function NextCheckDelay({ now = Date.now(), buildSeenAt = null } = {})
{
    const at = Number(now);

    if (!Number.isFinite(at))
    {
        throw new TypeError(`Invalid schedule time: ${now}`);
    }

    const hour = new Date(at).getUTCHours();

    if (hour >= PUBLISH_WINDOW.start && hour < PUBLISH_WINDOW.end)
    {
        return IN_WINDOW_INTERVAL_MS;
    }

    // A build has just landed. One more look an hour later, because the
    // republish that fixes a bad build follows the bad build rather than
    // waiting for tomorrow's window.
    if (buildSeenAt !== null && at - Number(buildSeenAt) < AFTER_BUILD_INTERVAL_MS)
    {
        return AFTER_BUILD_INTERVAL_MS;
    }

    // Otherwise: sleep until the window, but never longer than half a day, so
    // an off-window republish is picked up rather than served stale until
    // tomorrow. This is the "halfway through the day" check.
    return Math.min(MillisecondsUntilWindow(at), OUT_OF_WINDOW_INTERVAL_MS);
}

/** Whether an observation taken at `checkedAt` is still good. */
export function IsFresh({ now = Date.now(), checkedAt, buildSeenAt = null } = {})
{
    if (checkedAt === null || checkedAt === undefined) return false;

    return Number(now) - Number(checkedAt) < NextCheckDelay({ now: checkedAt, buildSeenAt });
}

function MillisecondsUntilWindow(at)
{
    const date = new Date(at);
    let next = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        PUBLISH_WINDOW.start,
    );

    if (next <= at) next += 24 * 60 * 60 * 1000;

    return next - at;
}
