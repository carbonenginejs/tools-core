import { CjsToolShaderBuilder } from "./CjsToolShaderBuilder.js";

/** Node orchestration for browser-complete CEWG conversion. */
export class CjsToolWebglBuilder extends CjsToolShaderBuilder
{

    constructor(options = {})
    {
        super({
            ...options,
            backend: "webgl",
            extension: "cewg",
            formatPackage: "@carbonenginejs/format-webgl",
        });
    }

}
