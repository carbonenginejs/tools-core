import { CjsRealtimeChatContract } from "./CjsRealtimeChatContract.js";

/**
 * Applies immutable, empty-by-default term and user blocks to provider-neutral
 * chat payloads.
 */
export class CjsRealtimeChatBlockList
{

    constructor({ terms = [], users = [] } = {})
    {
        this.terms = CjsRealtimeChatBlockList.normalizeList(
            terms,
            "terms",
            CjsRealtimeChatContract.normalizeTermSelector,
        );
        this.users = CjsRealtimeChatBlockList.normalizeList(
            users,
            "users",
            CjsRealtimeChatContract.normalizeUserSelector,
        );
        Object.freeze(this);
    }

    /** Returns whether no term or user blocks are configured. */
    IsEmpty()
    {
        return this.terms.length === 0 && this.users.length === 0;
    }

    /** Returns whether message text contains a literal blocked term. */
    BlocksTerm(room, text)
    {
        if (String(text ?? "").length === 0)
        {
            return false;
        }

        return this.terms.some(selector =>
            CjsRealtimeChatContract.matchesTermBlock(selector, room, text));
    }

    /** Returns whether an author is blocked in its provider integration. */
    BlocksUser(room, author)
    {
        return this.users.some(selector =>
            CjsRealtimeChatContract.matchesUserBlock(selector, room, author));
    }

    /** Returns whether a complete chat message is blocked. */
    BlocksMessage(message)
    {
        return this.BlocksTerm(message?.room, message?.text)
            || this.BlocksUser(message?.room, message?.author);
    }

    static normalizeList(value, label, normalize)
    {
        if (!Array.isArray(value) || value.length > 10000)
        {
            throw new TypeError(`Chat block-list ${label} must be a bounded array`);
        }

        const normalized = value.map(entry => normalize(entry));
        const unique = new Map(normalized.map(entry => [ JSON.stringify(entry), entry ]));

        return Object.freeze([ ...unique.values() ].sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right))));
    }

}
