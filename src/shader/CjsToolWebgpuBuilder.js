import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWGPU conversion. */
export class CjsToolWebgpuBuilder extends CjsToolShaderBuilder
{

    /** Written into every report and overlay this builder produces. */
    static builderId = "CjsToolWebgpuBuilder";

    constructor(options = {})
    {
        super({
            ...options,
            backend: "webgpu",
            extension: "cewgpu",
            formatPackage: "@carbonenginejs/runtime-resource/formats/webgpu",
        });
    }

}
