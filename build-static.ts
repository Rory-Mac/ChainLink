/**
 * build-static.ts
 *
 * Builds the GitHub Pages site into ./docs/ by:
 *   1. Copying viewer/ static assets (index.html, app.js, styles.css)
 *   2. Generating data/ JSON files (nodes, pair-index, graph analysis)
 *   3. Generating search-data.js
 *
 * The viewer/ directory is the single source of truth for all frontend
 * files — this script never duplicates logic that lives there.
 *
 * Usage:  npm run build:static
 */

import * as fs from "fs";
import * as path from "path";
import Graph from "graphology";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";
import pagerank from "graphology-metrics/centrality/pagerank";
import louvain from "graphology-communities-louvain";

// ── Paths ────────────────────────────────────────────────────────────
const OUTPUT_DIR = path.join(__dirname, "src/output/by-country");
const VIEWER_DIR = path.join(__dirname, "viewer");
const DOCS_DIR = path.join(__dirname, "docs");
const DATA_DIR = path.join(DOCS_DIR, "data");

// ── Helpers ──────────────────────────────────────────────────────────
function unslugify(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Node types ───────────────────────────────────────────────────────
interface RawNode {
  id: string;
  name?: string;
  tier?: string;
  country_iso2?: string;
  canonical_company?: string;
  coordinates?: { lat: number; lon: number };
  downstream?: Array<{
    target_id: string;
    corridor_id?: string;
    resource?: string;
    quantity?: number;
    metric?: string;
  }>;
  resources?: string[];
  mode?: string;
  range?: string;
}

// ── Data collection ──────────────────────────────────────────────────
function loadAllNodes(): RawNode[] {
  const seenIds = new Set<string>();
  const nodes: RawNode[] = [];
  if (!fs.existsSync(OUTPUT_DIR)) return nodes;
  for (const countryDir of fs.readdirSync(OUTPUT_DIR).sort()) {
    const countryPath = path.join(OUTPUT_DIR, countryDir);
    if (!fs.statSync(countryPath).isDirectory()) continue;
    for (const file of fs.readdirSync(countryPath)) {
      if (!file.endsWith(".json")) continue;
      try {
        const arr = JSON.parse(
          fs.readFileSync(path.join(countryPath, file), "utf-8")
        ) as RawNode[];
        for (const node of arr) {
          if (!node.id || seenIds.has(node.id)) continue;
          seenIds.add(node.id);
          nodes.push(node);
        }
      } catch { /* skip malformed */ }
    }
  }
  return nodes;
}

function deriveSearchData(): { countries: string[]; resources: string[] } {
  const countries: string[] = [];
  const resourceSet = new Set<string>();
  if (!fs.existsSync(OUTPUT_DIR)) return { countries, resources: [] };
  for (const dir of fs.readdirSync(OUTPUT_DIR).sort()) {
    const dirPath = path.join(OUTPUT_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const jsonFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
    if (jsonFiles.length === 0) continue;
    countries.push(unslugify(dir));
    for (const f of jsonFiles) {
      resourceSet.add(unslugify(f.replace(/\.json$/, "")));
    }
  }
  return { countries, resources: [...resourceSet].sort() };
}

function buildPairIndex(): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  if (!fs.existsSync(OUTPUT_DIR)) return index;
  for (const countryDir of fs.readdirSync(OUTPUT_DIR).sort()) {
    const countryPath = path.join(OUTPUT_DIR, countryDir);
    if (!fs.statSync(countryPath).isDirectory()) continue;
    const country = unslugify(countryDir);
    for (const file of fs.readdirSync(countryPath)) {
      if (!file.endsWith(".json")) continue;
      try {
        const nodes = JSON.parse(
          fs.readFileSync(path.join(countryPath, file), "utf-8")
        ) as Array<{ id?: string; resources?: string[] }>;
        for (const node of nodes) {
          if (!node.id || !node.resources) continue;
          for (const resource of node.resources) {
            const key = `${country}|||${resource}`;
            if (!index[key]) index[key] = [];
            if (!index[key].includes(node.id)) index[key].push(node.id);
          }
        }
      } catch { /* skip */ }
    }
  }
  return index;
}

// ── Graph analysis ───────────────────────────────────────────────────
function buildGraph(nodes: RawNode[]): Graph {
  const graph = new Graph({ type: "directed", allowSelfLoops: false });
  const nodeMap = new Map<string, RawNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  for (const n of nodes) {
    graph.mergeNode(n.id, {
      name: n.name ?? n.id,
      tier: n.tier,
      country: n.country_iso2,
      company: n.canonical_company,
    });
  }

  for (const n of nodes) {
    if (!n.downstream) continue;
    for (const edge of n.downstream) {
      if (edge.corridor_id && nodeMap.has(edge.corridor_id) && n.id !== edge.corridor_id) {
        graph.mergeEdge(n.id, edge.corridor_id, {
          weight: edge.quantity ?? 1,
          resource: edge.resource,
        });
      }
      const srcId =
        edge.corridor_id && nodeMap.has(edge.corridor_id)
          ? edge.corridor_id
          : n.id;
      if (nodeMap.has(edge.target_id) && srcId !== edge.target_id) {
        graph.mergeEdge(srcId, edge.target_id, {
          weight: edge.quantity ?? 1,
          resource: edge.resource,
        });
      }
    }
  }
  return graph;
}

function graphNodeAttrs(graph: Graph, id: string) {
  return {
    id,
    name: graph.getNodeAttribute(id, "name"),
    tier: graph.getNodeAttribute(id, "tier"),
    country: graph.getNodeAttribute(id, "country"),
    company: graph.getNodeAttribute(id, "company"),
  };
}

// ── Main ─────────────────────────────────────────────────────────────
function main() {
  console.log("Building static site into docs/ ...");

  ensureDir(DOCS_DIR);
  ensureDir(DATA_DIR);

  // ── 1. Copy viewer static assets ──────────────────────────────────
  const STATIC_FILES = ["index.html", "app.js", "styles.css"];
  for (const file of STATIC_FILES) {
    fs.copyFileSync(path.join(VIEWER_DIR, file), path.join(DOCS_DIR, file));
  }
  console.log(`  Copied ${STATIC_FILES.join(", ")} from viewer/`);

  // ── 2. Generate data files ────────────────────────────────────────
  const nodes = loadAllNodes();
  console.log(`  Loaded ${nodes.length} unique nodes`);
  fs.writeFileSync(path.join(DATA_DIR, "nodes.json"), JSON.stringify(nodes));

  // Search data
  const searchData = deriveSearchData();
  const searchDataJs = `window.__SEARCH_DATA__ = ${JSON.stringify(searchData)};`;
  fs.writeFileSync(path.join(DOCS_DIR, "search-data.js"), searchDataJs);
  console.log(`  Search data: ${searchData.countries.length} countries, ${searchData.resources.length} resources`);

  // Pair index
  const pairIndex = buildPairIndex();
  fs.writeFileSync(path.join(DATA_DIR, "pair-index.json"), JSON.stringify(pairIndex));
  console.log(`  Pair index: ${Object.keys(pairIndex).length} country-resource pairs`);

  // Graph analysis
  if (nodes.length > 0) {
    console.log("  Computing graph analysis...");
    const graph = buildGraph(nodes);
    console.log(`    Graph: ${graph.order} nodes, ${graph.size} edges`);

    // Betweenness
    const betweennessResults = Object.entries(betweennessCentrality(graph, { normalized: true }))
      .map(([id, score]) => ({ ...graphNodeAttrs(graph, id), score: score as number }))
      .sort((a, b) => b.score - a.score);
    fs.writeFileSync(path.join(DATA_DIR, "betweenness.json"), JSON.stringify(betweennessResults));
    console.log(`    Betweenness: ${betweennessResults.length} entries`);

    // PageRank
    try {
      const pagerankResults = Object.entries(pagerank(graph, { alpha: 0.85, maxIterations: 1000, tolerance: 1e-4, getEdgeWeight: "weight" }))
        .map(([id, score]) => ({ ...graphNodeAttrs(graph, id), score: score as number }))
        .sort((a, b) => b.score - a.score);
      fs.writeFileSync(path.join(DATA_DIR, "pagerank.json"), JSON.stringify(pagerankResults));
      console.log(`    PageRank: ${pagerankResults.length} entries`);
    } catch (e: any) {
      console.warn(`    PageRank: skipped (${e.message})`);
      fs.writeFileSync(path.join(DATA_DIR, "pagerank.json"), "[]");
    }

    // Louvain
    const undirected = new Graph({ type: "undirected", allowSelfLoops: false });
    graph.forEachNode((id, attrs) => undirected.mergeNode(id, attrs));
    graph.forEachEdge((_edge, attrs, source, target) => {
      undirected.mergeEdge(source, target, { weight: attrs.weight ?? 1 });
    });
    const communities = louvain(undirected, { resolution: 1 });
    const groups = new Map<number, Array<{ id: string; name: string; tier: string; country: string; company: string }>>();
    for (const [id, community] of Object.entries(communities)) {
      const c = community as number;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(graphNodeAttrs(graph, id) as any);
    }
    const louvainResults = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([community, members]) => ({ community, size: members.length, members }));
    fs.writeFileSync(path.join(DATA_DIR, "louvain.json"), JSON.stringify(louvainResults));
    console.log(`    Louvain: ${louvainResults.length} communities`);

    // Degree
    const degreeResults: Array<any> = [];
    graph.forEachNode((id) => {
      const inDeg = graph.inDegree(id);
      const outDeg = graph.outDegree(id);
      degreeResults.push({
        ...graphNodeAttrs(graph, id),
        score: inDeg + outDeg,
        inDegree: inDeg,
        outDegree: outDeg,
      });
    });
    degreeResults.sort((a, b) => b.score - a.score);
    fs.writeFileSync(path.join(DATA_DIR, "degree.json"), JSON.stringify(degreeResults));
    console.log(`    Degree: ${degreeResults.length} entries`);
  }

  console.log("\nDone! Static site is in docs/");
  console.log("Enable GitHub Pages → Source: main branch, /docs folder.");
}

main();
