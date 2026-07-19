import { CjsToolWebglBuilder } from "../src/shader/index.js";
import { RunShaderBuilder } from "./build_shader_helpers.js";

RunShaderBuilder(CjsToolWebglBuilder, "webgl").catch((error) =>
{
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
