/**
 * `@carbonenginejs/tools-core/localisation`: English names for sources that lack
 * them (`CjsToolLocalisation`, with manual and guessed name readers) and the
 * dictionary builders behind machine-guessed names.
 */
export {
    CjsToolLocalisation,
    NAME_EVIDENCE,
    NAME_SOURCES,
    ReadGuessedNames,
    ReadManualNames
} from "./CjsToolLocalisation.js";
export {
    BuildLocalDictionary,
    BuildNameDictionary,
    GuessEnglishName,
    LOCAL_VOCABULARY,
    MergeDictionaries,
    PATTERN_RULES
} from "./CjsToolLocalisationGuess.js";
