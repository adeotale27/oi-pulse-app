import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME } from "./appVersion.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fromFile = fs.readFileSync(path.join(root, "APP_NAME"), "utf8").trim().split("\n")[0].trim();
assert.equal(fromFile, "StrikLenz");
assert.equal(APP_NAME, fromFile);
console.log("appVersion.test.js ok");
