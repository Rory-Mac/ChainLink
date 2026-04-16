#!/usr/bin/env ts-node
import "dotenv/config";
/**
 * orchestrate.ts — StratCom2 Resource Extraction Orchestrator
 *
 * For every (country, resource) pair, dispatches a single Claude agent that
 * discovers extraction sites and builds the full supply chain graph in one
 * pass, writing results to per-country JSON files.
 *
 * Output layout
 * ─────────────
 *   output/by-country/<country-slug>.json   — one file per country
 *   output/progress.json                    — checkpoint (safe to Ctrl-C and resume)
 *
 * Usage
 * ─────
 *   npx ts-node src/orchestrate.ts
 *   npx ts-node src/orchestrate.ts --country Australia --resource Gold
 *   npx ts-node src/orchestrate.ts --country Australia --country Canada
 *   npx ts-node src/orchestrate.ts --resource Copper --resource Gold
 *   npx ts-node src/orchestrate.ts --dry-run
 *   npx ts-node src/orchestrate.ts --concurrency 3
 *   npx ts-node src/orchestrate.ts --print-prompt --country Australia --resource "Lithium (hard-rock)"
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

import { COUNTRIES } from "./countries";
import { resourceSupplyChains } from "./resources";
import { buildSystemPrompt, buildUserPrompt, buildTreePrompt, DownstreamEdge, QuantityMetric } from "./prompts";

// ── Flatten resource taxonomy into a lookup-friendly list ─────────────────────

interface ResourceEntry {
  resource: string;
  resourceSiteType: string;
  metric: QuantityMetric;
  tiers: string[];
}

const ALL_RESOURCES: ResourceEntry[] = Object.values(resourceSupplyChains).flatMap(
  (category) =>
    Object.entries(category.resources).map(([resource, def]) => ({
      resource,
      resourceSiteType: (def as { siteType: string; metric: QuantityMetric }).siteType,
      metric: (def as { siteType: string; metric: QuantityMetric }).metric,
      tiers: category.tiers as unknown as string[],
    }))
);

// ── Configuration ──────────────────────────────────────────────────────────────

const MODEL = "claude-opus-4-6";
const DEFAULT_CONCURRENCY = 5;
const MAX_RETRIES = 3;
const BASE_RETRY_MS = 2_000;

const OUTPUT_DIR = path.join(__dirname, "output");
const BY_COUNTRY_DIR = path.join(OUTPUT_DIR, "by-country");
const PROGRESS_FILE = path.join(OUTPUT_DIR, "progress.json");

// ── Types ──────────────────────────────────────────────────────────────────────

interface PairResult {
  country: string;
  resource: string;
  ok: boolean;
  newNodes: number;
  merged: number;
  error?: string;
}

interface RunStats {
  completed: number;
  errors: number;
  results: PairResult[];
}

// ── CLI arguments ──────────────────────────────────────────────────────────────

interface CliArgs {
  countries: string[];
  resources: string[];
  concurrency: number;
  dryRun: boolean;
  printPrompt: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const countries: string[] = [];
  const resources: string[] = [];
  let concurrency = DEFAULT_CONCURRENCY;
  let dryRun = false;
  let printPrompt = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--print-prompt":
        printPrompt = true;
        dryRun = true; // implies dry-run — no API call is made
        break;
      case "--country":
        if (argv[i + 1]) countries.push(argv[++i]);
        break;
      case "--resource":
        if (argv[i + 1]) resources.push(argv[++i]);
        break;
      case "--concurrency":
        if (argv[i + 1]) concurrency = Math.max(1, parseInt(argv[++i], 10));
        break;
      case "--dry-run":
        dryRun = true;
        break;
    }
  }

  return { countries, resources, concurrency, dryRun, printPrompt };
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pairKey(country: string, resource: string): string {
  return `${country}|${resource}`;
}

/**
 * Robustly extract a JSON value from a Claude response that may contain
 * markdown fences, prose preamble, or other surrounding text.
 *
 * Strategy:
 *  1. Pull text out of a markdown fence (closed or unclosed).
 *  2. Try the full trimmed response.
 *  3. Scan every '{' / '[' start position and find the longest valid JSON
 *     substring across all of them.
 */
function extractJson<T>(text: string): T {
  // 1. Markdown fence — tolerate both closed (```) and unclosed fences.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // fall through to broader search
    }
  }

  // 2. Full trimmed text.
  try {
    return JSON.parse(text.trim()) as T;
  } catch {
    // fall through
  }

  // 3. Longest valid JSON substring starting at any '{' or '['.
  let bestResult: T | undefined;
  let bestLength = -1;

  for (let start = 0; start < text.length; start++) {
    const ch = text[start];
    if (ch !== "{" && ch !== "[") continue;
    if (text.length - start <= bestLength) break; // can't beat current best

    for (let end = text.length; end > start; end--) {
      if (end - start <= bestLength) break; // already have a longer result
      try {
        const parsed = JSON.parse(text.slice(start, end)) as T;
        bestResult = parsed;
        bestLength = end - start;
        break; // longest from this start found; try next start
      } catch {
        // shrink end and retry
      }
    }
  }

  if (bestLength > -1) return bestResult!;

  throw new Error(
    `Cannot extract JSON from Claude response:\n${text.slice(0, 400)}`
  );
}

// ── Progress / checkpoint ──────────────────────────────────────────────────────

function loadProgress(): Set<string> {
  if (!fs.existsSync(PROGRESS_FILE)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8")) as {
      completed?: string[];
    };
    return new Set(raw.completed ?? []);
  } catch {
    console.warn("Warning: progress file corrupted — starting fresh.");
    return new Set();
  }
}

function saveProgress(completed: Set<string>): void {
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify({ completed: [...completed] }, null, 2)
  );
}

// ── Per-pair output files ─────────────────────────────────────────────────────

function savePairResult(country: string, resource: string, newNodes: object[]): void {
  const dir = path.join(BY_COUNTRY_DIR, slugify(country));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slugify(resource)}.json`);

  // Append to any existing nodes (dedup may have already updated them in-place)
  let existing: object[] = [];
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf-8")) as object[];
    } catch {
      // overwrite if unreadable
    }
  }
  fs.writeFileSync(file, JSON.stringify([...existing, ...newNodes], null, 2));
}

// ── Node type ─────────────────────────────────────────────────────────────────

interface GraphNode {
  id?: string;
  tier?: string;
  resources?: string[];
  upstream?: string[];
  downstream?: DownstreamEdge[];
  [key: string]: unknown;
}

/** Transport nodes are identified by tier === "transport" and have no downstream. */
function isTransportNode(node: GraphNode): boolean {
  return node.tier === "transport";
}

// ── Upstream derivation ───────────────────────────────────────────────────────

/**
 * For every node in the graph, derive its `upstream` field as the set of node
 * ids that list it as a downstream target. Only ids present in the graph are
 * included (end-consumer slug references are ignored).
 */
function deriveUpstream(graph: GraphNode[]): void {
  // Only entity nodes participate in upstream derivation — transport nodes
  // are referenced via corridor_id on edges, not via target_id, so they
  // never appear as downstream targets and need no upstream field.
  const entityIds = new Set(
    graph.filter((n) => !isTransportNode(n)).map((n) => n.id).filter(Boolean)
  );
  const upstreamMap = new Map<string, Set<string>>();
  for (const node of graph) {
    if (isTransportNode(node) || !node.id || !node.downstream) continue;
    for (const edge of node.downstream) {
      const targetId = edge.target_id;
      if (!entityIds.has(targetId)) continue; // skip consumer slugs
      if (!upstreamMap.has(targetId)) upstreamMap.set(targetId, new Set());
      upstreamMap.get(targetId)!.add(node.id);
    }
  }
  for (const node of graph) {
    if (isTransportNode(node) || !node.id) continue;
    node.upstream = [...(upstreamMap.get(node.id) ?? [])];
  }
}

// ── Deduplication ─────────────────────────────────────────────────────────────

interface SavedIndex {
  // id → { filePath, index within that file's array }
  byId: Map<string, { filePath: string; arrayIndex: number }>;
  // filePath → mutable node array (shared reference)
  byFile: Map<string, Array<GraphNode>>;
}

/**
 * Load every saved node across all output files into a mutable index.
 */
function loadSavedIndex(): SavedIndex {
  const byId = new Map<string, { filePath: string; arrayIndex: number }>();
  const byFile = new Map<string, Array<GraphNode>>();

  if (!fs.existsSync(BY_COUNTRY_DIR)) return { byId, byFile };

  for (const countryDir of fs.readdirSync(BY_COUNTRY_DIR)) {
    const countryPath = path.join(BY_COUNTRY_DIR, countryDir);
    if (!fs.statSync(countryPath).isDirectory()) continue;
    for (const file of fs.readdirSync(countryPath)) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(countryPath, file);
      try {
        const nodes = JSON.parse(
          fs.readFileSync(filePath, "utf-8")
        ) as Array<GraphNode>;
        byFile.set(filePath, nodes);
        for (let i = 0; i < nodes.length; i++) {
          const id = nodes[i].id;
          if (id) byId.set(id, { filePath, arrayIndex: i });
        }
      } catch {
        // skip unreadable / malformed files
      }
    }
  }
  return { byId, byFile };
}

/**
 * For each node in `graph`:
 *   - Stamp it with `resources: [resource]` (the resource being queried).
 *   - If its id already exists in the saved index, merge resources, upstream
 *     ids, and downstream edges, then drop it from the new batch.
 *   - Otherwise keep it as a new node.
 *
 * After processing, rewrite any files whose nodes were mutated.
 * Returns the filtered new-node array and counts of new vs merged nodes.
 */
function deduplicateAndMerge(
  graph: GraphNode[],
  resource: string,
  index: SavedIndex
): { newNodes: object[]; merged: number } {
  const dirtyFiles = new Set<string>();
  const newNodes: object[] = [];

  for (const node of graph) {
    // Stamp the queried resource on every non-transport node
    if (node.tier !== "transport") {
      node.resources = [resource];
    }

    const existing = node.id ? index.byId.get(node.id) : undefined;
    if (existing) {
      const saved = index.byFile.get(existing.filePath)![existing.arrayIndex];

      // Merge resources
      if (!saved.resources) saved.resources = [];
      if (!saved.resources.includes(resource)) saved.resources.push(resource);

      // Union upstream ids
      const upstreamSet = new Set([...(saved.upstream ?? []), ...(node.upstream ?? [])]);
      saved.upstream = [...upstreamSet];

      // Concatenate downstream edges from the new resource query
      saved.downstream = [...(saved.downstream ?? []), ...(node.downstream ?? [])];

      dirtyFiles.add(existing.filePath);
    } else {
      newNodes.push(node);
    }
  }

  // Rewrite any files that had nodes mutated
  for (const filePath of dirtyFiles) {
    fs.writeFileSync(
      filePath,
      JSON.stringify(index.byFile.get(filePath), null, 2)
    );
  }

  return { newNodes, merged: graph.length - newNodes.length };
}

// ── Semaphore — limits concurrent Claude API calls ────────────────────────────

class Semaphore {
  private count: number;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) {
    this.count = max;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    if (this.queue.length > 0) {
      this.queue.shift()!();
    } else {
      this.count++;
    }
  }
}

// ── Claude API wrapper with streaming + retry ─────────────────────────────────

async function callClaude(
  client: Anthropic,
  systemPrompt: Anthropic.Messages.TextBlockParam[],
  userPrompt: string,
  retries = MAX_RETRIES
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 32768,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      const final = await stream.finalMessage();

      const text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      if (!text) throw new Error("API returned an empty text response");
      return text;
    } catch (err: unknown) {
      if (err instanceof Anthropic.AuthenticationError) throw err;
      if (err instanceof Anthropic.BadRequestError) throw err;

      if (attempt === retries) throw err;

      const delay = BASE_RETRY_MS * Math.pow(2, attempt);
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  [retry ${attempt + 1}/${retries} in ${delay}ms] ${msg}\n`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

// ── Pair processor ─────────────────────────────────────────────────────────────

async function processCountryResourcePair(
  client: Anthropic,
  sem: Semaphore,
  cachedSystemPrompt: Anthropic.Messages.TextBlockParam[],
  country: string,
  entry: ResourceEntry,
  completed: Set<string>,
  stats: RunStats,
  dryRun: boolean,
  printPrompt: boolean
): Promise<void> {
  const { resource, resourceSiteType, metric, tiers } = entry;
  const key = pairKey(country, resource);

  if (printPrompt) {
    const prompt = buildTreePrompt(country, resource, resourceSiteType, metric, tiers);
    process.stdout.write(`\n${"─".repeat(62)}\n`);
    process.stdout.write(`PROMPT — ${country} | ${resource}\n`);
    process.stdout.write(`${"─".repeat(62)}\n`);
    process.stdout.write(prompt + "\n");
    return;
  }

  if (dryRun) {
    process.stdout.write(`  [DRY-RUN] ${country} | ${resource}\n`);
    return;
  }

  if (completed.has(key)) return;

  let graph: object[];
  try {
    const userPrompt = buildUserPrompt(country, resource, resourceSiteType, metric, tiers);
    const text = await sem.run(() => callClaude(client, cachedSystemPrompt, userPrompt));

    // Save raw response for debugging
    const rawDir = path.join(BY_COUNTRY_DIR, slugify(country));
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, `${slugify(resource)}.raw.txt`), text);

    const rawResult = extractJson<GraphNode[] | Record<string, unknown>>(text);
    const rawArray: GraphNode[] = Array.isArray(rawResult)
      ? rawResult
      : (Object.values(rawResult).find(Array.isArray) as GraphNode[] | undefined) ?? [];
    // Filter out any malformed items that lack required node fields
    const raw = rawArray.filter((n) => n && typeof n === "object" && n.id && n.tier);
    deriveUpstream(raw);
    const index = loadSavedIndex();
    const { newNodes, merged } = deduplicateAndMerge(raw, resource, index);
    graph = newNodes;
    process.stdout.write(
      `  ✓  ${country} | ${resource} — ${graph.length} new node(s)` +
      (merged > 0 ? `, ${merged} merged into existing` : "") + "\n"
    );
    stats.completed++;
    stats.results.push({ country, resource, ok: true, newNodes: graph.length, merged });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  ✗  ${country} | ${resource}: ${msg}\n`);
    stats.errors++;
    stats.results.push({ country, resource, ok: false, newNodes: 0, merged: 0, error: msg });
    return;
  }

  savePairResult(country, resource, graph);

  completed.add(key);
  saveProgress(completed);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
    process.exit(1);
  }

  const { countries: filterCountries, resources: filterResources, concurrency, dryRun, printPrompt } =
    parseArgs();

  const client = new Anthropic({ apiKey });
  const sem = new Semaphore(concurrency);
  const completed = loadProgress();

  const countries = filterCountries.length
    ? COUNTRIES.filter((c) => filterCountries.includes(c))
    : COUNTRIES;

  const resources = filterResources.length
    ? ALL_RESOURCES.filter((e) => filterResources.includes(e.resource))
    : ALL_RESOURCES;

  if (filterCountries.length && countries.length === 0) {
    console.error(`No matching countries found for: ${filterCountries.join(", ")}`);
    process.exit(1);
  }
  if (filterResources.length && resources.length === 0) {
    console.error(`No matching resources found for: ${filterResources.join(", ")}`);
    process.exit(1);
  }

  const totalPairs = countries.length * resources.length;
  const alreadyDone = [...completed].filter((k) => {
    const [c, r] = k.split("|");
    return countries.includes(c) && resources.some((e) => e.resource === r);
  }).length;
  const remaining = totalPairs - alreadyDone;

  console.log("━".repeat(62));
  console.log("  StratCom2 Resource Extraction Orchestrator");
  console.log("━".repeat(62));
  console.log(`  Countries   : ${countries.length}`);
  console.log(`  Resources   : ${resources.length}`);
  console.log(`  Total pairs : ${totalPairs.toLocaleString()}`);
  console.log(`  Completed   : ${alreadyDone.toLocaleString()}`);
  console.log(`  Remaining   : ${remaining.toLocaleString()}`);
  console.log(`  Concurrency : ${concurrency}`);
  console.log(`  Model       : ${MODEL}`);
  if (dryRun) console.log("  Mode        : DRY-RUN (no API calls will be made)");
  console.log("━".repeat(62));

  if (remaining === 0 && !dryRun) {
    console.log("  All pairs already completed.");
    return;
  }

  // Build the static system prompt once — marked for prompt caching.
  const cachedSystemPrompt: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: buildSystemPrompt(),
      cache_control: { type: "ephemeral" },
    },
  ];

  const stats: RunStats = { completed: 0, errors: 0, results: [] };

  const tasks: Promise<void>[] = [];
  for (const country of countries) {
    for (const entry of resources) {
      tasks.push(
        processCountryResourcePair(client, sem, cachedSystemPrompt, country, entry, completed, stats, dryRun, printPrompt)
      );
    }
  }

  await Promise.all(tasks);

  // ── Write report.txt ──────────────────────────────────────────────
  if (!dryRun && stats.results.length > 0) {
    const lines: string[] = [];
    for (const r of stats.results) {
      if (r.ok) {
        let line = `  ✓  ${r.country} | ${r.resource} — ${r.newNodes} new node(s)`;
        if (r.merged > 0) line += `, ${r.merged} merged into existing`;
        lines.push(line);
      } else {
        lines.push(`  ✗  ${r.country} | ${r.resource} — error: ${r.error}`);
      }
    }
    fs.writeFileSync(path.join(OUTPUT_DIR, "report.txt"), lines.join("\n") + "\n");
  }

  console.log("━".repeat(62));
  if (!dryRun) {
    console.log("  Run complete");
    console.log(`  Pairs completed : ${stats.completed}`);
    console.log(`  Errors          : ${stats.errors}`);
    console.log(`  Output          : ${OUTPUT_DIR}`);
  }
  console.log("━".repeat(62));
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Fatal error: ${msg}`);
  process.exit(1);
});
