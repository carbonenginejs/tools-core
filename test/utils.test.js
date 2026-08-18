import test from "node:test";
import assert from "node:assert/strict";

import {
    getEveLatestBuildCacheTTL,
    isExactBuild,
    normalizeExactBuild,
    normalizeExactBuildNumber,
    optionalString,
    requireObject,
} from "../src/utils.js";
import * as publicTools from "../src/index.js";

test("exports shared tools-core utilities without a utility class", () =>
{
    assert.equal(publicTools.normalizeExactBuild, normalizeExactBuild);
    assert.equal(publicTools.CjsToolUtils, undefined);
});

test("normalizes exact string and numeric build identities", () =>
{
    assert.equal(isExactBuild(" 3435006 "), true);
    assert.equal(isExactBuild("latest"), false);
    assert.equal(normalizeExactBuild(" 3435006 "), "3435006");
    assert.equal(normalizeExactBuildNumber("3435006"), 3435006);
    assert.throws(() => normalizeExactBuild("latest"), /Invalid exact build/u);
    assert.throws(() => normalizeExactBuildNumber(-1), /Invalid exact build/u);
});

test("shares object and optional-string normalization contracts", () =>
{
    const value = { id: 1 };

    assert.equal(requireObject(value, "Value"), value);
    assert.throws(() => requireObject([], "Value"), /Value must be an object/u);
    assert.equal(optionalString(undefined), null);
    assert.equal(optionalString(""), null);
    assert.equal(optionalString(12), "12");
});

test("polls latest-build metadata only around the daily publish window", () =>
{
    // Resources publish at 11:00-12:00 EVE time, which is UTC.
    assert.equal(
        getEveLatestBuildCacheTTL(Date.parse("2026-07-20T11:30:00Z")),
        5 * 60 * 1000,
    );

    // Outside it the wait is capped at twelve hours rather than running to the
    // next window. That cap is the mid-day check: it is the only thing that
    // catches a republish outside the window, which is the one case upstream
    // does not follow its own schedule.
    assert.equal(
        getEveLatestBuildCacheTTL(Date.parse("2026-07-20T18:00:00Z")),
        12 * 60 * 60 * 1000,
    );

    // Close enough that the window is nearer than the cap.
    assert.equal(
        getEveLatestBuildCacheTTL(Date.parse("2026-07-20T10:00:00Z")),
        60 * 60 * 1000,
    );
    // Just past the window: the next one is 23 hours away, so the cap decides.
    assert.equal(
        getEveLatestBuildCacheTTL(Date.parse("2026-07-20T12:00:00Z")),
        12 * 60 * 60 * 1000,
    );
});
