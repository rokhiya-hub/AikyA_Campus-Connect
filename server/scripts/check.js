const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : file.endsWith(".js") ? [file] : [];
  });
}

const files = [...filesIn(path.join(__dirname, "../src")), ...filesIn(__dirname)];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} server files (seed files parsed, never executed).`);
