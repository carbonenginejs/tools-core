import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWGPU conversion. */
export class CjsToolShaderBuilderWebgpu extends CjsToolShaderBuilder
{

    /** Written as `_type` into every report and overlay this builder produces. */
    static className = "CjsToolShaderBuilderWebgpu";

    /**
     * Specializes the shared shader pipeline for CEWGPU artifacts and the
     * runtime WebGPU format.
     */
    constructor(options = {})
    {
        super({
            ...options,
            backend: "webgpu",
            extension: "cewgpu",
            formatPackage: "@carbonenginejs/runtime/resource/formats/webgpu",
        });
    }

}
