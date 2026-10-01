import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const HOST = process.env.STORMTRACE_HOST || "127.0.0.1";
const PORT = Number(process.env.STORMTRACE_PORT || 4177);
const API_KEY = process.env.LIGHTNING_API_KEY || readLocalKey();
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

export function createStormtraceServer() {
  return createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(`Request failed: ${error.message}`);
      if (!response.headersSent) json(response, 500, { error: "Internal server error" });
      else response.destroy();
    });
  });
}

async function handleRequest(request, response) {
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

  if (url.pathname === "/api/theme") {
    return json(response, 200, readOmarchyTheme());
  }

  let pathname;
  try {
    pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  } catch {
    return json(response, 400, { error: "Invalid request path" });
  }
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
      "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
      "connect-src 'self' wss://live2.lightningmaps.org https://nominatim.openstreetmap.org",
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

async function proxyHistory(url, response) {
  if (!API_KEY) return json(response, 200, { configured: false, flashes: [] });
  const requestedMinutes = clamp(Number(url.searchParams.get("since_minutes") || 1440), 1, 1440);
  try {
    const upstream = await fetch(`https://api.lightningapi.dev/v1/flashes?since_minutes=${requestedMinutes}&limit=20000`, {
      headers: { "X-API-Key": API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return json(response, upstream.status, { configured: true, error: `History provider returned ${upstream.status}` });
    }
    const flashes = normalizeHistoryFlashes(payload.flashes);
    return json(response, 200, { configured: true, flashes });
  } catch {
    return json(response, 502, { configured: true, error: "The history provider could not be reached." });
  }
}

export function normalizeHistoryFlashes(input) {
  if (!Array.isArray(input)) return [];
  return input.map((flash) => {
    const timestamp = String(flash?.flash_timestamp_utc || "");
    if (flash?.flash_id == null || flash?.lat == null || flash?.lon == null) return null;
    return {
      id: `provider:${flash?.flash_id}`,
      time: Date.parse(`${timestamp}${timestamp.endsWith("Z") || /[+-]\d\d:\d\d$/.test(timestamp) ? "" : "Z"}`),
      lat: Number(flash?.lat),
      lon: Number(flash?.lon),
      polarity: 0,
      deviation: 0,
    };
  }).filter((flash) => flash
    && Number.isFinite(flash.time) && Number.isFinite(flash.lat) && Number.isFinite(flash.lon)
    && Math.abs(flash.lat) <= 90 && Math.abs(flash.lon) <= 180);
}

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
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

function readLocalKey() {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return "";
  const line = readFileSync(envPath, "utf8").split(/\r?\n/).find((item) => item.startsWith("LIGHTNING_API_KEY="));
  return line ? line.slice("LIGHTNING_API_KEY=".length).trim() : "";
}

function readOmarchyTheme() {
  try {
    const name = execFileSync("omarchy", ["theme", "current"], { encoding: "utf8", timeout: 2000 }).trim();
    const output = execFileSync("omarchy", ["theme", "color", "--all"], { encoding: "utf8", timeout: 2000 });
    const colors = Object.fromEntries(output.split(/\r?\n/).filter(Boolean).map((line) => {
      const split = line.indexOf("\t");
      return split > 0 ? [line.slice(0, split), line.slice(split + 1)] : [line, ""];
    }));
    return { available: true, name: name || "Omarchy", mode: colors.mode || "dark", colors };
  } catch {
    return { available: false, name: "Stormtrace default", mode: "dark", colors: {} };
  }
}
