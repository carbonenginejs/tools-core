import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWG conversion. */
export class CjsToolWebglBuilder extends CjsToolShaderBuilder
{

    /** Written into every report and overlay this builder produces. */
    static builderId = "CjsToolWebglBuilder";

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
