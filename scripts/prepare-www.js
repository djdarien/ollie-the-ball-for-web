import { cpSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const www = join(root, "www");
if (existsSync(www)) rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

const items = ["index.html", "manifest.json", "css", "js", "vendor", "assets", "icons"];
for (const item of items) {
  cpSync(join(root, item), join(www, item), { recursive: true });
}
console.log("Prepared", www);
