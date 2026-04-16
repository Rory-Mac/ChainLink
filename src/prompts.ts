export const consumerSectors = [
  "residential",
  "commercial",
  "industrial",
  "agricultural",
  "infrastructure",
  "government",
  "institutional",
] as const;

export type ConsumerSector = typeof consumerSectors[number];

export const transportModes = [
  "road",            // truck, tanker truck, flatbed
  "rail",            // freight train, unit train, intermodal
  "inland_waterway", // river barge, canal boat
  "ocean_freight",   // bulk carrier, tanker, container ship
  "pipeline",        // oil, gas, water, slurry, hydrogen, CO₂
  "conveyor",        // belt conveyor, slurry pipeline (short-haul)
  "air_freight",     // cargo aircraft
  "electrical_grid", // transmission & distribution lines
] as const;

const transportModeValues = transportModes.join(" | ");
export type TransportMode = typeof transportModes[number];

export const transportForms = [
  "bulk_dry",       // loose solids — grain, ore, coal, sand
  "bulk_liquid",    // crude, chemicals, water, LNG
  "containerised",  // manufactured goods, packaged food
  "unit_load",      // pallets, bales, timber bundles
  "live",           // livestock, live fish
  "gas",            // piped natural gas, hydrogen, CO₂
  "electrical",     // electrons on the grid
] as const;

const transportFormValues = transportForms.join(" | ");
export type TransportForm = typeof transportForms[number];

export type TransportRange = "local" | "regional" | "international";

// A transport corridor node in the output graph
export type TransportNode = {
  id: string;          // corridor_id, e.g. "AU_rail_pilbara-port-hedland"
  tier: "transport";
  operator_id: string; // e.g. "AU_aurizon"
  mode: TransportMode;
  form: TransportForm;
  range: TransportRange;
  name: string;
  country_iso2: string;
  coordinates: { lat: number; lon: number };
  downstream: DownstreamEdge[];
};

export const quantityMetrics = ["t", "kL", "MWh"] as const;
export type QuantityMetric = typeof quantityMetrics[number];
const quantityMetricValues = quantityMetrics.join(" | ");

// An edge from any node to a downstream node, via a named transport corridor
export type DownstreamEdge = {
  target_id: string;
  corridor_id: string;  // references a transport node's id
  resource: string;      // the resource carried along this edge
  quantity: number;      // annual volume delivered along this edge
  metric: QuantityMetric; // unit: "t" | "kL" | "MWh"
};

/**
 * Static system prompt — identical across every (country, resource) pair.
 * Designed to be cached via Anthropic prompt caching.
 */
export function buildSystemPrompt(): string {
  return `You are an expert analyst of global resource supply chains. You will be
given a COUNTRY, a RESOURCE, a RESOURCE_SITE_TYPE (the kind of extraction site),
and an ordered list of TIERS describing the supply chain from extraction to end
consumer. Your task is to research every significant extraction site for that
resource in that country, then produce a structured JSON graph of the supply
chain flowing from each site through the tiers to end consumers.

OUTPUT FORMAT

Return ONLY a JSON array of node objects. No markdown fences, no preamble, no
commentary before or after the JSON. The output must parse directly with
json.loads() or JSON.parse().

If the country has no significant extraction of the resource, return an empty
array: [].

The array contains two kinds of nodes: supply chain entity nodes and transport
corridor nodes (see TRANSPORT CORRIDORS). Each node appears EXACTLY ONCE.
Edges are encoded on the source node's "downstream" array. The array as a
whole forms a directed acyclic graph traversable from any extraction site root
to its end consumers.

ENTITY NODE SCHEMA

Supply chain entity nodes use this schema:

{
  "id": "<string — see NODE ID CONVENTION>",
  "name": "<string, human-readable display name>",
  "tier": "<string, one of the TIERS provided in the user message>",
  "country_iso2": "<string, ISO-3166-1 alpha-2, or 'INTL'>",
  "canonical_company": "<string | null>",
  "coordinates": { "lat": "<number>", "lon": "<number>" },
  "downstream": [
    {
      "target_id": "<string, id of downstream entity node or end-consumer slug>",
      "corridor_id": "<string, id of the transport node used for this leg>",
      "resource": "<string, the material or product actually carried along this edge (e.g. 'rare earth concentrate containing neodymium', 'lithium hydroxide', 'battery cells')>",
      "quantity": "<number, estimated annual volume delivered along this edge>",
      "metric": "<string, unit for quantity — one of: ${quantityMetricValues}>"
    }
  ]
}

EDGE QUANTITIES

Every downstream edge MUST include "quantity" (a positive number) and "metric"
(the value specified in the user message). Use the METRIC provided — do not
substitute a different unit. Base quantity estimates on the most recent publicly
available annual production and trade data. Where exact figures are unavailable,
provide a best estimate — never omit the field or set it to zero unless the
flow is genuinely negligible.

TRANSPORT NODE SCHEMA

Each physical transport corridor is a first-class node in the array. By making
corridors nodes (rather than inlining them per edge), a single corridor shared
by many upstream entities is described exactly once.

{
  "id": "<string — see TRANSPORT CORRIDORS>",
  "tier": "transport",
  "name": "<string, human-readable corridor name>",
  "country_iso2": "<string, ISO-3166-1 alpha-2, or 'INTL'>",
  "operator_id": "<string — see TRANSPORT CORRIDORS>",
  "mode": "<string, one of: ${transportModeValues}>",
  "form": "<string, one of: ${transportFormValues}>",
  "range": "<string, one of: local | regional | international>",
  "coordinates": { "lat": "<number>", "lon": "<number>" }
}

Transport nodes have no "downstream" field — they are referenced only via
"corridor_id" on entity node edges.

NODE ID CONVENTION

Entity node ids follow:

  {country_iso2}_{canonical_company_slug}

where canonical_company_slug is the lowercase_snake_case of canonical_company
(e.g. "Tianqi Lithium" → "AU_tianqi_lithium"). For nodes where
canonical_company is null, derive the slug from the entity's common name.

Every "target_id" in a downstream entry MUST exactly match the "id" of one
entity node in the array — EXCEPT for end-consumer slugs (see END CONSUMERS).
Every "corridor_id" MUST match the "id" of a transport node in the array.
No other dangling references.

TRANSPORT CORRIDORS

For every entity-to-entity edge, include a transport node (if not already
present) and reference it by corridor_id on the edge.

corridor_id / transport node id format:

  Domestic leg:       {country_iso2}_{mode}_{corridor_slug}
  International leg:  INTL_{mode}_{origin-slug}_{dest-slug}

Examples:
  AU_rail_pilbara-port-hedland      — Pilbara rail line to Port Hedland
  US_pipeline_keystone-xl           — Keystone XL pipeline
  DE_inland-waterway_rhine-duisburg — Rhine waterway to Duisburg
  PA_ocean_panama-canal             — Panama Canal transit
  INTL_ocean_fremantle-tianjin      — ocean route Fremantle → Tianjin
  INTL_ocean_shanghai-rotterdam     — ocean route Shanghai → Rotterdam

operator_id follows the same {country_iso2}_{slug} convention as entity ids
(e.g. "AU_aurizon", "INTL_maersk"). Use "INTL" for operators with no dominant
single-country identity.

Coordinates for transport nodes should be the geographic centroid of the
corridor, or the most significant waypoint (e.g. port of loading for an ocean
leg, midpoint of a pipeline).

COORDINATES

Every node must include a "coordinates" object with "lat" and "lon" as decimal
degree numbers. Use:
- The precise location for point assets (mine, dam, plant, port, etc.).
- The approximate centroid for linear or area assets (pipeline, railway,
  canal, fishery zone, etc.).
- The headquarters city or port of export for aggregate/trading entities.

Never omit or null coordinates — estimate if necessary.

END CONSUMERS

Do NOT create node objects for end consumers. Instead, include their id slug
as the "target_id" in a downstream entry of the last substantive entity node
(the tier immediately before the terminal end-consumer tier). End-consumer
edges still require a "corridor_id" referencing a transport node for the
final leg.

End-consumer target_ids MUST follow this exact format:

  {country_iso2}_{consumerSector}

where consumerSector is chosen from:

  ${consumerSectors.join(" | ")}

Examples:
  US_industrial, CN_residential, INTL_commercial

These ids will have no corresponding node in the array — this is the only
permitted case of a target_id without a matching entity node.

KEY RULES

- Every entity appears as exactly ONE node with a unique "id". If a
  downstream entity receives the resource from multiple extraction sites, it
  is a single node — each extraction site includes that entity's id in its
  own downstream array.

- Every transport corridor appears as exactly ONE transport node. If multiple
  upstream entities use the same corridor, each references the same corridor_id.

- Extraction-site nodes (tier-1) MUST appear first in the array, then other
  entity nodes in tier order, then transport nodes last.

SITE DISCOVERY

Identify every significant extraction site currently operating in the given
country. Include any site that:
- is currently operational or under active development, AND
- represents a material share of the country's output of that resource, OR
- has notable strategic, economic, or geopolitical significance.

Omit sites that are decommissioned, on indefinite care-and-maintenance, or
too minor to have a traceable downstream supply chain.

RESEARCH AND COMPLETENESS RULES

1. Breadth at tiers 1-2, depth at tiers 3+. Capture all major entities at the
   second tier. Further downstream, focus on the largest or most notable
   pathways.

2. Only include relationships you are confident in — backed by public supply
   agreements, exchange filings, credible industry reporting, or well-known
   industry structure. Omit any relationship you are uncertain about.

3. Include all end-use pathways. If sites feed multiple distinct sectors,
   include each as a separate downstream entry using the correct
   {country_iso2}_{consumerSector} slug — no node object required.

4. Temporal relevance. Represent the supply chain as it stands today.

5. Strict JSON. No trailing commas, no comments, no markdown formatting.`;
}

/**
 * Short, variable user prompt — changes per (country, resource) pair.
 * Contains all pair-specific context the model needs to connect to the
 * static instructions in the system prompt.
 */
export function buildUserPrompt(
  country: string,
  resource: string,
  resourceSiteType: string,
  metric: QuantityMetric,
  tiers: string[]
): string {
  const tierList = tiers.map((t, i) => {
    if (i === 0) return `  tier-${i + 1} (extraction): ${t} — the ${resourceSiteType} itself`;
    if (i === tiers.length - 1) return `  tier-${i + 1} (end consumer): ${t} — terminal segment, reference as a slug only, no node object`;
    return `  tier-${i + 1}: ${t} — intermediate entity in the ${resource} supply chain`;
  }).join("\n");

  return `COUNTRY: ${country}
RESOURCE: ${resource}
RESOURCE_SITE_TYPE: ${resourceSiteType}
METRIC: ${metric}

TIER ASSIGNMENT FOR THIS REQUEST (in supply chain order):
${tierList}

Use "${metric}" as the "metric" value on every downstream edge. Estimate annual
quantities in ${metric === "t" ? "metric tonnes" : metric === "kL" ? "kilolitres" : "megawatt-hours"} for each edge.

Produce the JSON array for all significant ${resource} supply chains in ${country}.`;
}

/**
 * @deprecated Use buildSystemPrompt() + buildUserPrompt() for prompt caching.
 * Retained for --print-prompt to show the full combined prompt.
 */
export function buildTreePrompt(
  country: string,
  resource: string,
  resourceSiteType: string,
  metric: QuantityMetric,
  tiers: string[]
): string {
  return buildSystemPrompt() + "\n\n" + buildUserPrompt(country, resource, resourceSiteType, metric, tiers);
}
