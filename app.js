let manifest = null;
let map = null;
let tileLayer = null;
let currentOverlay = null;
const decodedImages = new Map();

function layerKeyForIndex(index) {
  return String(manifest.charge_minutes.values[index]);
}

function basemapEntry() {
  return manifest.basemap.layers.find((l) => l.id === manifest.basemap.default) || manifest.basemap.layers[0];
}

function setupBasemap(entry) {
  tileLayer = L.tileLayer(entry.url, { maxZoom: entry.max_zoom, attribution: entry.attribution });
  tileLayer.addTo(map);
  document.documentElement.style.setProperty("--tile-saturation", manifest.basemap.saturation_percent + "%");
}

function loadImage(key) {
  if (decodedImages.has(key)) return Promise.resolve(decodedImages.get(key));
  const img = new Image();
  img.decoding = "async";
  const loaded = new Promise((resolve, reject) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => reject(new Error(`failed to load ${img.src}`)), { once: true });
  });
  img.src = manifest.layers[key].file;
  return Promise.race([img.decode().catch(() => {}), loaded]).then(() => {
    decodedImages.set(key, img);
    return img;
  });
}

function nextFrame(timeoutMs = 300) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, timeoutMs);
  });
}

async function showLayer(key) {
  const img = await loadImage(key);
  const previous = currentOverlay;

  const next = L.imageOverlay(img.src, manifest.bounds,
                              { opacity: previous ? 0 : 1, interactive: false }).addTo(map);

  if (previous) {
    await nextFrame();
    next.setOpacity(1);
    previous.layer.setOpacity(0);
    setTimeout(() => map.removeLayer(previous.layer), 200);
  }
  currentOverlay = { layer: next, img };
}

function prefetchRemainingLayers() {
  manifest.charge_minutes.values.forEach((minutes) => loadImage(String(minutes)));
}

function setupChargeTimeSlider() {
  const values = manifest.charge_minutes.values;
  const slider = document.getElementById("charge-time");
  slider.max = values.length - 1;

  const ticks = document.getElementById("charge-time-ticks");
  ticks.innerHTML = "";
  values.forEach((minutes) => {
    const span = document.createElement("span");
    span.textContent = `${minutes} min`;
    ticks.appendChild(span);
  });

  function highlightTick(index) {
    [...ticks.children].forEach((span, i) => span.classList.toggle("active", i === index));
  }

  function updateFill(index) {
    const pct = values.length > 1 ? index / (values.length - 1) : 0;
    const thumbRadius = 8;
    const offsetPx = thumbRadius - pct * thumbRadius * 2;
    const sign = offsetPx >= 0 ? "+" : "-";
    slider.style.setProperty("--fill", `calc(${(pct * 100).toFixed(4)}% ${sign} ${Math.abs(offsetPx).toFixed(2)}px)`);
  }

  function selectIndex(index, updateHash) {
    slider.value = index;
    highlightTick(index);
    updateFill(index);
    showLayer(layerKeyForIndex(index));
    if (updateHash) location.hash = layerKeyForIndex(index);
  }

  slider.addEventListener("input", () => selectIndex(Number(slider.value), true));

  const fromHash = values.indexOf(Number(location.hash.replace("#", "")));
  const defaultIndex = values.indexOf(manifest.charge_minutes.default);
  selectIndex(fromHash >= 0 ? fromHash : defaultIndex, false);

  window.addEventListener("hashchange", () => {
    const idx = values.indexOf(Number(location.hash.replace("#", "")));
    if (idx >= 0) selectIndex(idx, false);
  });
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
}

function setupLegend() {
  const [r, g, b] = hexToRgb(manifest.palette.colour);

  const maxAlpha = manifest.palette.max_alpha ?? 1;
  const list = document.getElementById("legend-list");
  list.innerHTML = "";
  manifest.legend.forEach((entry) => {
    const alpha = (entry.step / (manifest.palette.steps - 1)) * maxAlpha;
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    li.appendChild(swatch);
    li.appendChild(document.createTextNode(entry.label));
    list.appendChild(li);
  });
}

const PANEL_COLLAPSE_KEY = "panelCollapsed";
const PANEL_AUTO_COLLAPSE_WIDTH = 640;

function setupPanelToggle() {
  const wrap = document.getElementById("panel-wrap");
  const panel = document.getElementById("panel");
  const tab = document.getElementById("panel-tab");

  function setCollapsed(collapsed) {
    wrap.classList.toggle("collapsed", collapsed);
    tab.setAttribute("aria-expanded", String(!collapsed));
    tab.setAttribute("aria-label", collapsed ? "Expand panel" : "Collapse panel");
    tab.textContent = collapsed ? "›" : "‹";

    if (collapsed) panel.setAttribute("inert", "");
    else panel.removeAttribute("inert");
    localStorage.setItem(PANEL_COLLAPSE_KEY, collapsed ? "1" : "0");
  }

  tab.addEventListener("click", () => setCollapsed(!wrap.classList.contains("collapsed")));

  const stored = localStorage.getItem(PANEL_COLLAPSE_KEY);

  const initiallyCollapsed = stored !== null
    ? stored === "1"
    : window.innerWidth > 0 && window.innerWidth < PANEL_AUTO_COLLAPSE_WIDTH;
  setCollapsed(initiallyCollapsed);
}

function lockNavigationToAustralia(bounds) {
  map.setMaxBounds(bounds.pad(0.1));
  map.options.maxBoundsViscosity = 1.0;
  map.setMinZoom(map.getBoundsZoom(bounds));
}

async function main() {
  const response = await fetch("manifest.json");
  manifest = await response.json();

  const bounds = L.latLngBounds(manifest.bounds);
  map = L.map("map", { preferCanvas: true });
  setupBasemap(basemapEntry());

  map.invalidateSize();
  map.fitBounds(bounds);
  lockNavigationToAustralia(bounds);

  map.setZoom(map.getZoom() + 1);

  map.on("resize", () => lockNavigationToAustralia(bounds));

  setupLegend();
  setupChargeTimeSlider();
  setupPanelToggle();
  prefetchRemainingLayers();
}

main();
