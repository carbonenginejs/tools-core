import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete WebGL effect conversion. */
export class CjsToolShaderBuilderWebgl extends CjsToolShaderBuilder
{

    /** Written as `_type` into every report and overlay this builder produces. */
    static className = "CjsToolShaderBuilderWebgl";

    /**
     * Specializes the shared shader pipeline for the runtime WebGL format and
     * the effect.webgl2 output profile.
     */
    constructor(options = {})
    {
        super({
            ...options,
            backend: "webgl",
            formatPackage: "@carbonenginejs/runtime/resource/formats/webgl",
        });
    }

}
