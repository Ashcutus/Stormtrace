(() => {
  "use strict";
  const C = globalThis.StormtraceCore ||= {};
  const fail = () => { throw new C.ProviderError("parse", "cap", "parse"); };
  const children = (node, name) => node.children.filter((n) => n.name === name && n.namespace === node.namespace);
  const text = (node, name) => children(node, name)[0]?.text.trim() || "";
  const texts = (node, name) => children(node, name).map((n) => n.text.trim());
  function parseCAP(xml) {
    let raw;
    try { raw = C.parseXML(xml); } catch { fail(); }
    if (raw.name !== "alert") fail();
    const namespace = raw.namespace;
    if (namespace && !["urn:oasis:names:tc:emergency:cap:1.1", "urn:oasis:names:tc:emergency:cap:1.2"].includes(namespace)) throw new C.ProviderError("unsupported_schema", "cap", "parse");
    const diagnostics = [];
    function time(node, field) { const value = text(node, field); if (!value) return null; const t = Date.parse(value); if (!Number.isFinite(t) || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) { diagnostics.push(`Invalid ${field}`); return null; } return t; }
    function fields(node, names) { return Object.fromEntries(names.map((name) => [name, text(node, name)])); }
    function pair(node) { return { valueName: text(node, "valueName"), value: text(node, "value") }; }
    function area(node) {
      const geometries = [], circles = [];
      for (const p of texts(node, "polygon")) {
        const points = p.split(/\s+/).map((s) => { const parts = s.split(","); return parts.length === 2 && parts.every((x) => x.trim() !== "") ? parts.map(Number).reverse() : [NaN, NaN]; });
        if (points.length >= 3 && points.every((p) => p.every(Number.isFinite)) && JSON.stringify(points[0]) !== JSON.stringify(points.at(-1))) { points.push([...points[0]]); diagnostics.push("Closed unclosed CAP polygon"); }
        const geometry = C.normalizeGeometry({ type: "Polygon", coordinates: [points] });
        if (geometry) geometries.push(geometry); else diagnostics.push("Invalid CAP polygon");
      }
      for (const value of texts(node, "circle")) {
        const match = value.match(/^\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/);
        const centre = match && [Number(match[2]), Number(match[1])];
        if (centre && C.normalizeGeometry({ type: "Point", coordinates: centre })) circles.push({ centre, radiusKm: Number(match[3]) });
        else diagnostics.push("Invalid CAP circle");
      }
      return { areaDesc: text(node, "areaDesc"), geometries, circles, geocodes: children(node, "geocode").map(pair), altitude: text(node, "altitude"), ceiling: text(node, "ceiling"), raw: node };
    }
    const result = { ...fields(raw, ["identifier", "sender", "status", "msgType", "scope", "source", "restriction", "addresses", "incidents"]), sent: time(raw, "sent"), references: [], info: [], diagnostics, raw };
    if (!result.identifier || !result.sender || result.sent == null) diagnostics.push("Missing or invalid CAP identity/sent");
    for (const ref of text(raw, "references").split(/\s+/).filter(Boolean)) {
      const parts = ref.split(",");
      const sent = Date.parse(parts[2]);
      if (parts.length === 3 && parts[0] && parts[1] && Number.isFinite(sent)) result.references.push({ sender: parts[0], identifier: parts[1], sent });
      else diagnostics.push("Invalid CAP reference");
    }
    result.info = children(raw, "info").map((node) => ({
      ...fields(node, ["language", "event", "urgency", "severity", "certainty", "senderName", "headline", "description", "instruction", "web", "contact", "audience"]),
      categories: texts(node, "category"), responseTypes: texts(node, "responseType"), effective: time(node, "effective"), onset: time(node, "onset"), expires: time(node, "expires"),
      eventCodes: children(node, "eventCode").map(pair), parameters: children(node, "parameter").map(pair), areas: children(node, "area").map(area), resources: children(node, "resource"), raw: node,
    }));
    return result;
  }
  Object.assign(C, { parseCAP });
})();
