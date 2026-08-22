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
 * Every default is another chance to make that mistake, and the one that is
 * wrong will not be the one anybody is looking at. Before this existed the
 * two clients here agreed with each other and disagreed with a consumer that
 * had written its own — for weeks, silently, because both dates were in the
 * past and both therefore worked.
 *
 * ## Moving it
 *
 * Deliberately, and only when the schema it pins has been re-read. It must
 * always be a date that has already passed — by enough that every deployment's
 * clock agrees it has, which is why this is not "today".
 */
export const ESI_COMPATIBILITY_DATE = "2026-08-18";

export default ESI_COMPATIBILITY_DATE;
