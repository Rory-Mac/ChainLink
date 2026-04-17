/**
 * build-static.ts
 *
 * Builds the GitHub Pages site into ./docs/ by:
 *   1. Copying viewer/ static assets (index.html, app.js, styles.css)
 *   2. Generating data/ JSON files (nodes, pair-index, graph analysis)
 *   3. Generating search-data.js
 *
 * Data-generation logic lives in src/build-common.ts and is shared with
 * viewer/server.ts so the two entry points cannot drift.
 *
 * Usage:  npm run build:static
 */

import * as fs from "fs";
import * as path from "path";
import { ensureDir, generateData } from "./src/build-common";

const OUTPUT_DIR = path.join(__dirname, "src/output/by-country");
const VIEWER_DIR = path.join(__dirname, "viewer");
const DOCS_DIR = path.join(__dirname, "docs");
const DATA_DIR = path.join(DOCS_DIR, "data");

function main() {
  console.log("Building static site into docs/ ...");

  ensureDir(DOCS_DIR);
  ensureDir(DATA_DIR);

  const STATIC_FILES = ["index.html", "app.js", "styles.css"];
  for (const file of STATIC_FILES) {
    fs.copyFileSync(path.join(VIEWER_DIR, file), path.join(DOCS_DIR, file));
  }
  console.log(`  Copied ${STATIC_FILES.join(", ")} from viewer/`);

  generateData({
    outputDir: OUTPUT_DIR,
    dataDir: DATA_DIR,
    searchDataJsPath: path.join(DOCS_DIR, "search-data.js"),
    logPrefix: "  ",
  });

  console.log("\nDone! Static site is in docs/");
  console.log("Enable GitHub Pages → Source: main branch, /docs folder.");
}

main();
