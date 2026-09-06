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
