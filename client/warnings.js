(() => {
  "use strict";
  const C = globalThis.StormtraceCore;
  const P = globalThis.StormtracePlatform;
  const ID = "metoffice-warnings";
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const levelRank = { RED: 0, AMBER: 1, YELLOW: 2 };
  const weatherName = (name) => name.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const ukDate = (time) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(time);
  function visibleWarnings(records, now = Date.now()) {
    return records.filter((r) => r.domainPayload.status === "ISSUED" && r.validTo > now)
      .sort((a, b) => a.validFrom - b.validFrom || levelRank[a.domainPayload.classification] - levelRank[b.domainPayload.classification] || a.domainPayload.weatherTypes.join().localeCompare(b.domainPayload.weatherTypes.join()) || a.id.localeCompare(b.id));
  }
  function validBatch(payload) {
    if (!payload || typeof payload.configured !== "boolean" || !payload.health || (payload.configured && (!Array.isArray(payload.records) || !Array.isArray(payload.observations)))) throw new C.ProviderError("malformed", ID, "local_response");
    for (const item of [...(payload.records || []), ...(payload.observations || [])]) {
      try { C.event(item); } catch { throw new C.ProviderError("malformed", ID, "local_response"); }
      const p = item.domainPayload;
      if (![item.updatedAt, item.validFrom, item.validTo].every(Number.isFinite) || typeof p.headline !== "string" || typeof p.version !== "string" || ![p.description, p.instruction, p.updateReason].every((v) => typeof v === "string") || !p.weatherTypes?.every((v) => typeof v === "string") || !p.whatToExpect?.every((v) => typeof v === "string") || !p.affectedAreas?.every((a) => a && typeof a.regionName === "string" && Array.isArray(a.subRegions) && a.subRegions.every((v) => typeof v === "string"))) throw new C.ProviderError("malformed", ID, "local_response");
      if (item.kind !== "warning" || item.provider !== ID || !["RED", "AMBER", "YELLOW"].includes(item.domainPayload.classification) || !["ISSUED", "CANCELLED", "EXPIRED"].includes(item.domainPayload.status) || !Array.isArray(item.domainPayload.weatherTypes) || !Array.isArray(item.domainPayload.whatToExpect) || !Array.isArray(item.domainPayload.affectedAreas)) throw new C.ProviderError("malformed", ID, "local_response");
    }
    return payload;
  }
  class WarningController {
    constructor({ fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, history = null, snapshotStorage = null, onChange = () => {}, location = () => null, log = (entry) => console.warn("Stormtrace warnings", entry) } = {}) {
      Object.assign(this, { fetch: fetcher, now, history, snapshotStorage, onChange, location, log });
      this.state = { records: [], health: C.health(60000), configured: null, cached: false, storageError: false, loading: false };
      this.inflight = null;
    }
    async restore() {
      try {
        const snapshot = await this.snapshotStorage?.get("latest");
        if (snapshot) {
          validBatch({ ...snapshot, observations: [] });
          Object.assign(this.state, { records: snapshot.records, health: snapshot.health, configured: snapshot.configured, cached: true });
          this.changed();
        }
      } catch { this.storageFailure(); }
    }
    storageFailure() { this.state.storageError = true; try { this.log({ provider: ID, operation: "storage", code: "unavailable" }); } catch { /* diagnostics cannot break presentation */ } }
    changed() { this.onChange(this.state); }
    async recordObserved(records) {
      if (!this.history) return;
      for (const event of records) {
        const revisions = await this.history.revisions(ID, event.id);
        const latest = revisions.at(-1)?.event;
        // Source revisions may be replayed after a server restart. Do not revert history.
        if (latest && (latest.updatedAt > event.updatedAt || (latest.updatedAt === event.updatedAt && Number(latest.domainPayload.version) > Number(event.domainPayload.version)))) continue;
        await this.history.record(event);
      }
    }
    refresh() {
      if (this.inflight) return this.inflight;
      this.inflight = this.load().finally(() => { this.inflight = null; }); return this.inflight;
    }
    async load() {
      this.state.loading = true; this.changed();
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await this.fetch("/api/warnings", { cache: "no-store", signal: controller.signal });
        let payload;
        try { payload = await response.json(); } catch { throw new C.ProviderError("parse", ID, "local_response"); }
        if (!response.ok) {
          this.state.health = payload.health || { ...this.state.health, lastError: payload.providerError || { code: "upstream" } };
          this.state.cached = true; this.state.configured = payload.configured ?? this.state.configured;
          return;
        }
        validBatch(payload);
        Object.assign(this.state, { records: clone(payload.records || []), health: clone(payload.health), configured: payload.configured, cached: false });
        try {
          await this.recordObserved([...(payload.observations || []), ...(payload.records || [])]);
          await this.snapshotStorage?.update("latest", () => ({ records: this.state.records, health: this.state.health, configured: this.state.configured }));
          await this.history?.retain({ provider: ID, before: this.now() - 90 * 86400000, keepLatest: false, maxEvents: 5000 });
        } catch { this.storageFailure(); }
      } catch (error) {
        this.state.health = { ...this.state.health, lastAttemptedFetch: this.now(), lastError: C.providerError(error, ID, "local_fetch").toJSON(), consecutiveFailures: this.state.health.consecutiveFailures + 1 };
        this.state.cached = true;
      } finally { clearTimeout(timeout); this.state.loading = false; this.changed(); }
    }
  }

  function mountWarnings({ getLocation = () => null, demo = false } = {}) {
    const $ = (id) => document.getElementById(id);
    const dialog = $("warningsDialog"), list = $("warningList"), status = $("warningStatus"), refresh = $("warningRefresh");
    const controller = new WarningController({ location: getLocation, onChange: render });
    $("warningAttribution").textContent = C.getSource(ID).attribution;
    let timer = null, initialization = null;
    function initialize() {
      return initialization ||= initializeStorage();
    }
    async function initializeStorage() {
      try {
        const [revisions, snapshots] = await Promise.all([P.IndexedDBStorageAdapter.open(), P.IndexedDBStorageAdapter.open(undefined, "stormtrace-warning-state")]);
        controller.history = new C.RevisionHistory(revisions); controller.snapshotStorage = snapshots;
        await controller.restore();
      } catch { controller.storageFailure(); }
    }
    function text(parent, tag, value, className = "") { const node = document.createElement(tag); node.textContent = value; node.className = className; parent.append(node); return node; }
    function paragraph(parent, heading, value) { if (!value) return; text(parent, "h4", heading); text(parent, "p", value, "warning-text"); }
    function render() {
      if (!dialog.open) return;
      const state = controller.state, freshness = C.freshness(state.health, controller.now());
      refresh.disabled = state.loading || demo;
      $("warningHistory").disabled = demo;
      list.replaceChildren();
      if (demo) { status.textContent = "Live warnings are disabled in demo mode."; return; }
      if (state.configured === false) { status.textContent = "The Met Office connection is not configured. Follow the setup guide to connect it."; return; }
      const records = visibleWarnings(state.records, controller.now());
      const checked = state.health.lastSuccessfulFetch == null ? "Never checked" : `Last checked ${ukDate(state.health.lastSuccessfulFetch)}`;
      const degraded = state.cached || !["fresh", "delayed"].includes(freshness);
      status.textContent = state.loading ? "Checking Met Office Weather Warnings…" : degraded ? `${freshness.replace(/_/g, " ")} · ${checked}. ${state.records.length ? "Showing previously retrieved warnings" : "Current warning data is unavailable"}; check the Met Office for current information.` : records.length ? `${records.length} issued warning${records.length === 1 ? "" : "s"} · ${checked}` : `No issued warnings in the latest successfully retrieved feed · ${checked}`;
      $("warningStorageStatus").textContent = state.storageError ? "Local history is unavailable; live warnings remain viewable." : "Observed warning revisions are retained on this device for up to 90 days.";
      for (const event of records) {
        const p = event.domainPayload;
        const card = text(list, "article", "", "warning-card"); card.dataset.level = p.classification;
        text(card, "span", weatherName(p.classification), "warning-badge");
        text(card, "h3", p.weatherTypes.map(weatherName).join(" & "));
        text(card, "p", `Issued ${ukDate(event.observedAt)} · updated ${ukDate(event.updatedAt)} · version ${p.version}`);
        text(card, "p", `${ukDate(event.validFrom)} – ${ukDate(event.validTo)}`);
        text(card, "h4", p.headline);
        const point = getLocation();
        if (point && C.pointInPolygon([point.lon, point.lat], event.geometry)) text(card, "p", "Your saved monitoring point is within this warning area.", "warning-relevance");
        paragraph(card, "Affected areas", p.affectedAreas.map((a) => `${a.regionName}${a.subRegions.length ? `: ${a.subRegions.join(", ")}` : ""}`).join("\n"));
        text(card, "h4", "What to expect"); const ul = document.createElement("ul"); card.append(ul); for (const value of p.whatToExpect) text(ul, "li", value);
        paragraph(card, "Further details", p.description);
        paragraph(card, "What should I do", p.instruction);
        paragraph(card, "Update reason", p.updateReason);
        const historyButton = text(card, "button", "Observed history", "text-button"); historyButton.type = "button";
        const historyText = text(card, "div", "", "warning-history");
        historyButton.addEventListener("click", async () => {
          historyText.replaceChildren();
          try {
            const revisions = await controller.history?.revisions(ID, event.id) || [];
            if (!revisions.length) text(historyText, "p", "No local revisions recorded.");
            for (const revision of revisions) {
              const old = revision.event;
              text(historyText, "p", `${ukDate(old.updatedAt)} · ${old.domainPayload.classification} · ${old.domainPayload.status} · version ${old.domainPayload.version}`);
              paragraph(historyText, "Update reason", old.domainPayload.updateReason);
            }
          } catch { text(historyText, "p", "Local history is unavailable."); }
        });
      }
    }
    async function poll() { if (demo || document.hidden || !dialog.open) return; await initialize(); await controller.refresh(); }
    $("warningsButton").addEventListener("click", () => { dialog.showModal(); render(); poll(); clearInterval(timer); timer = setInterval(poll, 60000); });
    refresh.addEventListener("click", poll);
    $("warningHistory").addEventListener("click", async () => {
      const archive = $("warningArchive"); archive.replaceChildren();
      await initialize();
      text(archive, "h3", "Observed history — including cancellations");
      try {
        const revisions = await controller.history?.query({ provider: ID }) || [];
        revisions.sort((a, b) => b.event.updatedAt - a.event.updatedAt || b.sequence - a.sequence);
        if (!revisions.length) text(archive, "p", "No warning revisions have been recorded on this device.");
        for (const { event } of revisions) {
          const p = event.domainPayload;
          const card = text(archive, "article", "", "warning-card"); card.dataset.level = p.classification;
          text(card, "span", weatherName(p.classification), "warning-badge");
          text(card, "h4", p.headline);
          text(card, "p", `${ukDate(event.updatedAt)} · ${p.status} · version ${p.version}`);
          paragraph(card, "Update reason", p.updateReason);
          text(card, "p", `${ukDate(event.validFrom)} – ${ukDate(event.validTo)}`);
          paragraph(card, "Affected areas", p.affectedAreas.map((a) => `${a.regionName}: ${a.subRegions.join(", ")}`).join("\n"));
          text(card, "h4", "What to expect"); const ul = document.createElement("ul"); card.append(ul); for (const value of p.whatToExpect) text(ul, "li", value);
          paragraph(card, "Further details", p.description); paragraph(card, "What should I do", p.instruction);
        }
      } catch { text(archive, "p", "Local history is unavailable."); }
    });
    dialog.addEventListener("close", () => { clearInterval(timer); timer = null; });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && dialog.open) poll(); });
    return controller;
  }
  globalThis.StormtraceWarnings = { WarningController, visibleWarnings, validBatch, ukDate, mountWarnings };
})();
