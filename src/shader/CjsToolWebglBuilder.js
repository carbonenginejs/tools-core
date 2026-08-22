import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWG conversion. */
export class CjsToolWebglBuilder extends CjsToolShaderBuilder
{

    /** Written as `_type` into every report and overlay this builder produces. */
    static className = "CjsToolWebglBuilder";

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
