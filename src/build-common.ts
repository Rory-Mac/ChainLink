/**
 * build-common.ts
 *
 * Shared data-generation logic used by both:
 *   - build-static.ts (builds docs/ for GitHub Pages)
 *   - viewer/server.ts (runs the local dev server)
 *
 * Everything that produces the nodes.json / pair-index.json / search-data.js
 * / graph-analysis files lives here so the two entry points can't drift.
 */

import * as fs from "fs";
import * as path from "path";
import Graph from "graphology";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";
import pagerank from "graphology-metrics/centrality/pagerank";
import louvain from "graphology-communities-louvain";

// ── Types ────────────────────────────────────────────────────────────
export interface RawNode {
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

// ── Helpers ──────────────────────────────────────────────────────────
export function unslugify(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Data collection ──────────────────────────────────────────────────
export function loadAllNodes(outputDir: string): RawNode[] {
  const seenIds = new Set<string>();
  const nodes: RawNode[] = [];
  if (!fs.existsSync(outputDir)) return nodes;
  for (const countryDir of fs.readdirSync(outputDir).sort()) {
    const countryPath = path.join(outputDir, countryDir);
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

export function deriveSearchData(outputDir: string): { countries: string[]; resources: string[] } {
  const countries: string[] = [];
  const resourceSet = new Set<string>();
  if (!fs.existsSync(outputDir)) return { countries, resources: [] };
  for (const dir of fs.readdirSync(outputDir).sort()) {
    const dirPath = path.join(outputDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const jsonFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
    if (jsonFiles.length === 0) continue;
    countries.push(unslugify(dir));
    for (const f of jsonFiles) {
      try {
        const nodes = JSON.parse(
          fs.readFileSync(path.join(dirPath, f), "utf-8")
        ) as Array<{ resources?: string[] }>;
        for (const node of nodes) {
          if (!node.resources) continue;
          for (const resource of node.resources) resourceSet.add(resource);
        }
      } catch { /* skip malformed */ }
    }
  }
  return { countries, resources: [...resourceSet].sort() };
}

export function buildPairIndex(outputDir: string): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  if (!fs.existsSync(outputDir)) return index;
  for (const countryDir of fs.readdirSync(outputDir).sort()) {
    const countryPath = path.join(outputDir, countryDir);
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
export function buildGraph(nodes: RawNode[]): Graph {
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
      const w = edge.quantity || 1;
      if (edge.corridor_id && nodeMap.has(edge.corridor_id) && n.id !== edge.corridor_id) {
        graph.mergeEdge(n.id, edge.corridor_id, {
          weight: w,
          resource: edge.resource,
        });
      }
      const srcId =
        edge.corridor_id && nodeMap.has(edge.corridor_id)
          ? edge.corridor_id
          : n.id;
      if (nodeMap.has(edge.target_id) && srcId !== edge.target_id) {
        graph.mergeEdge(srcId, edge.target_id, {
          weight: w,
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

// ── Full data generation ─────────────────────────────────────────────
export interface GenerateDataOptions {
  outputDir: string;      // src/output/by-country
  dataDir: string;        // where nodes.json, pair-index.json, *.json analysis files go
  searchDataJsPath: string; // where search-data.js goes
  logPrefix?: string;     // prefix for console.log lines (e.g. "  ")
}

export function generateData(opts: GenerateDataOptions) {
  const p = opts.logPrefix ?? "";
  ensureDir(opts.dataDir);

  // Nodes
  const nodes = loadAllNodes(opts.outputDir);
  fs.writeFileSync(path.join(opts.dataDir, "nodes.json"), JSON.stringify(nodes));
  console.log(`${p}Loaded ${nodes.length} unique nodes`);

  // Search data
  const searchData = deriveSearchData(opts.outputDir);
  const searchDataJs = `window.__SEARCH_DATA__ = ${JSON.stringify(searchData)};`;
  fs.writeFileSync(opts.searchDataJsPath, searchDataJs);
  console.log(`${p}Search data: ${searchData.countries.length} countries, ${searchData.resources.length} resources`);

  // Pair index
  const pairIndex = buildPairIndex(opts.outputDir);
  fs.writeFileSync(path.join(opts.dataDir, "pair-index.json"), JSON.stringify(pairIndex));
  console.log(`${p}Pair index: ${Object.keys(pairIndex).length} country-resource pairs`);

  if (nodes.length === 0) return;

  // Graph analysis
  console.log(`${p}Computing graph analysis...`);
  const graph = buildGraph(nodes);
  console.log(`${p}  Graph: ${graph.order} nodes, ${graph.size} edges`);

  const betweennessResults = Object.entries(betweennessCentrality(graph, { normalized: true }))
    .map(([id, score]) => ({ ...graphNodeAttrs(graph, id), score: score as number }))
    .sort((a, b) => b.score - a.score);
  fs.writeFileSync(path.join(opts.dataDir, "betweenness.json"), JSON.stringify(betweennessResults));
  console.log(`${p}  Betweenness: ${betweennessResults.length} entries`);

  try {
    const pagerankResults = Object.entries(pagerank(graph, { alpha: 0.85, maxIterations: 1000, tolerance: 1e-4, getEdgeWeight: "weight" }))
      .map(([id, score]) => ({ ...graphNodeAttrs(graph, id), score: score as number }))
      .sort((a, b) => b.score - a.score);
    fs.writeFileSync(path.join(opts.dataDir, "pagerank.json"), JSON.stringify(pagerankResults));
    console.log(`${p}  PageRank: ${pagerankResults.length} entries`);
  } catch (e: any) {
    console.warn(`${p}  PageRank: skipped (${e.message})`);
    fs.writeFileSync(path.join(opts.dataDir, "pagerank.json"), "[]");
  }

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
  fs.writeFileSync(path.join(opts.dataDir, "louvain.json"), JSON.stringify(louvainResults));
  console.log(`${p}  Louvain: ${louvainResults.length} communities`);

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
  fs.writeFileSync(path.join(opts.dataDir, "degree.json"), JSON.stringify(degreeResults));
  console.log(`${p}  Degree: ${degreeResults.length} entries`);
}
