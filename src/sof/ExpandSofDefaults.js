let runtimeDefaults;

/**
 * Loads the graph-class families only when a caller explicitly asks for the
 * default-expanded SOF projection. The canonical sparse SOF path therefore
 * remains class-free and does not pay this module-evaluation cost.
 */
export async function PrepareSofDefaults()
{
    runtimeDefaults ??= Promise.all([
        import("@carbonenginejs/runtime/schema"),
        import("@carbonenginejs/runtime/trinity"),
        import("@carbonenginejs/runtime/audio/trinity"),
    ]).then(([schema]) => schema.CjsSchema);
    return runtimeDefaults;
}

/** Applies runtime-owned class defaults to one sparse SOF values graph. */
export async function ExpandSofDefaults(values)
{
    const CjsSchema = await PrepareSofDefaults();
    return CjsSchema.applyDefaults(values);
}
