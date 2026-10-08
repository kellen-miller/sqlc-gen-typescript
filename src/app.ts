// Javy exposes WASI stdin/stdout through this module.
// @ts-expect-error Javy's published declarations use a different module path.
import { readFileSync, writeFileSync, STDIO } from "javy/fs";
import { GenerateRequest } from "./gen/plugin/codegen_pb";
import { codegen } from "./generate";

const request = GenerateRequest.fromBinary(readFileSync(STDIO.Stdin));
writeFileSync(STDIO.Stdout, codegen(request).toBinary());
