import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import core from "./core/index.js";
import "./providers/lightning.js";
import { readLocalKey, readLocalSetting, readOmarchyTheme, radarWorker } from "./platform/node.js";

import { MetOfficeRadarProvider } from "./providers/metoffice-radar.js";
import { MetOfficeWarningsProvider } from "./providers/metoffice-warnings.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const HOST = process.env.STORMTRACE_HOST || "127.0.0.1";
const PORT = Number(process.env.STORMTRACE_PORT || 4177);
const API_KEY = process.env.LIGHTNING_API_KEY || readLocalKey(ROOT);
const APP_VERSION = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8")).version;
const UPDATE_MANIFEST_URL = process.env.STORMTRACE_UPDATE_MANIFEST_URL
  || "https://raw.githubusercontent.com/Ashcutus/Stormtrace/main/manifest.json";
const REPOSITORY_URL = "https://github.com/Ashcutus/Stormtrace";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

export function createStormtraceServer({ radarProvider = new MetOfficeRadarProvider({ worker: (operation, key) => radarWorker(ROOT, operation, key) }), warningsProvider = new MetOfficeWarningsProvider({ apiKey: readLocalSetting(ROOT, "METOFFICE_WARNINGS_API_KEY"), log: (entry) => console.info(JSON.stringify(entry)) }) } = {}) {
  return createServer((request, response) => {
    handleRequest(request, response, warningsProvider, radarProvider).catch((error) => {
      console.error(`Request failed: ${error.message}`);
      if (!response.headersSent) json(response, 500, { error: "Internal server error" });
      else response.destroy();
    });
  });
}

async function handleRequest(request, response, warningsProvider, radarProvider) {
  let url;
  try {
    url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
  } catch {
    return json(response, 400, { error: "Invalid request URL" });
  }

  if (url.pathname === "/api/health") {
    return json(response, 200, {
      ok: true,
      app: "stormtrace",
      version: APP_VERSION,
      root: ROOT,
      pid: process.pid,
      historyProvider: Boolean(API_KEY),
    });
  }

  if (url.pathname === "/api/update") {
    return checkForUpdate(response);
  }

  if (url.pathname === "/api/history") {
    return proxyHistory(url, response);
  }

  if (url.pathname === "/api/radar" || url.pathname === "/api/radar/frame") {
    try {
      if (url.pathname === "/api/radar") return json(response, 200, await radarProvider.frames());
      const image = await radarProvider.image(url.searchParams.get("key"));
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" });
      return response.end(image);
    } catch (error) {
      const typed = core.providerError(error, "metoffice-radar", "frames");
      return json(response, 502, { providerError: typed.toJSON(), health: { ...radarProvider.health, lastError: typed.toJSON() } });
    }
  }

  if (url.pathname === "/api/warnings") {
    if (!warningsProvider.apiKey) return json(response, 200, { configured: false, records: [], observations: [], health: { ...warningsProvider.health, freshness: "unavailable" } });
    try {
      const result = await warningsProvider.current();
      return json(response, 200, { configured: true, ...result });
    } catch (error) {
      const typed = core.providerError(error, "metoffice-warnings", "current");
      return json(response, 502, { configured: true, providerError: typed.toJSON(), health: { ...warningsProvider.health, freshness: core.freshness(warningsProvider.health) } });
    }
  }

  if (url.pathname === "/api/theme") {
    return json(response, 200, readOmarchyTheme());
  }

  let pathname;
  try {
    pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  } catch {
    return json(response, 400, { error: "Invalid request path" });
  }
  // Keys live in .env; hidden files must never be served as application assets.
  if (pathname.split("/").some((part) => part.startsWith("."))) return json(response, 404, { error: "Not found" });
  const filePath = resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${resolve(ROOT)}${sep}`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return json(response, 404, { error: "Not found" });
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://tiles.openfreemap.org",
      "connect-src 'self' wss://live2.lightningmaps.org https://nominatim.openstreetmap.org https://tiles.openfreemap.org",
      "font-src 'self'",
      "worker-src 'self' blob:",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "geolocation=(self)",
  });
  const stream = createReadStream(filePath);
  stream.on("error", (error) => {
    console.error(`Static file read failed: ${error.message}`);
    response.destroy();
  });
  stream.pipe(response);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createStormtraceServer().listen(PORT, HOST, () => {
    console.log(`Stormtrace ready at http://${HOST}:${PORT}`);
    console.log(API_KEY ? "Historical API backfill enabled." : "Using local rolling history (no LIGHTNING_API_KEY set)." );
  });
}

const historyProvider = new core.LightningHistoryProvider({ apiKey: API_KEY, log: (entry) => console.info(JSON.stringify(entry)) });

async function proxyHistory(url, response) {
  if (!API_KEY) return json(response, 200, { configured: false, flashes: [] });
  try {
    const result = await historyProvider.history(url.searchParams.get("since_minutes") || 1440);
    return json(response, 200, { configured: true, flashes: result.records, health: result.health });
  } catch (error) {
    const status = error.status || 502;
    return json(response, status, { configured: true, error: error.status ? `History provider returned ${error.status}` : "The history provider could not be reached.", providerError: error.toJSON(), health: { ...historyProvider.health, freshness: core.freshness(historyProvider.health) } });
  }
}

export const normalizeHistoryFlashes = core.normalizeHistoryFlashes;

async function checkForUpdate(response) {
  try {
    const upstream = await fetch(UPDATE_MANIFEST_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": `Stormtrace/${APP_VERSION}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) throw new Error(`Update source returned ${upstream.status}`);

    const manifest = await upstream.json();
    const latestVersion = normalizeVersion(manifest.version);
    if (!latestVersion) throw new Error("Published manifest has an invalid version");

    const comparison = compareVersions(latestVersion, APP_VERSION);
    return json(response, 200, {
      ok: true,
      currentVersion: APP_VERSION,
      latestVersion,
      updateAvailable: comparison > 0,
      developmentBuild: comparison < 0,
      repositoryUrl: REPOSITORY_URL,
    });
  } catch (error) {
    console.error(`Update check failed: ${error.message}`);
    return json(response, 502, {
      ok: false,
      currentVersion: APP_VERSION,
      error: "The published version could not be checked right now.",
    });
  }
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function normalizeVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number).join(".") : "";
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}
