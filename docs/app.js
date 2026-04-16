// ── Colours ───────────────────────────────────────────────────────
const TIER_COLORS = {
  extraction: { css: "#f97316", cesium: Cesium.Color.fromCssColorString("#f97316") },
  transport:  { css: "#38bdf8", cesium: Cesium.Color.fromCssColorString("#38bdf8") },
  delivery:   { css: "#a78bfa", cesium: Cesium.Color.fromCssColorString("#a78bfa") },
};

const ARC_COLOR_ENTITY    = Cesium.Color.fromCssColorString("#f97316").withAlpha(0.75);
const ARC_COLOR_TRANSPORT = Cesium.Color.fromCssColorString("#38bdf8").withAlpha(0.6);

const TRANSPORT_MODE_LABELS = {
  road: "Road", rail: "Rail", inland_waterway: "Water", ocean_freight: "Sea",
  pipeline: "Pipe", conveyor: "Conv", air_freight: "Air", electrical_grid: "Grid",
};

function tierColor(tier) {
  if (tier === "extraction") return TIER_COLORS.extraction;
  if (tier === "transport")  return TIER_COLORS.transport;
  return TIER_COLORS.delivery;
}
function modeLabel(mode) { return TRANSPORT_MODE_LABELS[mode] ?? "Other"; }

// ── Cesium viewer ─────────────────────────────────────────────────
Cesium.Ion.defaultAccessToken = "";

const viewer = new Cesium.Viewer("cesiumContainer", {
  baseLayer: new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      credit: "© OpenStreetMap contributors © CARTO",
    })
  ),
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false,
  animation: false, timeline: false, fullscreenButton: false,
  infoBox: false, selectionIndicator: false,
  skyBox: false, skyAtmosphere: false,
  backgroundColor: Cesium.Color.fromCssColorString("#0a0c10"),
});

viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#1a1a2e");
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0c10");

// ── State ─────────────────────────────────────────────────────────
let nodeMap        = new Map();  // id → node data
let cesiumMap      = new Map();  // id → Cesium entity
let arcEntities    = [];
let highlightArcs  = [];         // arcs drawn by pair highlight
let selectedId     = null;
let highlightedIds = null;       // Set<string> | null
let pairIndex      = {};         // pre-built country+resource → ids

// ── Panel elements ────────────────────────────────────────────────
const panel        = document.getElementById("panel");
const panelClose   = document.getElementById("panel-close");
const panelTier    = document.getElementById("panel-tier");
const panelName    = document.getElementById("panel-name");
const panelMeta    = document.getElementById("panel-meta");
const panelContent = document.getElementById("panel-content");

panelClose.addEventListener("click", () => {
  panel.classList.add("hidden");
  clearArcs();
  deselectAll();
  selectedId = null;
  if (highlightedIds) drawHighlightArcs(highlightedIds);
});

// ── Arc drawing ───────────────────────────────────────────────────
function clearArcs() {
  for (const e of arcEntities) viewer.entities.remove(e);
  arcEntities = [];
}

function clearHighlightArcs() {
  for (const e of highlightArcs) viewer.entities.remove(e);
  highlightArcs = [];
}

function addArc(from, to, color, bucket = arcEntities) {
  if (!from?.coordinates || !to?.coordinates) return;
  // Sample along a geodesic (great-circle) with a parabolic height profile so
  // the arc stays above the globe surface rather than cutting through it.
  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(from.coordinates.lon, from.coordinates.lat),
    Cesium.Cartographic.fromDegrees(to.coordinates.lon,   to.coordinates.lat)
  );
  const NUM_SEGMENTS = 64;
  const dist = geodesic.surfaceDistance;           // metres along the surface
  const MAX_HEIGHT   = dist * 0.15; // scale height with distance
  const positions = [];
  for (let i = 0; i <= NUM_SEGMENTS; i++) {
    const t = i / NUM_SEGMENTS;
    const height = MAX_HEIGHT * 4 * t * (1 - t); // parabola: 0 → peak → 0
    const carto  = geodesic.interpolateUsingFraction(t);
    positions.push(Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height));
  }
  const e = viewer.entities.add({
    polyline: {
      positions,
      width: 2,
      arcType: Cesium.ArcType.NONE, // points already on great-circle; no further subdivision needed
      material: new Cesium.PolylineArrowMaterialProperty(color),
      clampToGround: false,
    },
  });
  bucket.push(e);
}

function drawArcs(entityNode) {
  clearArcs();
  if (!entityNode.downstream) return;
  for (const edge of entityNode.downstream) {
    const corridor  = nodeMap.get(edge.corridor_id);
    const downstream = nodeMap.get(edge.target_id);
    // Leg 1: entity → transport corridor
    if (corridor) addArc(entityNode, corridor, ARC_COLOR_ENTITY);
    // Leg 2: transport corridor → downstream entity (or consumer placeholder)
    if (corridor && downstream) addArc(corridor, downstream, ARC_COLOR_TRANSPORT);
    else if (!corridor && downstream) addArc(entityNode, downstream, ARC_COLOR_ENTITY);
  }
}

/** Find every downstream edge that references the given corridor and draw
 *  source → corridor → target arcs for each one. */
function drawCorridorArcs(corridorId) {
  clearArcs();
  const corridor = nodeMap.get(corridorId);
  if (!corridor) return;
  for (const node of nodeMap.values()) {
    if (node.tier === "transport" || !node.downstream) continue;
    for (const edge of node.downstream) {
      if (edge.corridor_id !== corridorId) continue;
      const target = nodeMap.get(edge.target_id);
      addArc(node, corridor, ARC_COLOR_ENTITY);
      if (target) addArc(corridor, target, ARC_COLOR_TRANSPORT);
    }
  }
}

// ── Panel — entity node ───────────────────────────────────────────
function showEntityPanel(node) {
  const color = tierColor(node.tier);
  panelTier.textContent = node.tier === "extraction" ? "extraction" : "delivery";
  panelTier.style.background = color.css + "22";
  panelTier.style.color = color.css;
  panelName.textContent = node.name ?? node.id;

  const coords = node.coordinates
    ? `${node.coordinates.lat.toFixed(4)}, ${node.coordinates.lon.toFixed(4)}`
    : "—";

  panelMeta.innerHTML = `
    <span><span class="label">Company</span><span class="value">${node.canonical_company ?? "—"}</span></span>
    <span><span class="label">Country</span><span class="value">${node.country_iso2 ?? "—"}</span></span>
    <span><span class="label">Coordinates</span><span class="value">${coords}</span></span>
    <span><span class="label">Node ID</span><span class="value" style="font-size:10px;">${node.id}</span></span>
  `;

  const downstream = node.downstream ?? [];
  let html = '<div class="section-title">Downstream Connections</div>';

  if (downstream.length === 0) {
    html += '<p style="color:#475569;font-size:12px;">No downstream connections.</p>';
  } else {
    for (const edge of downstream) {
      const target   = nodeMap.get(edge.target_id);
      const corridor = nodeMap.get(edge.corridor_id);
      const targetName = target?.name ?? edge.target_id;
      const missing  = !target;
      const corridorName = corridor?.name ?? edge.corridor_id ?? "—";
      const corridorLabel = corridor ? modeLabel(corridor.mode) : "Other";
      const corridorMeta = corridor ? `${corridor.mode} · ${corridor.range}` : "";

      html += `<div class="edge-card${target ? " clickable" : ""}" data-target="${edge.target_id}" data-corridor="${edge.corridor_id ?? ""}">
        <div class="edge-target${missing ? " missing" : ""}">${targetName}</div>
        ${corridor ? `
        <div class="transport-pill" data-corridor="${edge.corridor_id}">
          <span class="tp-icon">${corridorLabel}</span>
          <span class="tp-name">${corridorName}</span>
          <span class="tp-meta">${corridorMeta}</span>
        </div>` : ""}
      </div>`;
    }
  }

  panelContent.innerHTML = html;

  // Wire entity card clicks
  for (const card of panelContent.querySelectorAll(".edge-card.clickable")) {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".transport-pill")) return;
      selectNode(card.dataset.target);
    });
  }
  // Wire transport pill clicks
  for (const pill of panelContent.querySelectorAll(".transport-pill")) {
    pill.addEventListener("click", () => selectNode(pill.dataset.corridor));
  }

  panel.classList.remove("hidden");
}

// ── Panel — transport node ────────────────────────────────────────
function showTransportPanel(node) {
  const color = tierColor("transport");
  panelTier.textContent = "transport";
  panelTier.style.background = color.css + "22";
  panelTier.style.color = color.css;
  panelName.textContent = node.name ?? node.id;

  const coords = node.coordinates
    ? `${node.coordinates.lat.toFixed(4)}, ${node.coordinates.lon.toFixed(4)}`
    : "—";

  panelMeta.innerHTML = `
    <span><span class="label">Corridor ID</span><span class="value" style="font-size:10px;">${node.id}</span></span>
    <span><span class="label">Country</span><span class="value">${node.country_iso2 ?? "—"}</span></span>
    <span><span class="label">Coordinates</span><span class="value">${coords}</span></span>
  `;

  // Collect all edges that reference this corridor
  const usages = [];
  for (const n of nodeMap.values()) {
    if (n.tier === "transport" || !n.downstream) continue;
    for (const edge of n.downstream) {
      if (edge.corridor_id === node.id) usages.push({ source: n, edge });
    }
  }

  let html = `
    <div class="section-title">Corridor Details</div>
    <div class="info-row"><span class="label">Operator</span><span class="value">${node.operator_id ?? "—"}</span></div>
    <div class="info-row"><span class="label">Mode</span><span class="value">${node.mode ?? "—"}</span></div>
    <div class="info-row"><span class="label">Form</span><span class="value">${node.form ?? "—"}</span></div>
    <div class="info-row"><span class="label">Range</span><span class="value">${node.range ?? "—"}</span></div>
  `;

  html += '<div class="section-title" style="margin-top:12px;">Flows Using This Corridor</div>';
  if (usages.length === 0) {
    html += '<p style="color:#475569;font-size:12px;">No flows reference this corridor.</p>';
  } else {
    for (const { source, edge } of usages) {
      const target = nodeMap.get(edge.target_id);
      const targetName = target?.name ?? edge.target_id;
      const sourceName = source.name ?? source.id;
      const resource = edge.resource ?? "—";
      const qty = edge.quantity != null ? `${edge.quantity.toLocaleString()} ${edge.metric ?? ""}` : "";

      html += `<div class="edge-card clickable" data-source="${source.id}" data-target="${edge.target_id}">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:2px;">${sourceName}</div>
        <div class="edge-target" style="display:flex;align-items:center;gap:6px;">
          <span>→ ${targetName}</span>
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">${resource}${qty ? " · " + qty : ""}</div>
      </div>`;
    }
  }

  panelContent.innerHTML = html;

  // Wire clicks: clicking a flow card navigates to the source entity
  for (const card of panelContent.querySelectorAll(".edge-card.clickable")) {
    card.addEventListener("click", () => selectNode(card.dataset.source));
  }

  panel.classList.remove("hidden");
}

// ── Node selection ────────────────────────────────────────────────
function applyDimStyle(entity, node) {
  if (!node) return;
  const color = tierColor(node.tier).cesium.withAlpha(0.08);
  entity.point.color        = new Cesium.ConstantProperty(color);
  entity.point.pixelSize    = new Cesium.ConstantProperty(node.tier === "transport" ? 4 : 6);
  entity.point.outlineWidth = new Cesium.ConstantProperty(0);
}

function deselectAll() {
  for (const [id, entity] of cesiumMap) {
    const node = nodeMap.get(id);
    if (highlightedIds !== null && !highlightedIds.has(id)) {
      applyDimStyle(entity, node);
    } else {
      applyDefaultStyle(entity, node);
    }
  }
}

// ── Highlight pair ────────────────────────────────────────────────
function applyHighlight(ids) {
  highlightedIds = ids;
  for (const [id, entity] of cesiumMap) {
    const node = nodeMap.get(id);
    if (ids === null || ids.has(id)) {
      applyDefaultStyle(entity, node);
    } else {
      applyDimStyle(entity, node);
    }
  }
}

function drawHighlightArcs(ids) {
  clearHighlightArcs();
  for (const id of ids) {
    const node = nodeMap.get(id);
    if (!node || node.tier === "transport" || !node.downstream) continue;
    for (const edge of node.downstream) {
      const corridor   = nodeMap.get(edge.corridor_id);
      const downstream = nodeMap.get(edge.target_id);
      if (corridor) addArc(node, corridor, ARC_COLOR_ENTITY, highlightArcs);
      if (corridor && downstream) addArc(corridor, downstream, ARC_COLOR_TRANSPORT, highlightArcs);
      else if (!corridor && downstream) addArc(node, downstream, ARC_COLOR_ENTITY, highlightArcs);
    }
  }
}

// ── Autocomplete helper ───────────────────────────────────────────
// items: Array<{ label: string, group?: string }>
// Returns getter function () => selectedValue | null
function makeAutocomplete(inputEl, dropdownEl, items) {
  let selectedValue = null;

  function render(filter) {
    const q = filter.trim().toLowerCase();
    dropdownEl.innerHTML = "";
    let lastGroup = null;
    let count = 0;
    for (const item of items) {
      if (q && !item.label.toLowerCase().includes(q)) continue;
      if (item.group && item.group !== lastGroup) {
        const gl = document.createElement("div");
        gl.className = "sp-group-label";
        gl.textContent = item.group;
        dropdownEl.appendChild(gl);
        lastGroup = item.group;
      }
      const opt = document.createElement("div");
      opt.className = "sp-option" + (item.label === selectedValue ? " active" : "");
      opt.textContent = item.label;
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent blur firing first
        selectedValue = item.label;
        inputEl.value = item.label;
        inputEl.classList.add("selected");
        dropdownEl.classList.remove("open");
      });
      dropdownEl.appendChild(opt);
      count++;
    }
    dropdownEl.classList.toggle("open", count > 0);
  }

  inputEl.addEventListener("input", () => {
    selectedValue = null;
    inputEl.classList.remove("selected");
    render(inputEl.value);
  });
  inputEl.addEventListener("focus", () => render(inputEl.value));
  inputEl.addEventListener("blur", () => {
    // Delay so mousedown on option fires first
    setTimeout(() => dropdownEl.classList.remove("open"), 150);
    // If text doesn't match a confirmed selection, clear it
    if (selectedValue === null && inputEl.value.trim()) {
      const exact = items.find(i => i.label.toLowerCase() === inputEl.value.trim().toLowerCase());
      if (exact) {
        selectedValue = exact.label;
        inputEl.value = exact.label;
        inputEl.classList.add("selected");
      } else {
        inputEl.value = "";
        inputEl.classList.remove("selected");
      }
    }
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dropdownEl.classList.remove("open");
      inputEl.blur();
    }
  });

  return {
    getValue: () => selectedValue,
    reset() {
      selectedValue = null;
      inputEl.value = "";
      inputEl.classList.remove("selected");
      dropdownEl.classList.remove("open");
    },
  };
}

let acCountry  = { getValue: () => null, reset() {} };
let acResource = { getValue: () => null, reset() {} };

function loadSearchOptions() {
  const { countries, resources } = window.__SEARCH_DATA__ ?? { countries: [], resources: [] };

  const countryItems = countries.map(c => ({ label: c }));
  const resourceItems = resources.map(r => ({ label: r }));

  acCountry  = makeAutocomplete(
    document.getElementById("country-input"),
    document.getElementById("country-dropdown"),
    countryItems
  );
  acResource = makeAutocomplete(
    document.getElementById("resource-input"),
    document.getElementById("resource-dropdown"),
    resourceItems
  );
}

document.getElementById("highlight-btn").addEventListener("click", () => {
  const country  = acCountry.getValue();
  const resource = acResource.getValue();
  const status   = document.getElementById("highlight-status");
  if (!country || !resource) {
    status.textContent = "Select a country and resource first.";
    return;
  }

  // Look up from pre-built pair index
  const key = `${country}|||${resource}`;
  const ids = pairIndex[key] ?? [];
  const idSet = new Set(ids);

  // Also include transport corridors referenced by these entity nodes
  for (const id of idSet) {
    const node = nodeMap.get(id);
    if (!node?.downstream) continue;
    for (const edge of node.downstream) {
      if (edge.corridor_id) idSet.add(edge.corridor_id);
    }
  }
  if (idSet.size === 0) {
    status.textContent = "No data for this pair.";
    return;
  }
  // Close any open detail panel so highlight arcs aren't immediately overridden
  panel.classList.add("hidden");
  clearArcs();
  selectedId = null;
  applyHighlight(idSet);
  drawHighlightArcs(idSet);
  status.textContent = `${ids.length} node${ids.length !== 1 ? "s" : ""} highlighted.`;
});

document.getElementById("clear-btn").addEventListener("click", () => {
  applyHighlight(null);
  clearHighlightArcs();
  clearArcs();
  document.getElementById("highlight-status").textContent = "";
  acCountry.reset();
  acResource.reset();
});

function applyDefaultStyle(entity, node) {
  if (!node) return;
  if (node.tier === "transport") {
    entity.point.pixelSize       = new Cesium.ConstantProperty(7);
    entity.point.color           = new Cesium.ConstantProperty(TIER_COLORS.transport.cesium);
    entity.point.outlineWidth    = new Cesium.ConstantProperty(0);
  } else {
    entity.point.pixelSize       = new Cesium.ConstantProperty(10);
    entity.point.color           = new Cesium.ConstantProperty(tierColor(node.tier).cesium);
    entity.point.outlineWidth    = new Cesium.ConstantProperty(0);
  }
}

function selectNode(id) {
  const node = nodeMap.get(id);
  if (!node) return;

  deselectAll();
  clearArcs();
  selectedId = id;

  const entity = cesiumMap.get(id);
  if (entity) {
    entity.point.color        = new Cesium.ConstantProperty(Cesium.Color.WHITE);
    entity.point.pixelSize    = new Cesium.ConstantProperty(14);
    entity.point.outlineColor = new Cesium.ConstantProperty(tierColor(node.tier).cesium);
    entity.point.outlineWidth = new Cesium.ConstantProperty(3);
  }

  if (node.tier === "transport") {
    drawCorridorArcs(id);
    showTransportPanel(node);
  } else {
    drawArcs(node);
    showEntityPanel(node);
  }

  if (node.coordinates) {
    const currentHeight = viewer.camera.positionCartographic.height;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        node.coordinates.lon, node.coordinates.lat, currentHeight
      ),
      duration: 1.2,
    });
  }
}

// ── Click handler ─────────────────────────────────────────────────
viewer.screenSpaceEventHandler.setInputAction((click) => {
  const picked = viewer.scene.pick(click.position);
  if (Cesium.defined(picked) && picked.id?.properties?.nodeId) {
    selectNode(picked.id.properties.nodeId.getValue());
  } else {
    panel.classList.add("hidden");
    clearArcs();
    deselectAll();
    selectedId = null;
    if (highlightedIds) drawHighlightArcs(highlightedIds);
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// ── Load & render ─────────────────────────────────────────────────
async function loadNodes() {
  const res   = await fetch("data/nodes.json");
  const nodes = await res.json();

  if (nodes.length === 0) {
    document.getElementById("empty-state").classList.add("visible");
    return;
  }

  for (const node of nodes) nodeMap.set(node.id, node);

  for (const node of nodes) {
    if (!node.coordinates?.lat || !node.coordinates?.lon) continue;

    const isTransport = node.tier === "transport";
    const color = tierColor(node.tier).cesium;

    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        node.coordinates.lon, node.coordinates.lat, 0
      ),
      point: {
        pixelSize: isTransport ? 7 : 10,
        color,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.4),
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      properties: { nodeId: node.id },
    });

    cesiumMap.set(node.id, entity);
  }

  console.log(`Loaded ${nodes.length} nodes (${[...nodeMap.values()].filter(n => n.tier === "transport").length} transport).`);
}

async function loadPairIndex() {
  try {
    const res = await fetch("data/pair-index.json");
    pairIndex = await res.json();
  } catch (e) {
    console.warn("Could not load pair index:", e);
  }
}

loadNodes().catch(console.error);
loadPairIndex();
loadSearchOptions();

// ── Insights panel wiring ──────────────────────────────────────────
const insightBtns   = document.querySelectorAll(".insight-btn");
const insightStatus = document.getElementById("insight-status");
let activeInsight   = null;
const analysisCache = {};

function tierBadge(tier) {
  const c = tierColor(tier ?? "delivery");
  return `<span class="insight-node-tier" style="background:${c.css}22;color:${c.css}">${tier ?? "—"}</span>`;
}

function showInsightPanel(title, html) {
  panelTier.textContent = "insight";
  panelTier.style.background = "#1d4ed822";
  panelTier.style.color = "#60a5fa";
  panelName.textContent = title;
  panelMeta.innerHTML = "";
  panelContent.innerHTML = html;

  // Wire clickable cards to navigate to node
  for (const card of panelContent.querySelectorAll(".edge-card.clickable[data-node-id]")) {
    card.addEventListener("click", () => selectNode(card.dataset.nodeId));
  }

  panel.classList.remove("hidden");
}

function renderRankedResults(items, scoreFmt) {
  let html = '<div class="section-title">Ranked Nodes</div>';
  const top = items.slice(0, 200);
  for (let i = 0; i < top.length; i++) {
    const item = top[i];
    const score = scoreFmt(item);
    html += `<div class="edge-card clickable" data-node-id="${item.id}" style="display:flex;gap:10px;align-items:flex-start;">
      <span class="insight-rank">#${i + 1}</span>
      <div style="flex:1;min-width:0;">
        <div class="edge-target">${tierBadge(item.tier)}${item.name ?? item.id}</div>
        <div class="insight-score">${score}</div>
        <div class="insight-node-meta">${item.company ?? ""} ${item.country ? "· " + item.country : ""}</div>
      </div>
    </div>`;
  }
  return html;
}

function renderLouvainResults(communities) {
  let html = '<div class="section-title">Communities by Size</div>';
  for (const c of communities.slice(0, 50)) {
    html += `<div class="community-header">Community ${c.community} — ${c.size} node${c.size !== 1 ? "s" : ""}</div>`;
    for (const m of c.members.slice(0, 30)) {
      html += `<div class="edge-card clickable" data-node-id="${m.id}">
        <div class="edge-target">${tierBadge(m.tier)}${m.name ?? m.id}</div>
        <div class="insight-node-meta">${m.company ?? ""} ${m.country ? "· " + m.country : ""}</div>
      </div>`;
    }
    if (c.members.length > 30) {
      html += `<div style="font-size:11px;color:#475569;padding:4px 12px;">… and ${c.members.length - 30} more</div>`;
    }
  }
  return html;
}

for (const btn of insightBtns) {
  btn.addEventListener("click", async () => {
    const analysis = btn.dataset.analysis;
    // Toggle off if already active
    if (activeInsight === analysis) {
      btn.classList.remove("active");
      activeInsight = null;
      panel.classList.add("hidden");
      insightStatus.textContent = "";
      return;
    }
    // Deactivate other buttons
    for (const b of insightBtns) b.classList.remove("active");
    btn.classList.add("active");
    activeInsight = analysis;
    insightStatus.textContent = "Loading…";

    try {
      if (!analysisCache[analysis]) {
        const res = await fetch(`data/${analysis}.json`);
        if (!res.ok) throw new Error(await res.text());
        analysisCache[analysis] = await res.json();
      }
      const data = analysisCache[analysis];

      if (analysis === "louvain") {
        insightStatus.textContent = `${data.length} communities found.`;
        showInsightPanel("Louvain Communities", renderLouvainResults(data));
      } else if (analysis === "betweenness") {
        insightStatus.textContent = `${data.length} nodes ranked.`;
        showInsightPanel("Betweenness Centrality", renderRankedResults(data, d => `Score: ${d.score.toFixed(6)}`));
      } else if (analysis === "pagerank") {
        insightStatus.textContent = `${data.length} nodes ranked.`;
        showInsightPanel("PageRank", renderRankedResults(data, d => `Score: ${d.score.toFixed(6)}`));
      } else if (analysis === "degree") {
        insightStatus.textContent = `${data.length} nodes ranked.`;
        showInsightPanel("Degree Centrality", renderRankedResults(data, d => `Total: ${d.score}  (in: ${d.inDegree}, out: ${d.outDegree})`));
      }
    } catch (e) {
      insightStatus.textContent = "Error: " + e.message;
      console.error(e);
    }
  });
}
