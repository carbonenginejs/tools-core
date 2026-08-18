/**
 * Inventory flags: where an item sits on a ship.
 *
 * ## Why this is a table we maintain rather than data we read
 *
 * Nothing publishes it any more, and that was checked rather than assumed:
 *
 * - **Not in the SDE.** All 102 of its tables were listed and nothing is
 *   flag-shaped. The legacy YAML SDE carried `invFlags` among its `bsd`
 *   tables, and that whole set was retired.
 * - **Not in resource data.** Every `res:/staticdata/` file on one reference
 *   build was enumerated, roughly 200 of them, and none carries flags, so no
 *   generated SDE can recover them either.
 * - **ESI publishes the names**, as the enum on a fitting item's `flag`, but
 *   only for Tranquility. Serenity and Infinity have no ESI at all.
 *
 * Which is the whole reason this is a table with provenance on it: one field
 * comes from a source we can point at, the other does not.
 *
 * ## The two halves have different authority
 *
 * - `name` - the string ESI uses, and the one every fitting record carries.
 *   Same engine on every server, so it holds for the targets without an ESI
 *   too, even though they have nothing to confirm it against.
 * - `flagID` - the numeric value the engine uses internally, recorded from the
 *   retired `invFlags` table. **Nothing here verifies it**, and nothing in this
 *   package depends on it today: fittings travel by name. It is carried because
 *   the moment anything reads raw item data it becomes the only way to
 *   place an item, and rediscovering it later is the expensive path.
 *
 * `flagID: null` means we do not have a value we would stand behind, which is a
 * different statement from zero.
 *
 * ## One table for every target, deliberately
 *
 * There is no per-target flag set and there should not be one. A flag is an
 * engine constant, and every other engine constant measured across the three
 * targets is identical: 51707 shared type IDs, `cpuOutput` is attribute 48 and
 * `powerOutput` 11 everywhere, `hiPower` is effect 12 and `rigSlot` 2663
 * everywhere, and the category IDs match. A flag numbering that diverged would
 * be the single exception among them.
 *
 * That is inference rather than measurement - no source for the other targets
 * publishes flags to check against, which is the whole problem - so it is
 * recorded here rather than asserted anywhere. The exposure is small: the names
 * are what fittings travel on and they are engine-wide, and the numbers are
 * already marked unverified for every target, including the one with an ESI.
 */

/** Where a flag's authority comes from. */
export const FLAG_SOURCES = Object.freeze({
    /** Published by ESI as part of its fitting item enum. */
    esi: "esi",
    /** Recorded by hand from the retired invFlags table; unverified. */
    manual: "manual"
});

/** Slots that hold a fitted module, and how many the engine indexes. */
const SLOT_RANGES = Object.freeze([
    { slot: "low", prefix: "LoSlot", count: 8, firstID: 11 },
    { slot: "medium", prefix: "MedSlot", count: 8, firstID: 19 },
    { slot: "high", prefix: "HiSlot", count: 8, firstID: 27 },
    { slot: "rig", prefix: "RigSlot", count: 8, firstID: 92 },
    { slot: "subsystem", prefix: "SubSystemSlot", count: 8, firstID: 125 },
    // The service range is the one set of IDs not recorded with enough
    // confidence to write down, so the names are here and the numbers are not.
    { slot: "service", prefix: "ServiceSlot", count: 8, firstID: null }
]);

/** Everything that is not a fitted slot but still appears on a fitting. */
const BAYS = Object.freeze([
    { name: "Cargo", kind: "cargo", flagID: 5 },
    { name: "DroneBay", kind: "drone", flagID: 87 },
    { name: "FighterBay", kind: "fighter", flagID: 158 },
    { name: "FighterTube0", kind: "fighter", flagID: 159 },
    { name: "FighterTube1", kind: "fighter", flagID: 160 },
    { name: "FighterTube2", kind: "fighter", flagID: 161 },
    { name: "FighterTube3", kind: "fighter", flagID: 162 },
    { name: "FighterTube4", kind: "fighter", flagID: 163 },
    { name: "Implant", kind: "implant", flagID: 89 },
    { name: "Unlocked", kind: "cargo", flagID: null }
]);

/** The whole vocabulary, built once. */
export const FITTING_FLAGS = Object.freeze(BuildFlags());

const BY_NAME = new Map(FITTING_FLAGS.map(flag => [ flag.name, flag ]));
const BY_ID = new Map(FITTING_FLAGS.filter(flag => flag.flagID !== null).map(flag => [ flag.flagID, flag ]));

function BuildFlags()
{
    const flags = [];

    for (const range of SLOT_RANGES)
    {
        for (let index = 0; index < range.count; index++)
        {
            flags.push(Object.freeze({
                name: `${range.prefix}${index}`,
                flagID: range.firstID === null ? null : range.firstID + index,
                slot: range.slot,
                position: index,
                kind: "module",
                // The name is ESI's; the number, where present, is ours.
                source: FLAG_SOURCES.esi,
                flagIDSource: range.firstID === null ? null : FLAG_SOURCES.manual
            }));
        }
    }

    for (const bay of BAYS)
    {
        flags.push(Object.freeze({
            name: bay.name,
            flagID: bay.flagID,
            slot: null,
            position: null,
            kind: bay.kind,
            source: FLAG_SOURCES.esi,
            flagIDSource: bay.flagID === null ? null : FLAG_SOURCES.manual
        }));
    }

    return flags;
}

/** One flag by its ESI name, or null when it is not one we know. */
export function FlagByName(name)
{
    return BY_NAME.get(String(name ?? "")) ?? null;
}

/** One flag by its client-side number, or null. */
export function FlagByID(flagID)
{
    return BY_ID.get(Number(flagID)) ?? null;
}

/** The flag for a slot and index, or null when the slot does not take one. */
export function FlagForSlot(slot, position)
{
    const range = SLOT_RANGES.find(entry => entry.slot === slot);

    if (!range || !Number.isInteger(position) || position < 0) return null;

    // Beyond the indexed range the name is still formed the same way. A hull
    // with a ninth high slot does not exist today, and inventing a different
    // spelling for it would be worse than extending the obvious one.
    return `${range.prefix}${position}`;
}

/**
 * Reads a flag name back into a slot and index.
 *
 * Returns null for anything that is not a fitted slot, which is what the codec
 * treats as "in a bay rather than on the hull".
 */
export function ReadFlag(name)
{
    const known = FlagByName(name);

    if (known) return known.slot === null ? null : { slot: known.slot, position: known.position };

    // Not in the table, but still recognisably a slot: a position past the
    // indexed range, or a spelling from a build newer than this table.
    for (const range of SLOT_RANGES)
    {
        const match = new RegExp(`^${range.prefix}(\\d+)$`, "u").exec(String(name ?? ""));

        if (match) return { slot: range.slot, position: Number(match[1]) };
    }

    return null;
}

/** What this vocabulary is and where each half came from, for a describe route. */
export function DescribeFlags()
{
    return {
        count: FITTING_FLAGS.length,
        names: {
            source: FLAG_SOURCES.esi,
            note: "ESI's fitting item enum. The same engine serves every target, so these hold where there is no ESI."
        },
        flagIDs: {
            source: FLAG_SOURCES.manual,
            verified: false,
            known: BY_ID.size,
            missing: FITTING_FLAGS.filter(flag => flag.flagID === null).map(flag => flag.name),
            note: "Recorded from the retired invFlags table. No current SDE or resource data publishes them."
        }
    };
}
