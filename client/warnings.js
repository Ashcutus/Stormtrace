(() => {
  "use strict";
  const C = globalThis.StormtraceCore;
  const P = globalThis.StormtracePlatform;
  const UI = globalThis.StormtraceUI;
  const ID = "metoffice-warnings";
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const levelRank = { RED: 0, AMBER: 1, YELLOW: 2 };
  const weatherName = (name) => name.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const ukDate = (time) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(time);
  function visibleWarnings(records, now = Date.now()) {
    return records.filter((r) => r.domainPayload.status === "ISSUED" && r.validTo > now)
      .sort((a, b) => levelRank[a.domainPayload.classification] - levelRank[b.domainPayload.classification] || a.validFrom - b.validFrom || a.domainPayload.weatherTypes.join().localeCompare(b.domainPayload.weatherTypes.join()) || a.id.localeCompare(b.id));
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
    constructor({ id = ID, endpoint = "/api/warnings", validate = validBatch, interval = 60000, retentionDays = 90, maxEvents = 5000, retainInterval = 3600000, isOlder = () => false, fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, history = null, snapshotStorage = null, onChange = () => {}, location = () => null, log = (entry) => console.warn("Stormtrace warnings", entry) } = {}) {
      Object.assign(this, { id, endpoint, validate, retentionDays, maxEvents, retainInterval, isOlder, fetch: fetcher, now, history, snapshotStorage, onChange, location, log });
      this.state = { components: [], retryAt: 0, records: [], health: C.health(interval), configured: null, cached: false, storageError: false, loading: false };
      this.inflight = null; this.lastRetainedAt = null;
    }
    async restore() {
      try {
        const snapshot = await this.snapshotStorage?.get("latest");
        if (snapshot) {
          this.validate({ ...snapshot, observations: [] });
          Object.assign(this.state, { records: snapshot.records, health: snapshot.health, configured: snapshot.configured, components: snapshot.components || [], cached: true });
          this.changed();
        }
      } catch { this.storageFailure(); }
    }
    storageFailure() { this.state.storageError = true; try { this.log({ provider: this.id, operation: "storage", code: "unavailable" }); } catch { /* diagnostics cannot break presentation */ } }
    changed() { this.onChange(this.state); }
    async recordObserved(records) {
      if (!this.history) return;
      // Observations and current records can overlap; process each revision once.
      const seen = new Set();
      for (const event of records) {
        const identity = JSON.stringify([event.id, C.revisionContent(event)]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        const revisions = await this.history.revisions(this.id, event.id);
        const latest = revisions.at(-1)?.event;
        // Source revisions may be replayed after a server restart. Do not revert history.
        if (latest && (this.isOlder(event, latest) || latest.updatedAt > event.updatedAt || (latest.updatedAt === event.updatedAt && Number(latest.domainPayload.version) > Number(event.domainPayload.version)))) continue;
        if (latest && C.revisionContent(latest)===C.revisionContent(event)) continue;
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
        const response = await this.fetch(this.endpoint, { cache: "no-store", signal: controller.signal });
        let payload;
        try { payload = await response.json(); } catch { throw new C.ProviderError("parse", this.id, "local_response"); }
        if (!response.ok) {
          this.state.retryAt = payload.retryAt || payload.health?.retryAt || this.now()+Math.max(60000,(payload.providerError?.retryAfter||60)*1000);
          this.state.health = payload.health || { ...this.state.health, lastError: payload.providerError || { code: "upstream" } };
          this.state.cached = true; this.state.configured = payload.configured ?? this.state.configured;
          return;
        }
        this.validate(payload);
        Object.assign(this.state, { records: clone(payload.records || []), health: clone(payload.health), configured: payload.configured, components: clone(payload.components || []), retryAt: payload.components?.some(c=>c.error) ? Math.min(...payload.components.filter(c=>c.error).map(c=>c.retryAt||this.now())) : payload.health?.lastSuccessfulFetch ? payload.health.lastSuccessfulFetch+payload.health.expectedUpdateInterval : 0, cached: false });
        try {
          await this.recordObserved([...(payload.observations || []), ...(payload.records || [])]);
          const snapshot={records:this.state.records,health:this.state.health,configured:this.state.configured,components:this.state.components},signature=C.canonical(snapshot);
          if(signature!==this.snapshotSignature){await this.snapshotStorage?.update("latest",()=>snapshot);this.snapshotSignature=signature;}
          // Retention scans the shared archive; bound it independently of the poll rate.
          if (this.history && (this.lastRetainedAt == null || this.now() - this.lastRetainedAt >= this.retainInterval)) {
            await this.history.retain({ provider: this.id, before: this.now() - this.retentionDays * 86400000, keepLatest: false, maxEvents: this.maxEvents });
            this.lastRetainedAt = this.now();
          }
        } catch { this.storageFailure(); }
      } catch (error) {
        // Local connectivity failure has its own short retry window; a previous
        // successful source-cache deadline must not prevent reconnection.
        this.state.retryAt = this.now() + 60000;
        this.state.health = { ...this.state.health, lastAttemptedFetch: this.now(), lastError: C.providerError(error, this.id, "local_fetch").toJSON(), consecutiveFailures: this.state.health.consecutiveFailures + 1 };
        this.state.cached = true;
      } finally { clearTimeout(timeout); this.state.loading = false; this.changed(); }
    }
  }

  function mountWarnings({ getLocation = () => null, demo = false } = {}) {
    const $ = (id) => document.getElementById(id);
    const dialog = $("warningsDialog"), list = $("warningList"), status = $("warningStatus"), refresh = $("warningRefresh");
    const controller = new WarningController({ location: getLocation, onChange: render });
    const summaries = new WarningController({ id: 'metoffice-warnings-rss', endpoint: '/api/hazards?source=metoffice-warnings-rss', interval: 300000, validate: payload => globalThis.StormtracePublicHazards.validBatch('metoffice-warnings-rss',payload), onChange: render });
    $("warningAttribution").textContent = C.getSource(ID).attribution;
    const collection = UI.collection(dialog,list,$("warningArchive"),$("warningHistory"));
    dialog.addEventListener("collectionchange",render);
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

      if (demo) { status.textContent = "Live warnings are disabled in demo mode."; return; }
      UI.sourceStatus("warningsButton",state);
      if (state.configured === false) {
        collection.reset();
        const s=summaries.state;
        status.textContent = `Public RSS summaries · ${UI.healthMessage(s,summaries.now(),'warning summaries')} Full DataHub details require a free subscription key.`;
        refresh.disabled=s.loading||demo;
        $("warningHistory").disabled=true;
        $("warningStorageStatus").textContent='RSS summaries are not archived here. The feed does not supply geometry or per-warning issue/expiry times. Disappearance does not establish cancellation.';
        UI.sourceStatus('warningsButton',s);
        const records=s.records.filter(r=>UI.matches(r,collection.filter())).sort((a,b)=>levelRank[a.domainPayload.badge]-levelRank[b.domainPayload.badge]);
        collection.summary?.(records.length,s.records.length);
        UI.keyed(list,records.slice(0,collection.limit()),(parent,r)=>{
          const p=r.domainPayload,card=text(parent,'article','','warning-card');card.dataset.level=p.badge;
          text(card,'span',weatherName(p.badge),'warning-badge');text(card,'h3',p.title);
          text(card,'p',p.body,'warning-text');
          text(card,'p','Official RSS summary. Open the warning for full details, timing and advice.','warning-text');
          const link=text(card,'a','Read the full Met Office warning','text-button');link.href=p.url;link.target='_blank';link.rel='noopener noreferrer';
        });
        return;
      }
      const all = visibleWarnings(state.records, controller.now()), records = all.filter(r=>UI.matches(r,collection.filter()));
      if (!collection.isHistory?.()) collection.summary?.(records.length,all.length);
      UI.sourceStatus("warningsButton",state);
      status.textContent = UI.healthMessage(state,controller.now(),"issued warnings",all.length);
      if (state.storageError) document.getElementById('warningStatus').textContent += ' Local history is unavailable.';
      $("warningStorageStatus").textContent = state.storageError ? "Local history is unavailable; live warnings remain viewable." : "Observed warning revisions are retained on this device for up to 90 days.";
      UI.keyed(list, records.slice(0,collection.limit()), (list,event) => {
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
      },JSON.stringify(getLocation()));
    }
    async function poll() { if (demo || document.hidden || !dialog.open) return; await initialize(); if (dialog.open && !document.hidden) {await controller.refresh();if(controller.state.configured===false && dialog.open)await summaries.refresh();} }
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
        UI.archiveView(archive,revisions,(archive,event) => {
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
        },collection);
      } catch { text(archive, "p", "Local history is unavailable."); }
    });
    dialog.addEventListener("close", () => { clearInterval(timer); timer = null; });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && dialog.open) poll(); });
    return controller;
  }
  globalThis.StormtraceWarnings = { WarningController, visibleWarnings, validBatch, ukDate, mountWarnings };
})();
