/**
 * Derives `corporationRoles.roleGroupIDs`, which the client does not store.
 *
 * Every other published column is read from a file. This one is computed, and
 * the computation is the whole reason the column can be generated at all: the
 * client stores the relation once, on the group, as a bit set over role
 * identifiers in `corporationRoleGroups.roleMask`. Role `r` belongs to group `g`
 * exactly when bit `r` of `g`'s mask is set.
 *
 * The mask exceeds 2^53, so it decodes as a string and the test has to be done
 * in `BigInt`. Doing it in `Number` silently loses the high roles.
 *
 * Verified against CCP build 3466501: all 55 roles reproduce the export exactly,
 * including role 61, which is in no group at all and which the export publishes
 * with no `roleGroupIDs` field rather than with an empty list.
 */

/**
 * @param {object} roles Projected `corporationRoles` rows, keyed by role.
 * @param {object} roleGroups Decoded `corporationRoleGroups` records, keyed by
 *   group, each carrying `roleMask`.
 * @returns {object} The same rows, with `roleGroupIDs` added where non-empty.
 */
export function DeriveRoleGroupIDs(roles, roleGroups)
{
    const masks = Object.entries(roleGroups)
        .map(([ group, record ]) => [ Number(group), BigInt(record.roleMask ?? 0) ]);

    for (const [ role, row ] of Object.entries(roles))
    {
        const bit = 1n << BigInt(role);
        const groups = masks.filter(([ , mask ]) => (mask & bit) !== 0n).map(([ group ]) => group);

        // An empty list and an absent one are the same statement, and the
        // exporter makes it by saying nothing - as it does for every other
        // empty list in this export.
        if (groups.length) row.roleGroupIDs = groups.sort((left, right) => left - right);
    }

    return roles;
}

export default DeriveRoleGroupIDs;
