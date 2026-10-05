import { readFileSync, writeFileSync } from "node:fs";
import { GenerateRequest } from "./gen/plugin/codegen_pb";
import { codegen } from "./generate";

const request = GenerateRequest.fromBinary(readFileSync(0));
writeFileSync(1, codegen(request).toBinary());
