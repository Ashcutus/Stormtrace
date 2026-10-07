# Soak diagnostics

Diagnostics are opt-in, have no UI, and use only existing runtimes/standard libraries. Start a fresh local server from the repository:

```bash
STORMTRACE_DIAGNOSTICS=1 ./start.sh
```

Open its usual viewer (http://127.0.0.1:4177), then in another terminal:

```bash
python3 scripts/diagnostics.py record
```

The normal managed launcher may reuse an already-running server; setting an environment variable on that launcher does not reconfigure that server. Stop the existing receiver before starting this test server. Both Node and Python servers support the same numeric-only diagnostics endpoint. The recorder currently targets the default local port. For native testing, open `stormtrace_app.py` against this server and pass its PID with `record --pid PID` to include GTK/WebKit descendants. Do not pass a browser shared with unrelated tabs; its memory/CPU cannot be attributed to Stormtrace alone.

Stop the recorder with Ctrl-C. Restart the server without `STORMTRACE_DIAGNOSTICS=1` and reload the viewer to disable browser sampling. Disabled mode creates no files, sampling timers or error listeners; it makes one small configuration GET per page load and performs guarded counter calls.

## Files and limits

Files are under `${XDG_STATE_HOME:-$HOME/.local/state}/stormtrace/diagnostics/<UTC-session>/`. Each session has `summary.json` and up to three JSONL segments of approximately 2 MiB each. Five sessions are retained (about 30 MiB total, plus small summaries); rotation discards the oldest samples, while the summary continues across rotation. Files/directories are created private. Output stays outside the plugin and is never served as assets. A crash or kill can leave a partial final JSONL line; skip that line. Summaries are replaced atomically every sample and remain useful after an unclean stop; `endedAt` only indicates an orderly collector stop. No file compression or dependencies are needed.

```bash
python3 scripts/diagnostics.py latest
python3 scripts/diagnostics.py analyse
python3 scripts/diagnostics.py clean
```

`clean` deletes all diagnostic sessions. One recorder and one viewer per test session are supported; multiple viewers overwrite the latest browser snapshot. Reloads reset browser counters/uptime; inspect decreases as a new browser segment, rather than negative rates. The recorder itself is not included in resource totals.

## “Analyse the latest Stormtrace diagnostics”

An agent should run `analyse`, read this guide, then inspect the reported directory. Read JSONL in order: `metrics.2.jsonl`, `metrics.1.jsonl`, `metrics.jsonl` (some may be absent). Each line has UTC time, schema version, resource measurements, browser counters and snapshot age. The summary gives duration, starting/final/peak RSS, sample-average/peak CPU, poll failures, stale browser-report incidents, and accumulated browser counter deltas across detected reloads. The first snapshot includes activity since that page loaded; activity during gaps or a reload between samples can be missed. `latestBrowser` preserves the latest page counters.

Compare RSS and CPU over time against processed strikes, retained strikes, sampled marker peak, pending writes, radar refreshes and reconnect/error counter deltas. Look for memory growth after counts stabilize, sustained pending writes, reconnect bursts, lag spikes while visible, or old/missing browser reports. Investigate `app.js` feed lifecycle/ingestion/rendering/persistence, `client/radar.js` metadata refresh and image loading, `platform/strike-cache.js` writes, and the corresponding provider/platform adapter. Keep conclusions conditional: ordinary archive growth, GC, radar decoding subprocesses, page reloads, background throttling and quiet feeds can explain apparent anomalies. Use source timestamps and transport success separately. Missing values mean unknown; never treat them as zero.

Browser samples arrive every ten seconds. Counters identify the subsystem without payload contents: `received` counts normalized live records, `processed` counts newly accepted strikes from all ingestion sources; `connections` counts attempts and `reconnects` counts unexpected closes scheduling retry. `networkFailures` covers live socket errors and radar metadata failures, not all application networking. `errors` counts unreadable feed messages, radar image failures, and global uncaught errors/rejections (no exception text). Radar attempts/successes/failures/duration describe metadata refresh, including successful empty/unconfigured responses; image failures are separate significant errors. `radarSourceAgeMs` is observation age, `radarAgeMs` is time since successful metadata retrieval. `lightningAgeMs` ages the last successfully parsed live message, including heartbeats, so quiet weather is not assumed to be stale. Paused/hidden flags explain intentional inactivity.

`lagMs` measures lateness of a ten-second browser timer; hidden-page throttling is not a UI freeze. `markerPeak` is a sampled peak, not an exact transient maximum. No frame-rate claims are made. `staleIncidents` counts transitions to browser reports over 30 seconds old, not upstream weather outages; missing reports and polling failures are explicit flags. Freshness trends are evidence for investigation, not a fabricated provider SLA.

## Overhead and limitations

Enabled browser work consists of integer counters and one small POST every ten seconds, with no per-strike logging or retained event queue. The collector polls once per ten seconds, reads bounded process-tree metadata, appends one line and replaces a small summary. Rotation bounds disk usage. `collectorDurationMs` exposes sampling cost on the test machine. CPU is percent of one logical core over the sample interval and can exceed 100% for a process tree. RSS summed over processes double-counts shared pages; compare trends for the same process scope. PID/start-time identity prevents reused PIDs producing CPU spikes. Linux `/proc` sampling includes the server and its children plus an explicitly supplied native process tree. Without `--pid`, browser memory/CPU is deliberately absent. No portable JS heap measurement, GPU memory, exact frame rate, per-request tracing, upstream raw packet count, or complete network-failure total is claimed.

A local 100-sample microbenchmark of one `/proc` read plus JSONL/atomic-summary writes measured about 0.14 ms per sample (excluding HTTP/process-tree work); this is indicative, not a native soak result.

Automated tests cover sanitization, disabled behavior, bounded retention, summaries and current RSS sampling. Native overnight stability, GTK/WebKit resource scope and real UI responsiveness remain manual validation gates. Record actual overhead/environment with each soak run; microbenchmarks do not establish native overhead.
