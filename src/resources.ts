// resource-schema-map.ts
// Maps each resource to its canonical extraction site type and quantity metric.
// Ambiguous resources (multiple real-world extraction methods) are split into
// separate named entries so the mapping remains 1-to-1 and can be hardcoded.

import type { QuantityMetric } from "./prompts";

interface ResourceDef {
  siteType: string;
  metric: QuantityMetric;
}

export const resourceSupplyChains = {

  // ═══════════════════════════════════════════════════════════════════
  // NON-RENEWABLE ENERGY
  // ═══════════════════════════════════════════════════════════════════
  "non-renewable-energy": {
    resources: {
      "Petroleum":    { siteType: "Oil Well",        metric: "kL" },
      "Natural Gas":  { siteType: "Gas Well",        metric: "kL" },
      "Coal":         { siteType: "Coal Mine",       metric: "t" },
      "Oil Sands":    { siteType: "Oil Sands Mine",  metric: "kL" },
      "Shale Oil":    { siteType: "Shale Oil Well",  metric: "kL" },
      "Uranium":      { siteType: "Uranium Mine",    metric: "t" },
      "Thorium":      { siteType: "Thorium Mine",    metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",       // well, mine, pad
      "refinery",         // refinery, enrichment plant, processing facility
      "distributor",      // pipeline operator, tanker fleet, rail terminal
      "utility",          // power plant, gas utility, fuel retailer
      "end_consumer",     // household, industrial facility, vehicle fleet
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // RENEWABLE ENERGY
  // ═══════════════════════════════════════════════════════════════════
  "renewable-energy": {
    resources: {
      "Solar Radiation":  { siteType: "Solar Farm",                metric: "MWh" },
      "Wind":             { siteType: "Wind Farm",                 metric: "MWh" },
      "Geothermal Heat":  { siteType: "Geothermal Power Plant",   metric: "MWh" },
      "Hydropower":       { siteType: "Hydroelectric Dam",        metric: "MWh" },
      "Tidal Energy":     { siteType: "Tidal Energy Installation", metric: "MWh" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "generation",       // farm, dam, plant
      "transmission",     // high-voltage grid operator
      "distribution",     // regional distribution network
      "retailer",         // energy retailer, aggregator
      "end_consumer",     // household, commercial building, EV charger
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // METALLIC MINERALS — FERROUS
  // ═══════════════════════════════════════════════════════════════════
  "ferrous-metals": {
    resources: {
      "Iron Ore":   { siteType: "Iron Mine",      metric: "t" },
      "Manganese":  { siteType: "Manganese Mine",  metric: "t" },
      "Chromium":   { siteType: "Chromium Mine",   metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",       // open-pit or underground mine
      "smelter",          // blast furnace, smelting plant
      "mill",             // steel mill, rolling mill, foundry
      "manufacturer",     // structural steel fabricator, auto body plant
      "end_consumer",     // construction site, vehicle buyer, appliance buyer
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // METALLIC MINERALS — NON-FERROUS
  // ═══════════════════════════════════════════════════════════════════
  "non-ferrous-metals": {
    resources: {
      "Copper":    { siteType: "Copper Mine",   metric: "t" },
      "Aluminum":  { siteType: "Bauxite Mine",  metric: "t" },
      "Zinc":      { siteType: "Zinc Mine",     metric: "t" },
      "Lead":      { siteType: "Lead Mine",     metric: "t" },
      "Nickel":    { siteType: "Nickel Mine",   metric: "t" },
      "Tin":       { siteType: "Tin Mine",      metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",       // mine, open-pit
      "smelter",          // smelter, electrolytic refinery
      "semi_fabricator",  // wire rod mill, sheet/coil plant, extrusion press
      "manufacturer",     // electronics assembler, cable maker, battery plant
      "end_consumer",     // household, data centre, construction site
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // METALLIC MINERALS — PRECIOUS
  // ═══════════════════════════════════════════════════════════════════
  "precious-metals": {
    resources: {
      "Gold":                    { siteType: "Gold Mine",     metric: "t" },
      "Silver":                  { siteType: "Silver Mine",   metric: "t" },
      "Platinum Group Metals":   { siteType: "Platinum Mine", metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",       // mine, alluvial operation
      "refinery",         // assay refinery, mint
      "dealer",           // bullion dealer, commodity exchange, central bank vault
      "fabricator",       // jeweller, electronics component maker, catalyst mfr
      "end_consumer",     // retail buyer, investor, industrial user
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // METALLIC MINERALS — STRATEGIC / CRITICAL
  // ═══════════════════════════════════════════════════════════════════
  "strategic-metals": {
    resources: {
      "Lithium (hard-rock)":  { siteType: "Lithium Mine",               metric: "t" },
      "Lithium (brine)":      { siteType: "Brine Extraction Facility",  metric: "t" },
      "Cobalt":               { siteType: "Cobalt Mine",                metric: "t" },
      "Gallium":              { siteType: "Gallium Refinery",           metric: "t" },
      "Indium":               { siteType: "Indium Refinery",            metric: "t" },
      "Tungsten":             { siteType: "Tungsten Mine",              metric: "t" },
      "Tantalum":             { siteType: "Tantalum Mine",              metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",           // mine, brine pond, by-product recovery
      "chemical_processor",   // chemical conversion plant (e.g. lithium hydroxide)
      "component_maker",      // battery cell plant, semiconductor fab, hard-metal tool mfr
      "oem",                  // EV maker, electronics OEM, aerospace assembler
      "end_consumer",         // vehicle buyer, device buyer, defence agency
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // METALLIC MINERALS — RARE EARTH
  // ═══════════════════════════════════════════════════════════════════
  "rare-earth-elements": {
    resources: {
      "Neodymium":   { siteType: "Neodymium Rare Earth Mine",  metric: "t" },
      "Dysprosium":  { siteType: "Dysprosium Rare Earth Mine", metric: "t" },
      "Lanthanum":   { siteType: "Lanthanum Rare Earth Mine",  metric: "t" },
      "Cerium":      { siteType: "Cerium Rare Earth Mine",     metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",           // mine, ion-adsorption clay operation
      "separation_plant",     // solvent-extraction / separation facility
      "alloy_producer",       // magnet alloy plant, phosphor maker, catalyst producer
      "oem",                  // wind turbine maker, EV motor assembler, electronics OEM
      "end_consumer",         // utility, vehicle buyer, device buyer
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // NON-METALLIC MINERALS — INDUSTRIAL
  // ═══════════════════════════════════════════════════════════════════
  "industrial-minerals": {
    resources: {
      "Phosphate Rock":         { siteType: "Phosphate Mine",            metric: "t" },
      "Potash (underground)":   { siteType: "Potash Mine",              metric: "t" },
      "Potash (brine)":         { siteType: "Brine Extraction Facility", metric: "t" },
      "Sulfur":                 { siteType: "Sulfur Mine",               metric: "t" },
      "Fluorite":               { siteType: "Fluorite Mine",             metric: "t" },
      "Barite":                 { siteType: "Barite Mine",               metric: "t" },
      "Gypsum":                 { siteType: "Gypsum Mine",               metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",             // mine, brine recovery
      "chemical_processor",     // fertiliser plant, acid plant, chemical works
      "blender_distributor",    // fertiliser blender, industrial chemical distributor
      "applicator",             // farm co-op, drilling-mud supplier, plasterboard factory
      "end_consumer",           // farmer, oilfield operator, building occupant
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // NON-METALLIC MINERALS — CONSTRUCTION
  // ═══════════════════════════════════════════════════════════════════
  "construction-minerals": {
    resources: {
      "Sand":       { siteType: "Sand Quarry",      metric: "t" },
      "Gravel":     { siteType: "Gravel Quarry",    metric: "t" },
      "Limestone":  { siteType: "Limestone Quarry",  metric: "t" },
      "Clay":       { siteType: "Clay Quarry",      metric: "t" },
      "Granite":    { siteType: "Granite Quarry",    metric: "t" },
      "Marble":     { siteType: "Marble Quarry",     metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",         // quarry, dredging operation
      "processor",          // crushing plant, cement kiln, brick works
      "building_products",  // ready-mix concrete plant, precast yard, tile factory
      "contractor",         // general contractor, civil engineering firm
      "end_consumer",       // building owner, infrastructure agency, homeowner
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // NON-METALLIC MINERALS — SPECIAL
  // ═══════════════════════════════════════════════════════════════════
  "special-minerals": {
    resources: {
      "Graphite":   { siteType: "Graphite Mine",  metric: "t" },
      "Talc":       { siteType: "Talc Mine",      metric: "t" },
      "Mica":       { siteType: "Mica Mine",      metric: "t" },
      "Quartz":     { siteType: "Quartz Mine",    metric: "t" },
      "Feldspar":   { siteType: "Feldspar Mine",  metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",           // mine
      "processor",            // milling, purification, synthetic conversion
      "component_maker",      // anode producer, cosmetics formulator, glass maker
      "manufacturer",         // battery cell plant, electronics assembler, ceramics factory
      "end_consumer",         // device buyer, consumer goods buyer, builder
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // BIOLOGICAL — AGRICULTURE
  // ═══════════════════════════════════════════════════════════════════
  "agriculture": {
    resources: {
      "Grain-Crops":  { siteType: "Grain-Crop Farm", metric: "t" },
      "Oil-Crops":    { siteType: "Oil-Crop Farm",   metric: "t" },
      "Fiber-Crops":  { siteType: "Fiber-Crop Farm",  metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "grower",              // farm, plantation
      "elevator_handler",    // grain elevator, ginning facility, storage depot
      "processor",           // flour mill, oil crusher, textile mill
      "brand_packer",        // food brand, packaged goods company, garment maker
      "retailer",            // supermarket, clothing store, food-service chain
      "end_consumer",        // household, restaurant patron
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // BIOLOGICAL — PLANTS & FORESTRY
  // ═══════════════════════════════════════════════════════════════════
  "forestry-plants": {
    resources: {
      "Timber":            { siteType: "Logging Operation",      metric: "t" },
      "Pulpwood":          { siteType: "Pulpwood Plantation",    metric: "t" },
      "Natural-Rubber":    { siteType: "Rubber Plantation",      metric: "t" },
      "Resin":             { siteType: "Resin Tapping Site",     metric: "t" },
      "Medicinal-Plants":  { siteType: "Medicinal Plant Farm",   metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "harvester",          // logging operation, plantation, tapping site
      "primary_mill",       // sawmill, pulp mill, latex processing plant
      "secondary_maker",    // plywood factory, paper mill, tyre factory, pharma lab
      "distributor",        // timber merchant, paper wholesaler, pharma distributor
      "end_consumer",       // builder, printer, driver, patient
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // BIOLOGICAL — ANIMALS (AQUATIC & TERRESTRIAL)
  // ═══════════════════════════════════════════════════════════════════
  "animal-resources": {
    resources: {
      "Fish (wild)":       { siteType: "Fishery",        metric: "t" },
      "Fish (farmed)":     { siteType: "Fish Farm",      metric: "t" },
      "Shellfish (wild)":  { siteType: "Shellfish Bed",  metric: "t" },
      "Shellfish (farmed)":{ siteType: "Shellfish Farm",  metric: "t" },
      "Wild-Game":         { siteType: "Hunting Ground",  metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "harvester",          // fishing vessel, aquaculture pen, hunting ground
      "landing_processor",  // fish landing, abattoir, cold store
      "packer",             // filleting plant, cannery, smokehouse
      "distributor",        // seafood wholesaler, cold-chain logistics
      "retailer",           // fishmonger, supermarket, restaurant
      "end_consumer",       // household, diner
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // WATER
  // ═══════════════════════════════════════════════════════════════════
  "water": {
    resources: {
      "Surface Water":  { siteType: "Water Reservoir",             metric: "kL" },
      "Groundwater":    { siteType: "Groundwater Well",            metric: "kL" },
      "Saltwater":      { siteType: "Desalination Plant",          metric: "kL" },
      "Meltwater":      { siteType: "Glacial Meltwater Catchment", metric: "kL" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "source_capture",     // reservoir, well, intake, desal plant
      "treatment",          // water treatment plant
      "transmission",       // trunk main, aqueduct, canal
      "distribution",       // municipal pipe network, tanker delivery
      "end_consumer",       // household, farm irrigator, industrial plant
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // SOIL / LAND
  // ═══════════════════════════════════════════════════════════════════
  "soil-land": {
    resources: {
      "Arable":              { siteType: "Farmland",           metric: "t" },
      "Pastureland":         { siteType: "Pasture",            metric: "t" },
      "Forest Land":         { siteType: "Forestry Operation",  metric: "t" },
      "Mineral-Bearing Land":{ siteType: "Mine",               metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "land_holder",         // farm, ranch, forestry estate, mining lease
      "land_manager",        // agricultural co-op, forestry commission, pastoral company
      "production_user",     // crop grower, livestock producer, timber harvester
      "downstream_processor",// mill, abattoir, sawmill, concentrator
      "end_consumer",        // food buyer, timber buyer, mineral buyer
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // MARINE — SEAWATER EXTRACTION
  // ═══════════════════════════════════════════════════════════════════
  "marine-seawater": {
    resources: {
      "Magnesium (seawater)":  { siteType: "Seawater Extraction Plant", metric: "t" },
      "Magnesium (mineral)":   { siteType: "Magnesite Mine",            metric: "t" },
      "Bromine (seawater)":    { siteType: "Seawater Extraction Plant", metric: "t" },
      "Bromine (brine)":       { siteType: "Brine Well",               metric: "t" },
      "Salt (rock)":           { siteType: "Salt Mine",                metric: "t" },
      "Salt (evaporated)":     { siteType: "Salt Evaporation Pond",    metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",            // evaporation pond, mine, seawater intake
      "refinery",              // electrolytic plant, purification works
      "chemical_processor",    // flame-retardant maker, de-icing supplier, food-grade salt packer
      "manufacturer",          // alloy producer, pharmaceutical company, food processor
      "end_consumer",          // household, industrial user, road maintenance agency
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // MARINE — SEABED
  // ═══════════════════════════════════════════════════════════════════
  "marine-seabed": {
    resources: {
      "Polymetallic Nodules":  { siteType: "Deep-Sea Mining Operation", metric: "t" },
      "Cobalt Crusts":         { siteType: "Deep-Sea Mining Operation", metric: "t" },
      "Massive Sulfides":      { siteType: "Deep-Sea Mining Operation", metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "extraction",            // deep-sea mining vessel
      "onshore_processor",     // beneficiation / hydromet plant
      "smelter_refiner",       // smelter, electro-refinery
      "manufacturer",          // battery maker, alloy producer, electronics OEM
      "end_consumer",          // device buyer, EV buyer, infrastructure project
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // AIR / ATMOSPHERIC GASES
  // ═══════════════════════════════════════════════════════════════════
  "atmospheric-gases": {
    resources: {
      "Nitrogen":                       { siteType: "Air Separation Plant",              metric: "t" },
      "Oxygen":                         { siteType: "Air Separation Plant",              metric: "t" },
      "Noble Gases":                    { siteType: "Air Separation Plant",              metric: "t" },
      "Carbon Dioxide (atmospheric)":   { siteType: "Direct Air Capture Facility",      metric: "t" },
      "Carbon Dioxide (industrial)":    { siteType: "Industrial Carbon Capture Facility", metric: "t" },
    } satisfies Record<string, ResourceDef>,
    tiers: [
      "separation_capture",   // air separation unit, DAC plant, flue-gas capture
      "purifier_liquefier",   // cryogenic purification, compression, liquefaction
      "distributor",          // industrial gas distributor, pipeline network, tanker fleet
      "point_of_use",         // hospital, welding shop, food-packaging line, greenhouse
      "end_consumer",         // patient, food buyer, beverage consumer, farmer
    ],
  },

} as const;
