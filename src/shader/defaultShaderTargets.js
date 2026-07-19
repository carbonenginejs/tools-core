export const DefaultShaderTargetData = Object.freeze([
    Object.freeze({
        id: "frontier-webgl2",
        target: "frontier",
        format: "CEWG",
        sourceProfile: "effect.dx11",
        outputProfile: "effect.webgl2",
        qualityTiers: Object.freeze([ "hi" ]),
        sourceFamilies: Object.freeze([ "dx11-sm5.0" ]),
        selectionPolicy: Object.freeze({
            sourceFamily: "dx11-sm5.0",
            permutationMode: "all",
        }),
        qualificationPolicy: Object.freeze({
            level: "structural",
            nativeComparison: "not-applicable",
        }),
        overlay: "webgl2",
    }),
    Object.freeze({
        id: "eve-webgl2",
        target: "eve",
        format: "CEWG",
        sourceProfile: "effect.dx11",
        outputProfile: "effect.webgl2",
        qualityTiers: Object.freeze([ "depth", "hi" ]),
        sourceFamilies: Object.freeze([ "dx11-sm5.0" ]),
        selectionPolicy: Object.freeze({
            sourceFamily: "dx11-sm5.0",
            permutationMode: "all",
        }),
        qualificationPolicy: Object.freeze({
            level: "structural",
            nativeComparison: "not-applicable",
        }),
        overlay: "webgl2",
    }),
    Object.freeze({
        id: "eve-webgpu",
        target: "eve",
        format: "CEWGPU",
        sourceProfile: "effect.dx11",
        outputProfile: "effect.webgpu",
        qualityTiers: Object.freeze([ "hi" ]),
        sourceFamilies: Object.freeze([ "dx11-sm5.0" ]),
        selectionPolicy: Object.freeze({
            sourceFamily: "dx11-sm5.0",
            permutationMode: "selected",
        }),
        qualificationPolicy: Object.freeze({
            level: "structural",
            nativeComparison: "pending-audit",
        }),
        overlay: "webgpu",
    }),
]);
