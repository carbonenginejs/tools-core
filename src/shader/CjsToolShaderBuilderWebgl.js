import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWG conversion. */
export class CjsToolShaderBuilderWebgl extends CjsToolShaderBuilder
{

    /** Written as `_type` into every report and overlay this builder produces. */
    static className = "CjsToolShaderBuilderWebgl";

    /**
     * Specializes the shared shader pipeline for CEWG artifacts and the runtime
     * WebGL format.
     */
    constructor(options = {})
    {
        super({
            ...options,
            backend: "webgl",
            extension: "cewg",
            formatPackage: "@carbonenginejs/runtime/resource/formats/webgl",
        });
    }

}
