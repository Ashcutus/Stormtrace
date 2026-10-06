(() => {
  "use strict";
  const C = globalThis.StormtraceCore ||= {};
  const position = (p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const line = (v) => Array.isArray(v) && v.length >= 2 && v.every(position);
  const ring = (v) => line(v) && v.length >= 4 && equal(v[0], v.at(-1));
  const polygon = (v) => Array.isArray(v) && v.length > 0 && v.every(ring);
  function normalizeGeometry(input) {
    try {
      const g = typeof input === "string" ? JSON.parse(input) : input;
      const checks = { Point: position, LineString: line, MultiLineString: (v) => Array.isArray(v) && v.length > 0 && v.every(line), Polygon: polygon, MultiPolygon: (v) => Array.isArray(v) && v.length > 0 && v.every(polygon) };
      if (!g || !Object.hasOwn(checks, g.type) || !checks[g.type](g.coordinates)) return null;
      return JSON.parse(JSON.stringify({ type: g.type, coordinates: g.coordinates }));
    } catch { return null; }
  }
  function positions(g) {
    const result = [];
    function walk(v) { if (typeof v[0] === "number") result.push(v); else v.forEach(walk); }
    walk(g.coordinates); return result;
  }
  function geometryBounds(input) {
    const g = normalizeGeometry(input); if (!g) return null;
    const ps = positions(g);
    return ps.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [180, 90, -180, -90]);
  }
  function inRing(point, ring) {
    // Unwrap around the query longitude, including antimeridian crossings.
    const pts = [];
    for (const [x, y] of ring) {
      const previous = pts.at(-1)?.[0] ?? x;
      pts.push([previous + ((x - previous + 540) % 360 - 180), y]);
    }
    const centre = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
    point = [centre + ((point[0] - centre + 540) % 360 - 180), point[1]];
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [x, y] = pts[i], [xx, yy] = pts[j];
      const cross = (point[0] - x) * (yy - y) - (point[1] - y) * (xx - x);
      if (Math.abs(cross) < 1e-10 && point[0] >= Math.min(x, xx) && point[0] <= Math.max(x, xx) && point[1] >= Math.min(y, yy) && point[1] <= Math.max(y, yy)) return true;
      if ((y > point[1]) !== (yy > point[1]) && point[0] < (xx - x) * (point[1] - y) / (yy - y) + x) inside = !inside;
    }
    return inside;
  }
  function pointInPolygon(point, input) {
    const g = normalizeGeometry(input);
    if (!position(point) || !g || !["Polygon", "MultiPolygon"].includes(g.type)) return false;
    return (g.type === "Polygon" ? [g.coordinates] : g.coordinates).some((rings) => inRing(point, rings[0]) && !rings.slice(1).some((r) => inRing(point, r)));
  }
  function distanceKm(a, b) {
    if (!position(a) || !position(b)) return null;
    const rad = (v) => v * Math.PI / 180;
    const v = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
    return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, v))));
  }
  function geometryFeature(geometry, properties = {}) { const g = normalizeGeometry(geometry); return g ? { type: "Feature", geometry: g, properties } : null; }
  Object.assign(C, { normalizeGeometry, geometryBounds, pointInPolygon, distanceKm, geometryFeature });
})();
