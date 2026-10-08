# 7 October 2026 soak investigation

Investigated on 8 October against the diagnostics implementation in `94e741d`. The session `20261007T170407.469389Z` contains all 2,108 samples, from 18:04:07 to 23:55:17 BST (5h 51m). No rotated samples were missing. Measurements and limitations are described in [diagnostics](diagnostics.md).

## Recorded evidence

- Process-tree RSS started at 1.02 GiB, peaked at 17.34 GiB and was 14.54 GiB at the last valid sample. PID 58163 accounted for almost all growth, from 712 MiB to 14.38 GiB. The recorder did not save process names, so its exact historical executable cannot be established from JSONL alone.
- Retained strikes reached 30,000 at 19:04:47 BST; RSS then was 8.76 GiB and continued growing. Sampled markers were often zero later in the run. A capped archive and low visible marker counts did not bound process memory.
- CPU averaged 81.2% of one logical core across the recorded process tree; peak 288.5%. Browser timer lag median/p95 was 4 ms, maximum 1,492 ms; all available browser snapshots were visible/unpaused. This is not an FPS measurement.
- Live records received: 98,152; newly accepted strikes from all sources: 110,217. One connection, no recorded reconnects, network failures or application errors. Radar metadata succeeded 76/76 times. Pending writes median 4, peak 35; this does not count in-flight storage transactions.
- Journal evidence confirms an orderly receiver stop at 23:54:46 BST, native application scope termination at 23:54:47, and subsequent system shutdown. The application scope recorded 17.4G memory peak and 2.4G swap peak. The last four empty-process/poll-failure samples are not evidence of memory recovery or an application crash.
- Collector median duration 3.3 ms, maximum 21.4 ms; systemd reports 7.343 seconds collector CPU over the run. No disabled-diagnostics comparison was recorded.

## Isolated native investigation

Ran GTK3/WebKit2GTK 4.1, WebKit 2.52.6 on the local desktop, using fresh temporary profiles and synthetic data only. No live feeds, map, radar, credentials or user profile were loaded. A minimal page loaded the actual history and browser storage modules, seeded 30,000 rows in one transaction, and repeatedly ran concurrent retention for `lightningmaps` and `lightning-history`, with `before: 0`, `keepLatest: false`, `maxEvents: 30000`.

Each synthetic row contained provider/event identity and one revision with sequence, persistence time, a small event payload and provenance fetch time. This isolates maintenance rather than simulating full event payload size or live ingestion. RSS was read from `/proc` at seed and after each completed cycle. Comparisons use separate processes; RSS includes native allocations and is not a heap profile.

| Variant | Maintenance time | Write transactions per cycle | WebKit web-process RSS |
| --- | --- | --- | --- |
| Original code, two cycles | 20.35–21.57 s | 60,000 | 267 MiB after seed; 404 then 565 MiB |
| Skip unchanged/unrelated writes, cursor reads, twelve cycles | 1.74–1.97 s | 0 | 267 MiB after seed; progressive growth to 1,446 MiB |
| Skip unchanged writes, bulk reads in batches of 256, twelve cycles | 0.79–0.85 s | 0 | 265 MiB after seed; 333–503 MiB across cycles; final 454 MiB |

An unbounded bulk-read experiment took 62.6 seconds for its first cycle, so the implemented adapter uses bounded batches. These tests identify cursor-based scanning as a reproducible contributor to WebKit memory growth, and unconditional writes as a separate CPU/transaction cost. They do not establish an upstream engine defect or prove that every byte of the original viewer growth came from this path.

## Changes and validation

Retention now skips unrelated providers and rows with no expired revisions before opening write transactions. Eligible candidates are still rechecked atomically, and count eviction retains its concurrent-change guard. Storage enumeration reads matching keys/values in batches of 256 within one readonly transaction; IndexedDB's structured clones provide detached values. No database version, schema, profile path, source metadata or retention policy changes.

Regression tests cover no-op write avoidance, atomic rechecks after concurrent revisions, ordering and pairing across multiple batches, detached values, and avoidance of per-row cursor traversal. `npm test`: 93 passed, no failures, one optional radar-decoder dependency test skipped. `npm run check` and `git diff --check` passed. The native storage benchmarks above were actually performed; the full viewer soak below was not.

## Remaining validation

- Repeat the full native viewer soak for at least the original run duration with diagnostics and its native PID scope; check that memory plateaus after archive saturation.
- Exercise real archive pruning/count overflow while ingestion continues and observe in-flight revision persistence, which the pending-write counter does not measure.
- If memory still grows, capture separate web/network-process RSS and allocation/heap evidence, then isolate ingestion, storage, map and radar independently.
- Full GTK launch/location/notification/map smoke gates remain separate; this storage benchmark does not satisfy them. Changes are local working-tree changes, not a merged or published release.
