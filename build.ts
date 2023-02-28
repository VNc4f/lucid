import {build, emptyDir} from "https://deno.land/x/dnt@0.30.0/mod.ts";
import * as esbuild from "https://deno.land/x/esbuild@v0.14.45/mod.js";
import {copySync} from "https://deno.land/std@0.177.0/fs/copy.ts";
import { existsSync } from "https://deno.land/std@0.177.0/fs/mod.ts";
import packageInfo from "./package.json" assert {type: "json"};

await emptyDir("./dist");

//** NPM ES Module for Node.js and Browser */

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./dist",
  test: false,
  scriptModule: false,
  typeCheck: false,
  shims: {},
  package: {
    ...packageInfo,
    engines: {
      node: ">=14",
    },
    dependencies: {
      "node-fetch": "^3.2.3",
      "@peculiar/webcrypto": "^1.4.0",
      "ws": "^8.10.0",
    },
    main: "./esm/mod.js",
    type: "module",
  },
});

Deno.copyFileSync("LICENSE", "dist/LICENSE");
Deno.copyFileSync("README.md", "dist/README.md");

// copy wasm files
// Core
Deno.copyFileSync(
  "src/core/wasm_modules/cardano_multiplatform_lib_nodejs/cardano_multiplatform_lib_bg.wasm",
  "dist/esm/src/core/wasm_modules/cardano_multiplatform_lib_nodejs/cardano_multiplatform_lib_bg.wasm",
);
Deno.writeTextFileSync(
  "dist/esm/src/core/wasm_modules/cardano_multiplatform_lib_nodejs/package.json",
  JSON.stringify({type: "commonjs"}),
);
Deno.copyFileSync(
  "src/core/wasm_modules/cardano_multiplatform_lib_web/cardano_multiplatform_lib_bg.wasm",
  "dist/esm/src/core/wasm_modules/cardano_multiplatform_lib_web/cardano_multiplatform_lib_bg.wasm",
);
// Message
Deno.copyFileSync(
  "src/core/wasm_modules/cardano_message_signing_nodejs/cardano_message_signing_bg.wasm",
  "dist/esm/src/core/wasm_modules/cardano_message_signing_nodejs/cardano_message_signing_bg.wasm",
);
Deno.writeTextFileSync(
  "dist/esm/src/core/wasm_modules/cardano_message_signing_nodejs/package.json",
  JSON.stringify({type: "commonjs"}),
);
Deno.copyFileSync(
  "src/core/wasm_modules/cardano_message_signing_web/cardano_message_signing_bg.wasm",
  "dist/esm/src/core/wasm_modules/cardano_message_signing_web/cardano_message_signing_bg.wasm",
);

//** Web ES Module */

// Core
Deno.mkdirSync("dist/web/wasm_modules/cardano_multiplatform_lib_web", {
  recursive: true,
});

// Message
Deno.mkdirSync("dist/web/wasm_modules/cardano_message_signing_web", {
  recursive: true,
});

await esbuild.build({
  bundle: true,
  format: "esm",
  entryPoints: ["./dist/esm/mod.js"],
  outfile: "./dist/web/mod.js",
  minify: true,
  external: [
    "./wasm_modules/cardano_multiplatform_lib_nodejs/cardano_multiplatform_lib.js",
    "./wasm_modules/cardano_message_signing_nodejs/cardano_message_signing.js",
    "node-fetch",
    "@peculiar/webcrypto",
    "ws",
  ],
});
esbuild.stop();

// copy wasm file
// Core
Deno.copyFileSync(
  "src/core/wasm_modules/cardano_multiplatform_lib_web/cardano_multiplatform_lib_bg.wasm",
  "dist/web/wasm_modules/cardano_multiplatform_lib_web/cardano_multiplatform_lib_bg.wasm",
);
// Message
Deno.copyFileSync(
  "src/core/wasm_modules/cardano_message_signing_web/cardano_message_signing_bg.wasm",
  "dist/web/wasm_modules/cardano_message_signing_web/cardano_message_signing_bg.wasm",
);

if (existsSync("../../spacebudz/nebula-deploy/lucid-cardano/mod.js")) Deno.removeSync("../../spacebudz/nebula-deploy/lucid-cardano/mod.js");
Deno.copyFileSync(
  "dist/web/mod.js",
  "../../spacebudz/nebula-deploy/lucid-cardano/mod.js",
);

Deno.removeSync("../nebula/lucid-cardano", {recursive: true});
copySync("./src", "../nebula/lucid-cardano", {overwrite: true})
Deno.removeSync("../nebula/lucid-cardano/examples", {recursive: true});

// if (existsSync("../nebula/lucid-cardano/mod.ts")) Deno.removeSync("../nebula/lucid-cardano/mod.ts");
// Deno.copyFileSync(
//   "mod.ts",
//   "../nebula/lucid-cardano/mod.ts",
// );

if (existsSync("../nebula/lucid-cardano/package.json")) Deno.removeSync("../nebula/lucid-cardano/package.json");
Deno.copyFileSync(
  "package.json",
  "../nebula/lucid-cardano/package.json",
);