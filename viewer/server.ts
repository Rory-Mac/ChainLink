import express from "express";
import * as path from "path";
import { generateData } from "../src/build-common";

const app = express();
const PORT = 3000;

const OUTPUT_DIR = path.join(__dirname, "../src/output/by-country");
const VIEWER_DIR = __dirname;
const DATA_DIR = path.join(VIEWER_DIR, "data");

console.log("Generating viewer/data/ ...");
generateData({
  outputDir: OUTPUT_DIR,
  dataDir: DATA_DIR,
  searchDataJsPath: path.join(VIEWER_DIR, "search-data.js"),
  logPrefix: "  ",
});
console.log("Data generation complete.");

// Serve everything under viewer/ as static files (index.html, app.js,
// styles.css, search-data.js, and the data/ subdirectory)
app.use(express.static(VIEWER_DIR));

app.listen(PORT, () => {
  console.log(`ChainLink viewer running at http://localhost:${PORT}`);
}).on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Kill the existing process and retry.`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
