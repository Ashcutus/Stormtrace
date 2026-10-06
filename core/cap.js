(() => {
  "use strict";
  const C = globalThis.StormtraceCore ||= {};
  const fail = () => { throw new C.ProviderError("parse", "cap", "parse"); };
  // Deliberately bounded XML subset: no DTD, entity expansion or external resources.
  // Namespace-qualified names, attributes, comments, CDATA and XML declarations are retained.
  function xmlTree(xml) {
    if (typeof xml !== "string" || xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) fail();
    const root = { name: "#document", children: [], text: "", attributes: {} };
    const stack = [root]; let offset = 0, nodes = 0;
    root.namespaces = { xml: "http://www.w3.org/XML/1998/namespace" };
    function decode(text) {
      return text.replace(/&([^;\s]+);/g, (_, entity) => {
        const predefined = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
        if (Object.hasOwn(predefined, entity)) return predefined[entity];
        if (!/^#(?:\d+|x[\da-fA-F]+)$/.test(entity)) fail();
        const n = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) fail();
        return String.fromCodePoint(n);
      });
    }
    const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/[\w.:-]+\s*>|<[\w.:-]+(?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>|[^<]+/g;
    for (const match of xml.matchAll(tokens)) {
      if (match.index !== offset) fail();
      offset += match[0].length;
      const token = match[0];
      if (token.startsWith("<!--") || token.startsWith("<?")) continue;
      if (token.startsWith("<![CDATA[")) { stack.at(-1).text += token.slice(9, -3); continue; }
      if (token.startsWith("</")) { if (stack.length === 1 || stack.at(-1).qualifiedName !== token.slice(2, -1).trim()) fail(); stack.pop(); continue; }
      if (token.startsWith("<")) {
        const qualifiedName = token.match(/^<([\w.:-]+)/)[1];
        const node = { name: qualifiedName.split(":").at(-1), qualifiedName, children: [], text: "", attributes: {} };
        for (const attr of token.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
          if (Object.hasOwn(node.attributes, attr[1])) fail();
          node.attributes[attr[1]] = decode(attr[2] ?? attr[3]);
        }
        const bindings = { ...stack.at(-1).namespaces };
        for (const [name, value] of Object.entries(node.attributes)) {
          if (name === "xmlns") bindings[""] = value;
          else if (name.startsWith("xmlns:")) bindings[name.slice(6)] = value;
        }
        const prefix = qualifiedName.includes(":") ? qualifiedName.split(":")[0] : "";
        if (prefix && !Object.hasOwn(bindings, prefix)) fail();
        node.namespaces = bindings; node.namespace = bindings[prefix] || "";
        stack.at(-1).children.push(node);
        if (++nodes > 20000 || stack.length > 64) fail();
        if (!token.endsWith("/>")) stack.push(node);
      } else {
        if (/&(?!(?:[\w#]+);)/.test(token)) fail();
        stack.at(-1).text += decode(token);
      }
    }
    if (offset !== xml.length || stack.length !== 1 || root.children.length !== 1 || root.text.trim()) fail();
    return root.children[0];
  }
  const children = (node, name) => node.children.filter((n) => n.name === name && n.namespace === node.namespace);
  const text = (node, name) => children(node, name)[0]?.text.trim() || "";
  const texts = (node, name) => children(node, name).map((n) => n.text.trim());
  function parseCAP(xml) {
    const raw = xmlTree(xml);
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
