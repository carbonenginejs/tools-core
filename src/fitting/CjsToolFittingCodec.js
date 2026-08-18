/**
 * Reads and writes the three shapes a fitting travels in.
 *
 * ## The three shapes
 *
 * - **EFT** - what the game's *Copy to Clipboard* produces, and what every
 *   fitting site accepts. Type names, localized, one per line.
 * - **DNA** - a compact list of type IDs, which is what a chat link carries.
 * - **chat link** - DNA wrapped as `<url=fitting:DNA>Name</url>`.
 *
 * A caller pastes any of them and gets one record back; the same record emits
 * all three. That round trip is the point: a fit imported from a screenshot of
 * someone's EFT can be handed straight back out as a link.
 *
 * ## Two things the published format guide says that are easy to get wrong
 *
 * **EFT section order is low, medium, high** - not high downward, which is how
 * the fitting window is drawn and what everyone assumes. The order is: header,
 * low, medium, high, rigs, subsystems, services, drones, cargo. Sections are
 * separated by one blank line, except drones and cargo which are separated by
 * two.
 *
 * **DNA does not delimit its sections.** The published grammar reads
 * `SHIP ':' HIGHS ':' MEDS ':' LOWS ':' RIGS ':' CHARGES`, but each of those is
 * itself a `:`-separated list, so a parser cannot tell from the string where one
 * section ends and the next begins - the real example
 * `72904:4250;2:4258;1:...:30488;8::` is a flat run of `id;quantity` groups
 * with two empty sections at the end. Slot therefore comes from the module's own
 * dogma, never from its position. That is also more robust: it survives a
 * producer that grouped its sections differently, and it is the only way to
 * place an item that arrived from EFT text anyway.
 *
 * `_` after a module ID means unfitted. Charges are always unfitted.
 *
 * ## What the resolver owns
 *
 * Nothing here knows a single type ID or name. The caller injects a resolver:
 *
 * ```js
 * {
 *   async Resolve(name)      // localized type name -> { typeID, name } | null
 *   async Classify(typeID)   // -> { slot, category, name } | null
 * }
 * ```
 *
 * That keeps the codec exact-build correct without embedding data that changes
 * every patch, keeps its tests offline, and lets the same code serve a source
 * whose names are in another language.
 */

import { FlagForSlot } from "./CjsToolFittingFlags.js";

/** Where an item sits. `null` when it is not fitted to a slot at all. */
export const FITTING_SLOTS = Object.freeze([ "high", "medium", "low", "rig", "subsystem", "service" ]);

/**
 * Where unfitted things go, by what the resolver called them.
 *
 * The flag names themselves live in `CjsToolFittingFlags`, with the provenance
 * of each half recorded - nothing publishes this vocabulary any more.
 */
export const UNFITTED_FLAGS = Object.freeze({
    drone: "DroneBay",
    fighter: "FighterBay",
    implant: "Implant",
    cargo: "Cargo"
});

const CHAT_LINK = /<url=fitting:([^>]+)>(.*?)<\/url>/iu;
const EFT_HEADER = /^\[([^,\]]+)\s*,\s*(.*)\]$/u;
const QUANTITY_SUFFIX = /\s+x(\d+)$/iu;
const OFFLINE_SUFFIX = /\s*\/offline$/iu;

/**
 * Reads any supported fitting text.
 *
 * Throws on input it cannot read rather than returning an empty fit: a fitting
 * that silently loses its modules looks like a valid fit of an empty hull, and
 * the caller would show it as one.
 */
export async function ParseFitting(text, resolver, options = {})
{
    const input = String(text ?? "").trim();

    if (!input) throw new TypeError("Fitting text is empty");

    const link = CHAT_LINK.exec(input);

    if (link) return ParseDna(link[1], resolver, { ...options, name: link[2]?.trim() || null, kind: "chatLink" });

    // A DNA string is one line of digits, separators and underscores. Testing
    // for that is safer than testing for EFT's bracket, because a fit whose
    // header was lost still parses as EFT and would otherwise be read as DNA.
    if (/^\d+(?::(?:\d+_?;\d+)?)*:*$/u.test(input)) return ParseDna(input, resolver, { ...options, kind: "dna" });

    return ParseEft(input, resolver, options);
}

/**
 * Reads a DNA string, or the DNA half of a chat link.
 *
 * Section boundaries are ignored on purpose - see the note at the top. Empty
 * groups are skipped rather than treated as an error, because a fit with no
 * rigs is written with the section simply absent.
 */
export async function ParseDna(text, resolver, options = {})
{
    const parts = String(text ?? "").trim().split(":");
    const shipTypeID = Number(parts.shift());

    if (!Number.isSafeInteger(shipTypeID) || shipTypeID <= 0)
    {
        throw new TypeError(`Fitting DNA does not start with a ship type: ${text}`);
    }

    const items = [];

    for (const part of parts)
    {
        if (!part) continue;

        const [ left, right ] = part.split(";");
        const fitted = !left.endsWith("_");
        const typeID = Number(fitted ? left : left.slice(0, -1));
        const quantity = right === undefined ? 1 : Number(right);

        if (!Number.isSafeInteger(typeID) || typeID <= 0)
        {
            throw new TypeError(`Fitting DNA has a malformed module: ${part}`);
        }

        if (!Number.isSafeInteger(quantity) || quantity <= 0)
        {
            throw new TypeError(`Fitting DNA has a malformed quantity: ${part}`);
        }

        items.push({ typeID, quantity, fitted });
    }

    return Normalize({
        kind: options.kind ?? "dna",
        name: options.name ?? null,
        shipTypeID,
        items
    }, resolver);
}

/**
 * Reads EFT text.
 *
 * Blank-line sections are not used to decide slots - the resolver does that -
 * so a paste with mangled spacing still reads correctly. What the sections
 * would give is ordering within a slot, and EFT does not carry a reliable
 * position anyway once empty slots are omitted.
 */
export async function ParseEft(text, resolver, options = {})
{
    const lines = String(text).split(/\r?\n/u);
    const header = EFT_HEADER.exec(lines[0]?.trim() ?? "");

    if (!header) throw new TypeError("EFT text does not begin with a [Hull, Name] header");

    const hull = await resolver.Resolve(header[1].trim());

    if (!hull) throw new TypeError(`Unknown hull in EFT header: ${header[1].trim()}`);

    const items = [];

    for (const raw of lines.slice(1))
    {
        const line = raw.trim();

        if (!line) continue;

        // Written by the game on export and accepted on import; it carries no
        // information the record keeps, since online state is not modelled.
        const withoutState = line.replace(OFFLINE_SUFFIX, "").trim();

        // An empty slot is written out on import and never on export. It names
        // no type, so there is nothing to resolve and nothing to record.
        if (/^\[empty .* slot\]$/iu.test(withoutState)) continue;

        // `Warrior II x2` and `Antimatter Charge M x42`. A charge loaded into a
        // module is written on its own line the same way.
        const quantityMatch = QUANTITY_SUFFIX.exec(withoutState);
        const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
        const name = quantityMatch ? withoutState.slice(0, quantityMatch.index).trim() : withoutState;

        if (!name) continue;

        const type = await resolver.Resolve(name);

        if (!type) throw new TypeError(`Unknown type in EFT text: ${name}`);

        items.push({ typeID: type.typeID, quantity, fitted: true });
    }

    return Normalize({
        kind: "eft",
        name: header[2].trim() || null,
        shipTypeID: hull.typeID,
        items
    }, resolver);
}

/**
 * Classifies every item and assigns flags.
 *
 * A charge or drone that arrived from EFT as `fitted` is corrected here: the
 * text cannot say, and the type can.
 */
async function Normalize(parsed, resolver)
{
    const counters = new Map();
    const items = [];

    for (const item of parsed.items)
    {
        const classified = await resolver.Classify(item.typeID);
        const slot = classified?.slot ?? null;
        const category = classified?.category ?? null;
        const fitted = slot !== null && item.fitted;

        let flag = null;
        let position = null;

        if (fitted)
        {
            // Position is assigned in encounter order. EFT omits empty slots and
            // DNA carries no index, so a position here means "the nth module in
            // this slot as written", never "the slot the pilot had it in".
            position = counters.get(slot) ?? 0;
            counters.set(slot, position + 1);
            flag = FlagForSlot(slot, position);
        }
        else
        {
            flag = UNFITTED_FLAGS[category] ?? UNFITTED_FLAGS.cargo;
        }

        items.push({
            typeID: item.typeID,
            name: classified?.name ?? null,
            quantity: item.quantity,
            flag,
            slot: fitted ? slot : null,
            position,
            fitted,
            category
        });
    }

    const ship = await resolver.Classify(parsed.shipTypeID);

    return {
        source: { kind: parsed.kind, fittingID: null },
        name: parsed.name,
        description: "",
        shipTypeID: parsed.shipTypeID,
        shipName: ship?.name ?? null,
        items
    };
}

/**
 * Writes the record back out as DNA.
 *
 * Ordered high, medium, low, rig, subsystem, then everything unfitted, which is
 * the order the published grammar lists its sections in. Section separators are
 * not emitted, because a reader cannot use them - the two trailing colons are
 * kept because every DNA string in the wild carries them and some readers
 * expect the terminator.
 */
export function FormatDna(record)
{
    const order = [ "high", "medium", "low", "rig", "subsystem", "service" ];
    const parts = [ String(record.shipTypeID) ];

    for (const slot of order)
    {
        for (const item of record.items.filter(entry => entry.slot === slot))
        {
            parts.push(`${item.typeID};${item.quantity}`);
        }
    }

    for (const item of record.items.filter(entry => !entry.fitted))
    {
        parts.push(`${item.typeID}_;${item.quantity}`);
    }

    return `${parts.join(":")}::`;
}

/** Writes the record as a chat link, which is DNA plus a display name. */
export function FormatChatLink(record, name = null)
{
    const label = name ?? record.name ?? record.shipName ?? "Fitting";

    return `<url=fitting:${FormatDna(record)}>${label}</url>`;
}

/**
 * Writes the record as EFT text.
 *
 * Needs names, so an item the resolver could not name is written by type ID in
 * angle brackets rather than omitted - a fit that silently loses a module on
 * export is worse than one that is visibly incomplete.
 */
export function FormatEft(record)
{
    const Name = item => item.name ?? `<type ${item.typeID}>`;
    const lines = [ `[${record.shipName ?? `<type ${record.shipTypeID}>`}, ${record.name ?? "Fitting"}]` ];
    const Section = (slot) =>
    {
        const entries = record.items.filter(item => item.slot === slot);

        if (!entries.length) return;

        lines.push("");
        for (const item of entries) lines.push(Name(item));
    };

    // Low, medium, high - the published order, which is not the order the
    // fitting window draws.
    for (const slot of [ "low", "medium", "high", "rig", "subsystem", "service" ]) Section(slot);

    const loose = record.items.filter(item => !item.fitted);

    if (loose.length)
    {
        lines.push("", "");
        for (const item of loose)
        {
            lines.push(item.quantity > 1 ? `${Name(item)} x${item.quantity}` : Name(item));
        }
    }

    return lines.join("\n");
}

/** The record plus every wire form, which is what a caller usually wants. */
export function FormatAll(record)
{
    return {
        ...record,
        formats: {
            dna: FormatDna(record),
            chatLink: FormatChatLink(record),
            eft: FormatEft(record)
        }
    };
}
