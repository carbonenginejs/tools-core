import { CjsToolShaderBuilderWebgl } from "../src/shader/index.js";
import {
    ReportShaderBuilderFatal,
    RunShaderBuilder,
} from "./build_shader_helpers.js";

RunShaderBuilder(CjsToolShaderBuilderWebgl, "webgl").catch((error) =>
{
    ReportShaderBuilderFatal(error, "webgl");
    process.exitCode = 1;
});
