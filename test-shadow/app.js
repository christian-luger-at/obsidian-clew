import Graph from "https://cdn.jsdelivr.net/npm/graphology@0.25.4/+esm";
import Sigma from "https://cdn.jsdelivr.net/npm/sigma@3.0.2/+esm";

const selected = new Set(["a", "b", "c", "d", "e", "f", "g"]);
const nodes = [
  ["a", -4.5,  2.3], ["b", -1.5, 3.4], ["c", 1.6, 2.4], ["d", 2.6, -.6],
  ["e", -.2, -.3], ["f", -2.8, -2.2], ["g", -5, -.8], ["h", 5.2, 3.3], ["i", 4.8, -3.1],
];
const edges = [["a","b"],["b","c"],["c","d"],["d","e"],["e","f"],["f","g"],["g","a"],["e","b"],["c","h"],["d","i"]];
const BLUE = "29, 78, 216";

function makeGraph({ dimOthers = false } = {}) {
  const graph = new Graph();
  nodes.forEach(([id, x, y]) => graph.addNode(id, {
    x, y, label: id.toUpperCase(), size: selected.has(id) ? 11 : 9,
    color: selected.has(id) ? "#1d4ed8" : dimOthers ? "#d9e0ea" : "#95a1b5",
  }));
  edges.forEach(([source, target]) => graph.addEdge(source, target, { color: "#d0d8e5", size: 1.4 }));
  return graph;
}

function hull(points) {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
  const half = [];
  for (const point of sorted) { while (half.length > 1 && cross(half.at(-2), half.at(-1), point) <= 0) half.pop(); half.push(point); }
  const lower = half;
  const upper = [];
  for (const point of sorted.reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function polygon(context, points) {
  context.beginPath(); context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((p) => context.lineTo(p.x, p.y)); context.closePath();
}

// Erzeugt für jede Variante Graph + Overlay und hält das Overlay synchron zur Sigma-Kamera.
function mount(id, draw, graphOptions) {
  const container = document.getElementById(id);
  const layer = document.createElement("canvas");
  layer.className = "group-layer";
  container.appendChild(layer);
  const graph = makeGraph(graphOptions);
  const sigma = new Sigma(graph, container, { labelRenderedSizeThreshold: 0, renderEdgeLabels: false });
  let pending = false;
  const redraw = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const box = container.getBoundingClientRect(); const dpr = devicePixelRatio || 1;
      layer.width = Math.ceil(box.width * dpr); layer.height = Math.ceil(box.height * dpr);
      layer.style.width = `${box.width}px`; layer.style.height = `${box.height}px`;
      const context = layer.getContext("2d");
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, box.width, box.height);
      // Genau hier: Graphology-Koordinaten -> Sigma-Viewport-Koordinaten.
      const points = [...selected].map((id) => {
        const { x, y } = graph.getNodeAttributes(id);
        return sigma.graphToViewport({ x, y });
      });
      draw(context, points, box.width, box.height);
    });
  };
  sigma.getCamera().on("updated", redraw);
  sigma.on("afterRender", redraw);
  new ResizeObserver(redraw).observe(container);
  redraw();
}

// 1: Eine quadratische Kurve über die Hull-Mittelpunkte ergibt einen weichen, geschlossenen Pfad.
mount("smooth", (context, points) => {
  const pointsOnHull = hull(points);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  context.beginPath();
  context.moveTo(midpoint(pointsOnHull.at(-1), pointsOnHull[0]).x, midpoint(pointsOnHull.at(-1), pointsOnHull[0]).y);
  pointsOnHull.forEach((point, i) => { const next = pointsOnHull[(i + 1) % pointsOnHull.length]; const middle = midpoint(point, next); context.quadraticCurveTo(point.x, point.y, middle.x, middle.y); });
  context.closePath(); context.fillStyle = `rgba(${BLUE}, .11)`; context.fill();
  context.lineWidth = 3; context.strokeStyle = `rgba(${BLUE}, .88)`; context.stroke();
});

// 2: Feld aus Gauß-Glocken; die sichtbare Fläche ist die Isolinie field >= cutoff.
mount("metaballs", (context, points, width, height) => {
  const radius = 48, cutoff = .22, step = 3;
  const field = (x, y) => points.reduce((sum, p) => sum + Math.exp(-((x-p.x)**2 + (y-p.y)**2) / (2 * radius**2)), 0);
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const value = field(x + step / 2, y + step / 2);
    if (value >= cutoff) { context.fillStyle = `rgba(${BLUE}, ${Math.min(.17, .055 + value * .06)})`; context.fillRect(x, y, step + .4, step + .4); }
  }
  // Weicher Rand über die Grenzzellen; kein zweites Shape-Modell erforderlich.
  context.strokeStyle = `rgba(${BLUE}, .72)`; context.lineWidth = 2;
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    if (field(x + step/2, y + step/2) < cutoff) continue;
    context.beginPath();
    if (field(x + step/2, y - step/2) < cutoff) { context.moveTo(x, y); context.lineTo(x + step, y); }
    if (field(x + step*1.5, y + step/2) < cutoff) { context.moveTo(x+step, y); context.lineTo(x+step, y+step); }
    if (field(x + step/2, y + step*1.5) < cutoff) { context.moveTo(x, y+step); context.lineTo(x+step, y+step); }
    if (field(x - step/2, y + step/2) < cutoff) { context.moveTo(x, y); context.lineTo(x, y+step); }
    context.stroke();
  }
});

// 3: Aufgepolsterte Hull: breiter, halbtransparenter Strich + dezente Füllung.
mount("rounded", (context, points) => {
  polygon(context, hull(points)); context.fillStyle = `rgba(${BLUE}, .07)`; context.fill();
  context.lineWidth = 28; context.lineJoin = "round"; context.strokeStyle = `rgba(${BLUE}, .16)`; context.stroke();
  context.lineWidth = 2; context.strokeStyle = `rgba(${BLUE}, .82)`; context.stroke();
});

// 4: Die Reihenfolge der ausgewählten Nodes beschreibt hier bewusst eine eingezogene,
// einfache Kontur. In echten Daten kann diese Reihenfolge z. B. aus einem Pfad oder
// einer Community-Grenze kommen – ohne zusätzliche Laufzeit-Abhängigkeit.
mount("concave", (context, points) => {
  polygon(context, points); context.fillStyle = `rgba(${BLUE}, .11)`; context.fill();
  context.lineWidth = 2.5; context.lineJoin = "round"; context.strokeStyle = `rgba(${BLUE}, .9)`; context.stroke();
});

// 5: Die gleiche Hull als reiner Rahmen – ohne farbige Fläche über Kanten und Nodes.
mount("outline", (context, points) => {
  polygon(context, hull(points)); context.lineWidth = 3; context.lineJoin = "round";
  context.setLineDash([8, 6]); context.strokeStyle = `rgba(${BLUE}, .88)`; context.stroke(); context.setLineDash([]);
});

// 6: Die klassische Gruppenbox. Besonders lesbar, wenn das Layout ohnehin rasterartig ist.
mount("box", (context, points) => {
  const pad = 22, xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  const width = Math.max(...xs) - Math.min(...xs) + 2 * pad, height = Math.max(...ys) - Math.min(...ys) + 2 * pad;
  context.fillStyle = `rgba(${BLUE}, .08)`; context.strokeStyle = `rgba(${BLUE}, .78)`; context.lineWidth = 2;
  context.beginPath(); context.roundRect(x, y, width, height, 18); context.fill(); context.stroke();
});

// 7: Ellipse über dem Bounding-Box-Bereich; absichtlich weniger exakt als eine Hull.
mount("ellipse", (context, points) => {
  const pad = 20, xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const left = Math.min(...xs) - pad, top = Math.min(...ys) - pad;
  const width = Math.max(...xs) - Math.min(...xs) + 2 * pad, height = Math.max(...ys) - Math.min(...ys) + 2 * pad;
  context.beginPath(); context.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  context.fillStyle = `rgba(${BLUE}, .08)`; context.fill(); context.lineWidth = 2; context.strokeStyle = `rgba(${BLUE}, .8)`; context.stroke();
});

// 8: Ein breiter Pfad mit runden Enden ist die einfachste "Kapsel" um einen Ablauf.
mount("capsule", (context, points) => {
  const order = ["a", "b", "c", "d", "e", "f", "g"];
  const byId = Object.fromEntries([...selected].map((id, i) => [id, points[i]]));
  context.beginPath(); context.moveTo(byId[order[0]].x, byId[order[0]].y);
  order.slice(1).forEach((id) => context.lineTo(byId[id].x, byId[id].y));
  context.lineCap = "round"; context.lineJoin = "round"; context.lineWidth = 34; context.strokeStyle = `rgba(${BLUE}, .14)`; context.stroke();
  context.lineWidth = 3; context.strokeStyle = `rgba(${BLUE}, .76)`; context.stroke(); context.lineCap = "butt";
});

// 9: Kein äußerer Umriss: Stattdessen erhalten nur interne Gruppen-Kanten einen breiten Hintergrundstrich.
mount("edge-envelope", (context, points) => {
  const byId = Object.fromEntries([...selected].map((id, i) => [id, points[i]]));
  const internalEdges = edges.filter(([from, to]) => selected.has(from) && selected.has(to));
  context.lineCap = "round"; context.lineJoin = "round"; context.lineWidth = 24; context.strokeStyle = `rgba(${BLUE}, .13)`;
  internalEdges.forEach(([from, to]) => { context.beginPath(); context.moveTo(byId[from].x, byId[from].y); context.lineTo(byId[to].x, byId[to].y); context.stroke(); });
  context.lineCap = "butt";
});

// 10: Ein additiver Farbwert pro Pixel. Anders als Metaballs wird hier nicht abgeschnitten.
mount("heatmap", (context, points, width, height) => {
  const radius = 58, step = 4;
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const density = points.reduce((sum, p) => sum + Math.exp(-((x-p.x)**2 + (y-p.y)**2) / (2 * radius**2)), 0);
    if (density > .025) { context.fillStyle = `rgba(37, 99, 235, ${Math.min(.30, density * .115)})`; context.fillRect(x, y, step + .5, step + .5); }
  }
});

// 11: Diskrete Voronoi-Zellen: Jeder Bildpunkt erhält die Farbe des nächstgelegenen ausgewählten Nodes.
mount("voronoi", (context, points, width, height) => {
  const step = 4;
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const distances = points.map((p) => (x-p.x)**2 + (y-p.y)**2);
    const nearest = Math.min(...distances), index = distances.indexOf(nearest);
    const color = ["37,99,235", "14,116,144", "79,70,229", "8,145,178", "30,64,175", "67,56,202", "3,105,161"][index];
    if (nearest < 58 ** 2) { context.fillStyle = `rgba(${color}, .13)`; context.fillRect(x, y, step - .5, step - .5); }
  }
});

// 12: Die Gruppe bleibt unverdeckt; nur eine Klammer und ein Label zeigen ihre Zugehörigkeit an.
mount("bracket", (context, points) => {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs) - 28, top = Math.min(...ys) - 18, bottom = Math.max(...ys) + 18;
  context.strokeStyle = `rgba(${BLUE}, .9)`; context.lineWidth = 3; context.beginPath();
  context.moveTo(x + 14, top); context.lineTo(x, top); context.lineTo(x, bottom); context.lineTo(x + 14, bottom); context.stroke();
  context.fillStyle = `rgb(${BLUE})`; context.font = "600 12px system-ui"; context.fillText("Gruppe A", x - 4, top - 8);
});

// 13: Halos an den Gruppen-Nodes. Die dunklere Umgebung übernimmt das "Dimmen" der Nicht-Gruppe.
mount("halo", (context, points) => {
  points.forEach((p) => {
    const gradient = context.createRadialGradient(p.x, p.y, 4, p.x, p.y, 34);
    gradient.addColorStop(0, "rgba(37,99,235,.26)"); gradient.addColorStop(1, "rgba(37,99,235,0)");
    context.fillStyle = gradient; context.beginPath(); context.arc(p.x, p.y, 34, 0, Math.PI * 2); context.fill();
  });
}, { dimOthers: true });

// 14: Hierarchie-Ansicht: der komplette Subgraph wird durch einen "Group A"-Knoten ersetzt.
function mountClusterNode() {
  const container = document.getElementById("cluster-node");
  const graph = new Graph();
  graph.addNode("group", { x: -1.5, y: 0, size: 32, label: "Gruppe A · 7", color: "#1d4ed8" });
  graph.addNode("h", { x: 3.8, y: 2.4, size: 12, label: "H", color: "#95a1b5" });
  graph.addNode("i", { x: 4.2, y: -2.5, size: 12, label: "I", color: "#95a1b5" });
  graph.addEdge("group", "h", { color: "#b8c6db", size: 2 }); graph.addEdge("group", "i", { color: "#b8c6db", size: 2 });
  new Sigma(graph, container, { labelRenderedSizeThreshold: 0, renderEdgeLabels: false });
}
mountClusterNode();
