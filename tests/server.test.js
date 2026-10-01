import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createStormtraceServer, normalizeHistoryFlashes } from "../server.js";

function request(port, path) {
  return new Promise((resolve, reject) => {
    const call = http.request({ host: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    call.on("error", reject);
    call.end();
  });
}

test("server rejects malformed and non-file paths without terminating", async (context) => {
  const server = createStormtraceServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const malformed = await request(port, "/%ZZ");
  assert.equal(malformed.status, 400);
  assert.deepEqual(JSON.parse(malformed.body), { error: "Invalid request path" });

  const directory = await request(port, "/vendor/");
  assert.equal(directory.status, 404);

  const health = await request(port, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);

  const home = await request(port, "/");
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.headers["content-security-policy"], /unpkg/);
});

test("Node and Python fallback servers normalize history identically", () => {
  const input = [
    { flash_id: "valid", flash_timestamp_utc: "2026-10-01T12:30:00", lat: "51.5", lon: "-0.12" },
    { flash_id: "offset", flash_timestamp_utc: "2026-10-01T14:30:00+02:00", lat: 1, lon: 2 },
    { flash_id: "bad-time", flash_timestamp_utc: "never", lat: 0, lon: 0 },
    { flash_id: "bad-lat", flash_timestamp_utc: "2026-10-01T12:30:00Z", lat: 91, lon: 0 },
    { flash_id: "missing-lat", flash_timestamp_utc: "2026-10-01T12:30:00Z", lat: null, lon: 0 },
    { flash_timestamp_utc: "2026-10-01T12:30:00Z", lat: 0, lon: 0 },
  ];
  const python = execFileSync("python3", ["-c", [
    "import json, server, sys",
    "print(json.dumps(server.normalize_history_flashes(json.loads(sys.stdin.read())), separators=(',', ':')))"
  ].join("; ")], { input: JSON.stringify(input), encoding: "utf8" });
  assert.deepEqual(normalizeHistoryFlashes(input), JSON.parse(python));
});

test("manifest is the only hard-coded application version", () => {
  const version = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const file of ["index.html", "package.json", "server.js", "server.py", "start-app.sh"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes(version), false, `${file} duplicates ${version}`);
  }
});
