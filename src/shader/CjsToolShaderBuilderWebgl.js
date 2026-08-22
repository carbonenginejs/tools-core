import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWG conversion. */
export class CjsToolShaderBuilderWebgl extends CjsToolShaderBuilder
{

    /** Written as `_type` into every report and overlay this builder produces. */
    static className = "CjsToolShaderBuilderWebgl";

    constructor(options = {})
    {
        super({
            ...options,
            backend: "webgl",
            extension: "cewg",
            formatPackage: "@carbonenginejs/runtime-resource/formats/webgl",
        });
    }

}
