import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWGPU conversion. */
export class CjsToolShaderBuilderWebgpu extends CjsToolShaderBuilder
{

    /** Written as `_type` into every report and overlay this builder produces. */
    static className = "CjsToolShaderBuilderWebgpu";

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
