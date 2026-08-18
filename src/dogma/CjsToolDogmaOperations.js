/**
 * Dogma modifier operations, and the order they are applied in.
 *
 * ## Where these come from
 *
 * `dogmaEffects.modifierInfo` describes every modifier as a small record:
 *
 * ```json
 * { "domain": "shipID", "func": "ItemModifier",
 *   "modifiedAttributeID": 48, "modifyingAttributeID": 424, "operation": 6 }
 * ```
 *
 * The `operation` is an integer opcode and the data does not say anywhere
 * what the integers mean. The mapping below is the published one used by every
 * public implementation of dogma, and each entry here was checked against real
 * data rather than copied: the CPU chain is the worked example.
 *
 * ## The worked example, end to end
 *
 * CPU Management (type 3426) carries `cpuOutputBonus2` (attribute 424) = 5 and
 * `skillLevel` (attribute 280) = 0. Two of its effects do the work:
 *
 * - effect 368, `domain: itemID`, operation **0** (preMultiply): multiplies the
 *   skill's own 424 by its own 280, so at level V the bonus becomes 5 x 5 = 25.
 * - effect 397, `domain: shipID`, operation **6** (postPercent): adds 25% to
 *   the ship's `cpuOutput` (attribute 48).
 *
 * A Viator's published 250 tf therefore becomes 250 x 1.25 = 312.5 tf, which is
 * the number the game shows. Nothing here is special-cased for CPU: the same
 * two opcodes drive power grid through attributes 313/11, and the rest of the
 * table follows the same shape.
 *
 * ## Order matters, and is not the order they are found in
 *
 * Modifiers are grouped by operation and applied in ascending `order`, not in
 * the order the effects happen to be listed. An addition applied before a
 * multiplication gives a different answer than the same pair applied after, and
 * the in-game answer is the one below. Within a single operation the order of
 * application does not change the result: every operation in this table is
 * commutative with itself.
 */

/**
 * The opcodes, keyed by the integer the data uses.
 *
 * `apply` takes the value so far and the modifying value, and returns the new
 * value. Assignment operations ignore the running value by design - that is
 * what makes them assignments.
 */
export const DOGMA_OPERATIONS = Object.freeze({
    "-1": Object.freeze({ name: "preAssign", order: 0, apply: (value, amount) => amount }),
    0: Object.freeze({ name: "preMultiply", order: 1, apply: (value, amount) => value * amount }),
    1: Object.freeze({ name: "preDivide", order: 2, apply: (value, amount) => (amount === 0 ? value : value / amount) }),
    2: Object.freeze({ name: "modAdd", order: 3, apply: (value, amount) => value + amount }),
    3: Object.freeze({ name: "modSubtract", order: 4, apply: (value, amount) => value - amount }),
    4: Object.freeze({ name: "postMultiply", order: 5, apply: (value, amount) => value * amount }),
    5: Object.freeze({ name: "postDivide", order: 6, apply: (value, amount) => (amount === 0 ? value : value / amount) }),
    6: Object.freeze({ name: "postPercent", order: 7, apply: (value, amount) => value * (1 + (amount / 100)) }),
    7: Object.freeze({ name: "postAssign", order: 8, apply: (value, amount) => amount })
});

/**
 * Returns the operation for an opcode, or null when the opcode is not one we
 * implement.
 *
 * Returning null rather than throwing is deliberate. An unknown opcode is a
 * fact about the data, not a programming error, and the caller's job is to
 * report it as an unsupported effect rather than to fail the whole request. Live
 * data contains at least one opcode this table does not cover - operation
 * 9, on the shared `skillEffect` (132), which participates in training time
 * rather than in any statistic we evaluate.
 */
export function DogmaOperation(operation)
{
    return DOGMA_OPERATIONS[String(operation)] ?? null;
}

/**
 * The modifier functions this evaluator implements.
 *
 * `ItemModifier` is the only one an empty hull needs: it modifies one attribute
 * on one target. The four location functions
 * (`LocationModifier`, `LocationGroupModifier`, `LocationRequiredSkillModifier`,
 * `OwnerRequiredSkillModifier`) modify *other items in a location* - the modules
 * and drones a fitting would contain - so they cannot change a bare hull's own
 * statistics. They are named here so that meeting one is a recognised
 * unsupported case rather than a silent skip.
 */
export const SUPPORTED_MODIFIER_FUNCTIONS = Object.freeze([ "ItemModifier" ]);

/** Every function live data uses, so an unknown one is distinguishable. */
export const KNOWN_MODIFIER_FUNCTIONS = Object.freeze([
    "ItemModifier",
    "LocationModifier",
    "LocationGroupModifier",
    "LocationRequiredSkillModifier",
    "OwnerRequiredSkillModifier",
    "EffectStopper"
]);

/**
 * Applies a set of modifiers to a starting value in operation order.
 *
 * Returns the value and the trace, because a fitting number nobody can explain
 * is not much better than no number: the trace is what lets a caller show
 * "312.5 tf (+25% CPU Management V)" instead of an unattributed 312.5.
 */
export function ApplyModifiers(baseValue, modifiers)
{
    const ordered = [ ...modifiers ].sort((left, right) =>
    {
        const leftOrder = DogmaOperation(left.operation)?.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = DogmaOperation(right.operation)?.order ?? Number.MAX_SAFE_INTEGER;

        // Ties break on the source so a run is reproducible byte for byte;
        // within one operation the arithmetic is commutative, so this changes
        // the trace order and never the value.
        return leftOrder - rightOrder
            || Number(left.sourceTypeID ?? 0) - Number(right.sourceTypeID ?? 0)
            || Number(left.effectID ?? 0) - Number(right.effectID ?? 0);
    });

    const applied = [];
    let value = baseValue;

    for (const modifier of ordered)
    {
        const operation = DogmaOperation(modifier.operation);

        if (!operation) continue;

        const before = value;

        value = operation.apply(value, modifier.amount);

        applied.push({
            attributeID: modifier.attributeID,
            attribute: modifier.attribute ?? null,
            operation: operation.name,
            amount: modifier.amount,
            effectID: modifier.effectID,
            effect: modifier.effect ?? null,
            sourceTypeID: modifier.sourceTypeID ?? null,
            sourceLevel: modifier.sourceLevel ?? null,
            from: before,
            to: value
        });
    }

    return { value, applied };
}
