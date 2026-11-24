let runtimeDefaults;

/**
 * Loads the graph-class families only when a caller explicitly asks for the
 * default-expanded SOF projection. The canonical sparse SOF path therefore
 * remains class-free and does not pay this module-evaluation cost.
 */
export async function PrepareSofDefaults()
{
    runtimeDefaults ??= Promise.all([
        import("@carbonenginejs/runtime/graph"),
        import("@carbonenginejs/runtime/trinity"),
        import("@carbonenginejs/runtime/audio/trinity"),
    ]).then(([graph]) => graph.CjsGraph);
    return runtimeDefaults;
}

/** Constructs without Initialize and writes all exposed values, including runtime class defaults. */
export async function ExpandSofDefaults(values)
{
    const CjsGraph = await PrepareSofDefaults();
    return CjsGraph.get(CjsGraph.from(null, values, { initialize: false }), { full: true, persistOnly: false, forceTypeTags: true });
}
