import express from "express";
import * as fs from "fs";
import * as path from "path";
import Graph from "graphology";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";
import pagerank from "graphology-metrics/centrality/pagerank";
import louvain from "graphology-communities-louvain";

const app = express();
const PORT = 3000;

const OUTPUT_DIR = path.join(__dirname, "../src/output/by-country");
const CESIUM_DIR = path.join(__dirname, "../node_modules/cesium/Build/Cesium");

// Derive countries & resources from what actually exists on disk
function unslugify(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function deriveSearchData(): { countries: string[]; resources: string[] } {
  const countries: string[] = [];
  const resourceSet = new Set<string>();
  if (!fs.existsSync(OUTPUT_DIR)) return { countries, resources: [] };
  for (const dir of fs.readdirSync(OUTPUT_DIR).sort()) {
    const dirPath = path.join(OUTPUT_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    // Only include if it has at least one .json file
    const jsonFiles = fs.readdirSync(dirPath).filter(f => f.endsWith(".json"));
    if (jsonFiles.length === 0) continue;
    countries.push(unslugify(dir));
    for (const f of jsonFiles) {
      resourceSet.add(unslugify(f.replace(/\.json$/, "")));
    }
  }
  return { countries, resources: [...resourceSet].sort() };
}

const { countries: derivedCountries, resources: derivedResources } = deriveSearchData();
const searchDataJs = `window.__SEARCH_DATA__ = ${JSON.stringify({
  countries: derivedCountries,
  resources: derivedResources,
})};`;
fs.writeFileSync(path.join(__dirname, "search-data.js"), searchDataJs, "utf-8");

// Serve Cesium static assets at /cesium/
app.use("/cesium", express.static(CESIUM_DIR));

// Return all node ids whose `resources` array contains the queried resource,
// scoped to nodes originating from the queried country's output directory.
// Because deduplication can merge a node into a file from a different resource
// query, we scan every JSON file under the country directory.
app.get("/api/pair-ids", (req, res) => {
  const country  = req.query.country  as string | undefined;
  const resource = req.query.resource as string | undefined;
  if (!country || !resource) { res.status(400).json({ error: "country and resource required" }); return; }

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const countryDir = path.join(OUTPUT_DIR, slugify(country));

  if (!fs.existsSync(countryDir) || !fs.statSync(countryDir).isDirectory()) {
    res.json([]);
    return;
  }

  const ids: string[] = [];
  for (const file of fs.readdirSync(countryDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const nodes = JSON.parse(
        fs.readFileSync(path.join(countryDir, file), "utf-8")
      ) as Array<{ id?: string; resources?: string[] }>;
      for (const node of nodes) {
        if (node.id && node.resources?.includes(resource)) {
          ids.push(node.id);
        }
      }
    } catch {
      // skip malformed files
    }
  }

  res.json(ids);
});

// Return all unique nodes merged from every output JSON file
app.get("/api/nodes", (_req, res) => {
  const seenIds = new Set<string>();
  const nodes: object[] = [];

  if (!fs.existsSync(OUTPUT_DIR)) {
    res.json([]);
    return;
  }

  for (const countryDir of fs.readdirSync(OUTPUT_DIR)) {
    const countryPath = path.join(OUTPUT_DIR, countryDir);
    if (!fs.statSync(countryPath).isDirectory()) continue;

    for (const file of fs.readdirSync(countryPath)) {
      if (!file.endsWith(".json")) continue;
      try {
        const arr = JSON.parse(
          fs.readFileSync(path.join(countryPath, file), "utf-8")
        ) as Array<{ id?: string }>;
        for (const node of arr) {
          if (!node.id || seenIds.has(node.id)) continue;
          seenIds.add(node.id);
          nodes.push(node);
        }
      } catch {
        // skip malformed files
      }
    }
  }

  res.json(nodes);
});

// ── Graph analysis helpers ──────────────────────────────────────────
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

function loadAllNodes(): RawNode[] {
  const seenIds = new Set<string>();
  const nodes: RawNode[] = [];
  if (!fs.existsSync(OUTPUT_DIR)) return nodes;
  for (const countryDir of fs.readdirSync(OUTPUT_DIR)) {
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
      } catch { /* skip */ }
    }
  }
  return nodes;
}

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
      lat: n.coordinates?.lat,
      lon: n.coordinates?.lon,
    });
  }

  for (const n of nodes) {
    if (!n.downstream) continue;
    for (const edge of n.downstream) {
      // entity → corridor (if corridor exists)
      if (edge.corridor_id && nodeMap.has(edge.corridor_id) && n.id !== edge.corridor_id) {
        graph.mergeEdge(n.id, edge.corridor_id, {
          weight: edge.quantity ?? 1,
          resource: edge.resource,
        });
      }
      // corridor → target (or entity → target if no corridor)
      const srcId = edge.corridor_id && nodeMap.has(edge.corridor_id)
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

// Cache for the built graph (invalidated on restart)
let cachedGraph: Graph | null = null;
let cachedNodes: RawNode[] | null = null;

function getGraph(): { graph: Graph; nodes: RawNode[] } {
  if (!cachedGraph) {
    cachedNodes = loadAllNodes();
    cachedGraph = buildGraph(cachedNodes);
  }
  return { graph: cachedGraph, nodes: cachedNodes! };
}

// ── Analysis endpoints ─────────────────────────────────────────────
app.get("/api/analysis/betweenness", (_req, res) => {
  try {
    const { graph } = getGraph();
    const scores = betweennessCentrality(graph, { normalized: true });
    const results = Object.entries(scores)
      .map(([id, score]) => ({
        id,
        score: score as number,
        name: graph.getNodeAttribute(id, "name"),
        tier: graph.getNodeAttribute(id, "tier"),
        country: graph.getNodeAttribute(id, "country"),
        company: graph.getNodeAttribute(id, "company"),
      }))
      .sort((a, b) => b.score - a.score);
    res.json(results);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/analysis/pagerank", (_req, res) => {
  try {
    const { graph } = getGraph();
    const scores = pagerank(graph, { alpha: 0.85, getEdgeWeight: "weight" });
    const results = Object.entries(scores)
      .map(([id, score]) => ({
        id,
        score: score as number,
        name: graph.getNodeAttribute(id, "name"),
        tier: graph.getNodeAttribute(id, "tier"),
        country: graph.getNodeAttribute(id, "country"),
        company: graph.getNodeAttribute(id, "company"),
      }))
      .sort((a, b) => b.score - a.score);
    res.json(results);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/analysis/louvain", (_req, res) => {
  try {
    const { graph } = getGraph();
    // Louvain needs an undirected graph
    const undirected = new Graph({ type: "undirected", allowSelfLoops: false });
    graph.forEachNode((id, attrs) => undirected.mergeNode(id, attrs));
    graph.forEachEdge((_edge, attrs, source, target) => {
      undirected.mergeEdge(source, target, { weight: attrs.weight ?? 1 });
    });
    const communities = louvain(undirected, { resolution: 1 });
    // Group nodes by community
    const groups = new Map<number, Array<{ id: string; name: string; tier: string; country: string; company: string }>>();
    for (const [id, community] of Object.entries(communities)) {
      const c = community as number;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push({
        id,
        name: graph.getNodeAttribute(id, "name"),
        tier: graph.getNodeAttribute(id, "tier"),
        country: graph.getNodeAttribute(id, "country"),
        company: graph.getNodeAttribute(id, "company"),
      });
    }
    // Sort communities by size descending
    const result = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([community, members]) => ({ community, size: members.length, members }));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/analysis/degree", (_req, res) => {
  try {
    const { graph } = getGraph();
    const results: Array<{ id: string; score: number; inDegree: number; outDegree: number; name: string; tier: string; country: string; company: string }> = [];
    graph.forEachNode((id, attrs) => {
      const inDeg = graph.inDegree(id);
      const outDeg = graph.outDegree(id);
      results.push({
        id,
        score: inDeg + outDeg,
        inDegree: inDeg,
        outDegree: outDeg,
        name: attrs.name,
        tier: attrs.tier,
        country: attrs.country,
        company: attrs.company,
      });
    });
    results.sort((a, b) => b.score - a.score);
    res.json(results);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Serve viewer static assets (includes the generated search-data.js)
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`StratCom2 viewer running at http://localhost:${PORT}`);
}).on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Kill the existing process and retry.`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
