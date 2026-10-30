const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const assets = path.resolve(__dirname, "../dist/assets");
const files = fs.readdirSync(assets).filter(file => file.endsWith(".js"));
assert.ok(files.length, "Run npm run build first");
for (const file of files) {
  assert.ok(!fs.readFileSync(path.join(assets, file), "utf8").includes("simulation-only"), "Development bus fixture leaked into a production bundle");
}
console.log("Tracking production build PASS: development bus fixture excluded from all JavaScript assets.");
