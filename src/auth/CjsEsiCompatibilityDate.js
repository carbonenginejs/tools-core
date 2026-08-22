/**
 * The date every ESI request pins itself to.
 *
 * ESI requires `x-compatibility-date` on every route and answers as the routes
 * behaved on that date. It is a PIN, not a version ceiling — and the failure
 * mode is what makes this one constant rather than a default in each client:
 *
 * **A date in the future is rejected outright.** `400 Compatibility date is in
 * the future`, on every route, for every id. This package shipped `2099-01-01`
 * as a placeholder once, on the reading that "newest" was the safe default; no
 * character name resolved anywhere until 2026-08-19, and nothing in the failure
 * said what was wrong with it.
 *
 * Three defaults in two repositories is three chances to make that mistake
 * again, and the one that is wrong will not be the one anybody is looking at:
 * before this existed, the two clients here pinned 2026-08-18 while skindr's
 * server and its market service pinned 2026-08-14, and nothing knew.
 *
 * ## Moving it
 *
 * Deliberately, and only when the schema it pins has been re-read. It must
 * always be a date that has already passed — by enough that every deployment's
 * clock agrees it has, which is why this is not "today".
 */
export const ESI_COMPATIBILITY_DATE = "2026-08-18";

export default ESI_COMPATIBILITY_DATE;
