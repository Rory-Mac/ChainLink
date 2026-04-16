# ChainLink — Global Resource Supply Chain Intelligence

ChainLink maps the world's natural resource supply chains as a navigable graph. For every country-resource pair, agentic AI discovers the significant extraction sites in that country and traces the flow of that resource through processing, manufacturing, and distribution to its end consumers. The result is a unified, deduplicated graph of nodes and directed edges that can be explored interactively on a 3D globe.

## What it does

1. **Orchestrates AI research at scale.** For each combination of ~195 countries x 89 resources (spanning 18 categories from petroleum to rare earths to atmospheric gases), a Claude agent is dispatched to research the real supply chain and return it as structured JSON.

2. **Builds a global supply chain graph.** Each API response is a set of graph nodes — extraction sites, refineries, manufacturers, transport corridors, OEMs — connected by directed edges that describe what moves between them, in what quantity, and via which transport corridor.

3. **Deduplicates across runs.** Nodes that appear in multiple country-resource responses (e.g. a Chinese lithium refinery that processes Australian, Chilean, and Zimbabwean ore) are deduplicated by stable ID. Their `resources` field is merged so each node carries a complete record of every resource it is associated with. Upstream references are unioned across runs.

4. **Models transport infrastructure.** Transport corridors (rail lines, shipping routes, pipelines, etc.) are first-class nodes in the graph, referenced by `corridor_id` on edges. A single corridor shared by many upstream entities is described exactly once.

5. **Renders on an interactive globe.** A local viewer serves the merged graph on a Cesium.js globe with search, click-to-inspect, and edge highlighting.

6. **Provides graph analysis.** The viewer server exposes endpoints for betweenness centrality, PageRank, Louvain community detection, and degree analysis via graphology.

## Project structure

```
src/
  orchestrate.ts       — CLI orchestrator: iterates country-resource pairs, calls Claude, deduplicates, writes output
  prompts.ts           — System + user prompts for each country-resource pair (system prompt is cached via Anthropic prompt caching)
  resources.ts         — Full resource taxonomy: 18 categories, 89 resources, each with site type, metric, and tier definitions
  countries.ts         — List of ~195 countries to cover
  output/
    by-country/        — One JSON file per country-resource pair (e.g. australia/lithium-hard-rock.json)
                         Plus .raw.txt debug files containing the raw Claude response
    progress.json      — Checkpoint file — safe to Ctrl-C and resume
    report.txt         — Run summary written after each orchestration run

viewer/
  server.ts            — Express server: merges and serves all output nodes via /api/nodes, plus graph analysis endpoints
  index.html           — Cesium.js globe viewer with search, click-to-inspect, and edge highlighting
  search-data.js       — Auto-generated at server start from the output files on disk
```

## Resource taxonomy

Resources are organised into 18 categories, each with a defined set of supply chain tiers:

| Category | Example resources | Example tiers |
|---|---|---|
| Non-renewable energy | Petroleum, Coal, Uranium, Thorium | extraction → refinery → distributor → utility |
| Renewable energy | Wind, Solar, Hydropower, Tidal | generation → transmission → distribution → retailer |
| Ferrous metals | Iron Ore, Chromium, Manganese | extraction → smelter/refiner → fabricator → manufacturer |
| Non-ferrous metals | Copper, Aluminum, Zinc, Lead, Tin | extraction → smelter/refiner → fabricator → manufacturer |
| Precious metals | Gold, Silver, Platinum Group | extraction → refiner → fabricator → retailer/exchange |
| Strategic metals | Lithium, Cobalt, Tungsten, Tantalum | extraction → chemical processor → component maker → OEM |
| Rare earth elements | Neodymium, Dysprosium, Cerium, Lanthanum | extraction → separation plant → alloy producer → OEM |
| Industrial minerals | Phosphate Rock, Potash, Fluorite, Sulfur, Barite | extraction → processor → manufacturer → distributor |
| Construction minerals | Sand, Gravel, Limestone, Granite, Clay, Marble | extraction → processor → manufacturer → distributor |
| Special minerals | Graphite, Mica, Talc, Feldspar, Quartz, Gypsum | extraction → processor → manufacturer → distributor |
| Agriculture | Grain, Oil Crops, Fiber Crops, Medicinal Plants | grower → elevator/handler → processor → brand packer → retailer |
| Forestry & plants | Timber, Pulpwood, Natural Rubber, Resin | harvester → processor → manufacturer → distributor |
| Animal resources | Fish (wild/farmed), Shellfish, Livestock | harvester → processor → packer → distributor → retailer |
| Water | Surface Water, Groundwater, Desalinated | source capture → treatment → transmission → distribution |
| Soil & land | Peat, Topsoil | extraction → processor → distributor → retailer |
| Marine (seawater) | Salt, Bromine, Magnesium (seawater) | extraction → processor → manufacturer → distributor |
| Marine (seabed) | Manganese Nodules, Cobalt Crusts, Polymetallic Sulfides | extraction → processor → refiner → manufacturer |
| Atmospheric gases | Nitrogen, Oxygen, Noble Gases, CO2 | separation/capture → purifier/liquefier → distributor → point of use |

## Node schema

The graph contains two kinds of nodes: **entity nodes** and **transport nodes**.

### Entity node

```json
{
  "id": "AU_tianqi_lithium",
  "name": "Kwinana Lithium Hydroxide Refinery",
  "tier": "chemical_processor",
  "country_iso2": "AU",
  "canonical_company": "Tianqi Lithium",
  "resources": ["Lithium (hard-rock)"],
  "upstream": ["AU_greenbushes_mine"],
  "coordinates": { "lat": -32.234, "lon": 115.770 },
  "downstream": [
    {
      "target_id": "KR_lg_energy_solution",
      "corridor_id": "INTL_ocean_fremantle-busan",
      "resource": "Battery-grade lithium hydroxide monohydrate",
      "quantity": 24000,
      "metric": "t"
    }
  ]
}
```

### Transport node

```json
{
  "id": "INTL_ocean_fremantle-busan",
  "tier": "transport",
  "name": "Fremantle → Busan ocean freight",
  "country_iso2": "INTL",
  "operator_id": "INTL_maersk",
  "mode": "ocean_freight",
  "form": "containerised",
  "range": "international",
  "coordinates": { "lat": -10.0, "lon": 110.0 }
}
```

Transport nodes have no `downstream` field — they are referenced only via `corridor_id` on entity node edges.

End consumers are not stored as nodes. They are referenced only by a `target_id` slug following the convention `{country_iso2}_{consumerSector}` (e.g. `CN_industrial`, `US_residential`).

## Getting started

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com)

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### Running the orchestrator

```bash
# Run all country-resource pairs
npm run orchestrate

# Filter to specific countries or resources
npx ts-node src/orchestrate.ts --country Australia --country Canada
npx ts-node src/orchestrate.ts --resource Copper --resource "Lithium (hard-rock)"

# Dry run (no API calls)
npm run orchestrate:dry

# Print the full prompt for a specific pair (implies dry run)
npx ts-node src/orchestrate.ts --print-prompt --country Australia --resource "Lithium (hard-rock)"

# Control concurrency (default: 5 simultaneous calls)
npx ts-node src/orchestrate.ts --concurrency 3
```

The orchestrator checkpoints progress to `src/output/progress.json` after each completed pair. Interrupt and resume at any time.

### Running the viewer

```bash
npm run viewer
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Controls:**
- Search for countries or resources using the search bar
- Click a node to open the detail panel and highlight its downstream edges
- Click an edge card in the panel to jump to that downstream node
- Click the globe background to dismiss the panel

### Graph analysis API

The viewer server exposes analysis endpoints powered by graphology:

| Endpoint | Description |
|---|---|
| `GET /api/nodes` | All deduplicated nodes in the graph |
| `GET /api/pair-ids?country=X&resource=Y` | Node IDs for a specific country-resource pair |
| `GET /api/analysis/betweenness` | Betweenness centrality (identifies supply chain chokepoints) |
| `GET /api/analysis/pagerank` | PageRank (identifies most important nodes by link structure) |
| `GET /api/analysis/louvain` | Louvain community detection (identifies supply chain clusters) |
| `GET /api/analysis/degree` | Degree centrality with in/out breakdown |

## Future directions

- Military and strategic infrastructure overlay
- Finance and commodity trading network mapping
- Time-series tracking of supply chain changes
- Conflict and disruption risk scoring per edge
