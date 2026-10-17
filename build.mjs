import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
rmSync("www", { recursive: true, force: true });
mkdirSync("www", { recursive: true });
await build({ entryPoints: ["src/app.js"], bundle: true, format: "esm", outfile: "www/app.js", minify: true, target: "es2020" });
cpSync("src/index.html", "www/index.html");
cpSync("src/style.css", "www/style.css");
cpSync("node_modules/spessasynth_lib/dist/spessasynth_processor.min.js", "www/spessasynth_processor.min.js");
console.log("built www/");
