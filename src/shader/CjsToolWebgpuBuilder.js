import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWGPU conversion. */
export class CjsToolWebgpuBuilder extends CjsToolShaderBuilder
{

    constructor(options = {})
    {
        super({
            ...options,
            backend: "webgpu",
            extension: "cewgpu",
            formatPackage: "@carbonenginejs/format-webgpu",
        });
    }

}
