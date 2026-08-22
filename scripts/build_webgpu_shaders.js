import { CjsToolShaderBuilderWebgpu } from "../src/shader/index.js";
import {
    ReportShaderBuilderFatal,
    RunShaderBuilder,
} from "./build_shader_helpers.js";

RunShaderBuilder(CjsToolShaderBuilderWebgpu, "webgpu").catch((error) =>
{
    ReportShaderBuilderFatal(error, "webgpu");
    process.exitCode = 1;
});
