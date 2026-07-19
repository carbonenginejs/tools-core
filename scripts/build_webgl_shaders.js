import { CjsToolWebglBuilder } from "../src/shader/index.js";
import {
    ReportShaderBuilderFatal,
    RunShaderBuilder,
} from "./build_shader_helpers.js";

RunShaderBuilder(CjsToolWebglBuilder, "webgl").catch((error) =>
{
    ReportShaderBuilderFatal(error, "webgl");
    process.exitCode = 1;
});
