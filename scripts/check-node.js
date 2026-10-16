import { readFileSync } from "node:fs";
import { satisfies, minVersion } from "semver";
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const minimum = read(".nvmrc").trim();
if (!satisfies(process.versions.node, pkg.engines.node))
  throw Error(`Use Node ${pkg.engines.node}`);
if (String(minVersion(pkg.engines.node)) !== minimum || !read("README.md").includes(minimum))
  throw Error("Node minimum differs between package.json, .nvmrc and README.md");
if (lock.packages[""].engines.node !== pkg.engines.node)
  throw Error("Refresh the lockfile engines");
for (const [name, info] of Object.entries(lock.packages)) {
  if (info.engines?.node && !satisfies(minimum, info.engines.node))
    throw Error(`${name} requires ${info.engines.node}; minimum is ${minimum}`);
}
console.log(`Node ${process.versions.node}; locked dependencies support minimum ${minimum}`);
