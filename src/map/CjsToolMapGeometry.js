/**
 * The parts of a map answer that are computed rather than looked up.
 *
 * Two of them, and they are computed here rather than in a build pass because
 * both inputs are small enough to hold: 8490 systems and 13978 stargates. A
 * derived artifact would buy nothing and would need a version token, an
 * invalidation rule, and somewhere to live.
 */

/**
 * Galactic up.
 *
 * New Eden is a disc in the x/z plane, so y is the thin axis and the sensible
 * reference for "up". Measured across 6000 systems of one reference build, the
 * interquartile spans are
 *
 *   x  3.099e17    y  5.320e16    z  2.883e17
 *
 * — y is about six times thinner than either of the others, which is the
 * distribution of a disc and not of a sphere. The p05/p95 spread of x and z is
 * wider still because a handful of wormhole and abyssal regions sit far off the
 * plane; the quartiles are quoted instead precisely because those outliers
 * would hide the shape.
 */
export const GALACTIC_UP = Object.freeze([ 0, 1, 0 ]);

/**
 * Where a stargate points.
 *
 * A gate faces the system it leads to. That is the rule the placement in game
 * follows, and it is why the *destination system's* position is the
 * input rather than the destination gate's: the gate at the far end sits
 * somewhere inside its own system, tens of orders of magnitude closer to its
 * star than the two systems are to each other, so which end of the wormhole
 * pair you aim at changes the direction by an immeasurable amount. Using the
 * system is both simpler and better conditioned.
 *
 * ## This is a rule, not a reading
 *
 * Nothing in the SDE states a stargate's orientation. This reproduces where
 * gates are observed to point; it is not a published value, and if it is
 * ever shown to be wrong it is this function that is wrong, not the data. It is
 * isolated here, and reported under `rule` in the answer, so that a consumer
 * can tell a computed orientation from a published one.
 *
 * @param {{x: Number, y: Number, z: Number}} from - the gate's own system
 * @param {{x: Number, y: Number, z: Number}} to - the destination system
 * @returns {Array<Number>|null} unit vector, or null for coincident systems
 */
export function StargateDirection(from, to)
{
    if (!from || !to) return null;

    const x = Number(to.x) - Number(from.x);
    const y = Number(to.y) - Number(from.y);
    const z = Number(to.z) - Number(from.z);
    const length = Math.hypot(x, y, z);

    // Not a tolerance — exactly zero, which happens only when a gate's
    // destination resolves back into its own system. A small-but-nonzero
    // separation is a real direction and rounding it away would be worse than
    // reporting it.
    if (!Number.isFinite(length) || length === 0) return null;

    return [ x / length, y / length, z / length ];
}

/**
 * An orientation quaternion for a direction, under a stated convention.
 *
 * **+Z is forward, +Y is up, right-handed.** That has to be said out loud
 * because there is no universal answer and a consumer whose forward is -Z will
 * get gates facing backwards while every other part of the answer looks
 * correct. Anyone who disagrees with the convention should use `direction`,
 * which is convention-free, and build their own.
 *
 * @param {Array<Number>} forward - unit vector
 * @param {Array<Number>} [up]
 * @returns {Array<Number>|null} [x, y, z, w]
 */
export function OrientationFromDirection(forward, up = GALACTIC_UP)
{
    if (!forward) return null;

    const f = Normalize(forward);

    if (!f) return null;

    let right = Cross(up, f);

    // The gate points straight up or straight down the galactic axis, so `up`
    // gives no usable second axis. Any perpendicular will do and the roll is
    // arbitrary either way, so pick a fixed one rather than returning null:
    // an unrotatable gate is still a gate that has to be drawn.
    if (!Normalize(right)) right = Cross([ 0, 0, 1 ], f);

    right = Normalize(right);

    if (!right) return null;

    const trueUp = Cross(f, right);

    return QuaternionFromAxes(right, trueUp, f);
}

/**
 * Blackbody colour for a star temperature, as linear RGB scaled to peak 1.
 *
 * Every star in the SDE sits between 2010 K and 10764 K (measured across all
 * 8089 of them), which is well inside the range where the Planckian locus
 * approximation below holds, so no clamping compromise is being hidden here.
 *
 * The route is CCT -> CIE xy on the Planckian locus -> XYZ -> linear sRGB.
 * The xy fit is Kim et al.'s cubic, valid 1667 K to 25000 K. The result is
 * **linear**, not gamma encoded, because it is going into a renderer's light
 * colour and not into a stylesheet.
 *
 * @param {Number} kelvin
 * @returns {Array<Number>|null} linear RGB, largest component 1
 */
export function BlackbodyColor(kelvin)
{
    const t = Number(kelvin);

    if (!Number.isFinite(t) || t <= 0) return null;

    const clamped = Math.min(Math.max(t, 1667), 25000);
    const inverse = 1000 / clamped;
    const inverse2 = inverse * inverse;
    const inverse3 = inverse2 * inverse;

    const x = clamped < 4000
        ? -0.2661239 * inverse3 - 0.2343589 * inverse2 + 0.8776956 * inverse + 0.179910
        : -3.0258469 * inverse3 + 2.1070379 * inverse2 + 0.2226347 * inverse + 0.240390;

    const x2 = x * x;
    const x3 = x2 * x;

    let y;

    if (clamped < 2222) y = -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683;
    else if (clamped < 4000) y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
    else y = 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;

    if (y === 0) return null;

    // Y is fixed at 1 and the result is renormalised below, so absolute
    // luminance here is arbitrary; only the chromaticity carries meaning.
    const bigX = x / y;
    const bigZ = (1 - x - y) / y;

    let r = 3.2404542 * bigX - 1.5371385 - 0.4985314 * bigZ;
    let g = -0.9692660 * bigX + 1.8760108 + 0.0415560 * bigZ;
    let b = 0.0556434 * bigX - 0.2040259 + 1.0572252 * bigZ;

    // Chromaticities on the locus can fall just outside sRGB's gamut, which
    // arrives as a small negative component. Clipping to zero is the standard
    // desaturating fix and is invisible at these temperatures.
    r = Math.max(r, 0);
    g = Math.max(g, 0);
    b = Math.max(b, 0);

    const peak = Math.max(r, g, b);

    if (!(peak > 0)) return null;

    return [ Round(r / peak), Round(g / peak), Round(b / peak) ];
}

/**
 * The median star luminosity in the SDE, to two significant figures.
 *
 * Measured across all 8089 stars of one reference build: min 0.0100, median
 * 0.0979, p99 29.3, max 34.4. The median is what makes the normalisation below
 * possible to state honestly — luminosity is not a light intensity and using
 * it as one leaves the typical system almost black.
 */
export const MEDIAN_LUMINOSITY = 0.098;

/**
 * The compression exponent, and why it is a fourth root rather than a square.
 *
 * **This is a presentation curve, not physics.** Luminosity spans 0.01 to 34.4
 * across New Eden — a ratio of 3500 — and the median star is at 0.098, so
 * handing it to a renderer as an intensity leaves most of the cluster unlit and
 * a handful of systems blinding. The ratio to the median, compressed, centres
 * the typical system at 1.
 *
 * The exponent was chosen by measuring what each one does to all 8089 stars,
 * because the failure mode is a clamp quietly flattening a large part of the
 * cluster to the same value:
 *
 *   exponent   clamped at 4    p95     Jita
 *   0.50           8.57%       4.00    4.00
 *   0.40           4.92%       3.93    3.13
 *   0.25           1.31%       2.35    2.04
 *   0.20           0.00%       1.98    1.77
 *
 * A square root — the obvious first choice — puts one star in twelve against
 * the ceiling, including Jita, which is an ordinary bright F-class star and the
 * most-visited system in the game. Anything that renders Jita identically to a
 * genuine supergiant is not compressing the range, it is discarding the top of
 * it. A fifth root clamps nothing but flattens 3500:1 down to 5:1, so bright
 * stars stop reading as bright.
 *
 * A fourth root keeps the median at 1 and a real spread beneath it, and clamps
 * only the 1.3% that are true outliers.
 */
export const INTENSITY_EXPONENT = 0.25;

/**
 * Guard rails, not part of the shape.
 *
 * At the exponent above the curve's own range over real data is 0.57 to 12.5,
 * so the floor is never reached and the ceiling only by that 1.3%. They are
 * here to bound a garbage input, not to sculpt the output — which is exactly
 * what they were doing at the square root, and the reason to say so.
 */
const INTENSITY_MIN = 0.25;
const INTENSITY_MAX = 4;

/**
 * A usable key-light intensity from a star's luminosity.
 *
 * Raw `luminosity` is reported alongside it in every answer, so a consumer who
 * wants a different curve — or the real thing — is not shut out by this choice.
 *
 * @param {Number} luminosity
 * @returns {Number|null}
 */
export function SunIntensity(luminosity)
{
    const value = Number(luminosity);

    if (!Number.isFinite(value) || value <= 0) return null;

    const scaled = (value / MEDIAN_LUMINOSITY) ** INTENSITY_EXPONENT;

    return Round(Math.min(Math.max(scaled, INTENSITY_MIN), INTENSITY_MAX));
}

function Normalize(v)
{
    const length = Math.hypot(v[0], v[1], v[2]);

    if (!Number.isFinite(length) || length === 0) return null;

    return [ v[0] / length, v[1] / length, v[2] / length ];
}

function Cross(a, b)
{
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

/**
 * Quaternion from an orthonormal basis, by Shepperd's method.
 *
 * The largest-component branch is not an optimisation: forming the quaternion
 * through a near-zero divisor loses most of its precision, and for a gate
 * pointing near an axis that is exactly the case that arises.
 */
function QuaternionFromAxes(right, up, forward)
{
    const [ m00, m01, m02 ] = right;
    const [ m10, m11, m12 ] = up;
    const [ m20, m21, m22 ] = forward;
    const trace = m00 + m11 + m22;

    let x, y, z, w;

    if (trace > 0)
    {
        const s = Math.sqrt(trace + 1) * 2;
        w = 0.25 * s;
        x = (m12 - m21) / s;
        y = (m20 - m02) / s;
        z = (m01 - m10) / s;
    }
    else if (m00 > m11 && m00 > m22)
    {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        w = (m12 - m21) / s;
        x = 0.25 * s;
        y = (m10 + m01) / s;
        z = (m20 + m02) / s;
    }
    else if (m11 > m22)
    {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        w = (m20 - m02) / s;
        x = (m10 + m01) / s;
        y = 0.25 * s;
        z = (m21 + m12) / s;
    }
    else
    {
        const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
        w = (m01 - m10) / s;
        x = (m20 + m02) / s;
        y = (m21 + m12) / s;
        z = 0.25 * s;
    }

    return [ Round(x), Round(y), Round(z), Round(w) ];
}

/** Six decimals: past a unit vector's useful precision, short in JSON. */
function Round(value)
{
    return Math.round(value * 1e6) / 1e6;
}
