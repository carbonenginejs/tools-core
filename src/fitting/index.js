/**
 * `@carbonenginejs/tools-core/fitting`: EVE fittings. `CjsToolFitting` joins parsed
 * text to exact-build type and slot data; the codec functions (`ParseFitting`,
 * `FormatAll`, ...) read and write EFT, DNA and chat links; the flag functions
 * map slots and positions to inventory flags.
 */
export {
    CjsToolFitting,
    FITTING_CATEGORIES,
    FITTING_TABLES,
    SLOT_EFFECTS
} from "./CjsToolFitting.js";
export {
    FITTING_SLOTS,
    FormatAll,
    FormatChatLink,
    FormatDna,
    FormatEft,
    ParseDna,
    ParseEft,
    ParseFitting,
    UNFITTED_FLAGS
} from "./CjsToolFittingCodec.js";
export {
    DescribeFlags,
    FITTING_FLAGS,
    FLAG_SOURCES,
    FlagByID,
    FlagByName,
    FlagForSlot,
    ReadFlag
} from "./CjsToolFittingFlags.js";
