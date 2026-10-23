import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/app-harness.js";

const theme = (name, accent) => ({ available: true, name, colors: { accent } });

test("system palette changes apply live and recover from transient failures", async () => {
  let payload = theme("First", "#123456");
  let fail = false;
  const app = loadApp({ fetch: async () => {
    if (fail) throw new Error("Temporary failure");
    return { ok: true, json: async () => payload };
  } });
  await app.refreshOmarchyTheme();
  assert.equal(app.state.activePalette.violet, "#123456");
  fail = true;
  await app.refreshOmarchyTheme();
  assert.equal(app.state.activePalette.violet, "#123456");
  fail = false;
  await app.refreshOmarchyTheme();
  assert.equal(app.state.activePalette.violet, "#123456");
  payload = { available: false };
  await app.refreshOmarchyTheme();
  assert.equal(app.state.activePalette.violet, "#123456");
  payload = theme("Second", "#abcdef");
  await app.refreshOmarchyTheme();
  assert.equal(app.state.activePalette.violet, "#abcdef");
  assert.equal(app.els.currentThemeName.textContent, "Second");
});

test("system updates preserve the custom palette", async () => {
  const app = loadApp({ fetch: async () => ({ ok: true, json: async () => theme("New", "#abcdef") }) });
  app.state.themeSource = "custom";
  app.state.customPalette = { violet: "#112233" };
  await app.refreshOmarchyTheme();
  assert.equal(app.state.activePalette.violet, "#112233");
  assert.equal(app.state.systemPalette.violet, "#abcdef");
});

test("a stalled theme request times out and allows another refresh", async () => {
  let calls = 0;
  const app = loadApp({ fetch: async (_url, { signal }) => {
    calls++;
    if (calls > 1) return { ok: true, json: async () => theme("Recovered", "#abcdef") };
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Aborted"))));
  } });
  const pending = app.refreshOmarchyTheme();
  await app.refreshOmarchyTheme();
  assert.equal(calls, 1);
  app.advance(5000);
  await pending;
  assert.equal(app.state.themeRefreshing, false);
  await app.refreshOmarchyTheme();
  assert.equal(app.state.activePalette.violet, "#abcdef");
});

// WCAG contrast, independent of the app's helpers.
const luminance = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); const max = Math.max(r, g, b), min = Math.min(r, g, b); if (max === min) return null; const d = max - min; const h = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d; return ((h * 60) + 360) % 360; };
const dark = { available: true, name: "Tokyo Night", mode: "dark", colors: { darker_background: "#16161e", dark_background: "#1a1b26", background: "#1f2335", lighter_background: "#292e42", foreground: "#c0caf5", muted: "#787c99", dark_foreground: "#565f89", accent: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", blue: "#7aa2f7", yellow: "#e0af68", red: "#f7768e", selection: "#33467c" } };
const light = { available: true, name: "Rosé Pine Dawn", mode: "light", colors: { darker_background: "#f2e9e1", dark_background: "#faf4ed", background: "#fffaf3", lighter_background: "#f4ede8", foreground: "#575279", muted: "#9893a5", dark_foreground: "#797593", accent: "#907aa9", magenta: "#907aa9", cyan: "#56949f", blue: "#286983", yellow: "#ea9d34", red: "#b4637a", selection: "#dfdad9" } };

test("light or dark mode builds a readable counterpart of the Omarchy theme that keeps its accents", async () => {
  for (const [payload, mode] of [[dark, "light"], [light, "dark"]]) {
    const app = loadApp({ fetch: async () => ({ ok: true, json: async () => payload }) });
    await app.refreshOmarchyTheme();
    const original = { ...app.state.systemPalette };
    app.state.themeMode = mode; app.applyActivePalette();
    const p = app.state.activePalette;
    assert.equal(p.mode, mode); assert.equal(p.name, payload.name);
    assert.ok(mode === "light" ? luminance(p.bg) > 0.8 : luminance(p.bg) < 0.03, `${mode} background`);
    assert.ok(contrast(p.text, p.bg) >= 10, "body text");
    assert.ok(contrast(p.muted, p.bg) >= 4.5, "muted text");
    for (const key of ["violet", "magenta", "cyan", "danger"]) {
      assert.ok(contrast(p[key], p.bg) >= 3.4, `${key} readable`);
      assert.ok(Math.abs(((hue(p[key]) - hue(original[key]) + 540) % 360) - 180) < 25, `${key} keeps its hue`);
    }
    assert.ok(mode === "light" ? luminance(p.surface3) < luminance(p.bg) : luminance(p.surface3) > luminance(p.bg), "raised surfaces separate from the background");
    // Following Omarchy, or asking for the mode it already has, leaves the theme untouched.
    app.state.themeMode = "auto"; app.applyActivePalette(); assert.deepEqual({ ...app.state.activePalette }, original);
    assert.equal(app.modePalette(app.state.systemPalette, payload.mode), app.state.systemPalette);
  }
});

test("the light or dark choice persists, ignores unknown values and leaves custom colours alone", async () => {
  const saved = new Map([["stormtrace:settings", JSON.stringify({ themeMode: "light" })]]);
  const storage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  const app = loadApp({ storage, fetch: async () => ({ ok: true, json: async () => dark }) });
  assert.equal(app.state.themeMode, "light");
  await app.refreshOmarchyTheme();
  // Choosing a mode in Appearance applies and saves it.
  app.bindControls(); app.elements.get('#themeMode').listeners.change({ target: { value: "dark" } });
  assert.equal(app.state.activePalette.mode, "dark"); assert.equal(JSON.parse(saved.get("stormtrace:settings")).themeMode, "dark");
  app.elements.get('#themeMode').listeners.change({ target: { value: "light" } });
  assert.equal(app.state.activePalette.mode, "light");
  // Starting custom colours from Omarchy starts from what is on screen.
  app.els.resetCustomTheme.click(); assert.equal(app.state.customPalette.bg, app.modePalette(app.state.systemPalette, "light").bg);
  app.state.themeSource = "system"; app.applyActivePalette();
  app.saveSettings(); assert.equal(JSON.parse(saved.get("stormtrace:settings")).themeMode, "light");
  app.state.themeSource = "custom"; app.state.customPalette = { bg: "#101010", text: "#eeeeee" }; app.applyActivePalette();
  assert.equal(app.state.activePalette.mode, "dark", "custom colours set their own mode");
  saved.set("stormtrace:settings", JSON.stringify({ themeMode: "sepia" }));
  assert.equal(loadApp({ storage }).state.themeMode, "auto");
});
