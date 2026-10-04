import { readFileSync } from "node:fs";
import { verifyPackage } from "./authority.js";
const result = verifyPackage(JSON.parse(readFileSync(process.argv[2], "utf8")));
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.valid ? 0 : 1;
