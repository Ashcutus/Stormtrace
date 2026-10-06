(() => {
  "use strict";
  const C = globalThis.StormtraceCore ||= {};
  const fail = () => { throw new C.ProviderError("parse", "xml", "parse"); };
  // Bounded XML interchange subset: no DTD, entity expansion or external resources.
  // Namespace-qualified names, attributes, comments, CDATA and XML declarations are retained.
  function parseXML(xml) {
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
  Object.assign(C, { parseXML });
})();
