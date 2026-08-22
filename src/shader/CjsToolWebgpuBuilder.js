import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWGPU conversion. */
export class CjsToolWebgpuBuilder extends CjsToolShaderBuilder
{

    /** Written as `_type` into every report and overlay this builder produces. */
    static className = "CjsToolWebgpuBuilder";

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
