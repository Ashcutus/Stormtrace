(() => {
  'use strict';
  const C = globalThis.StormtraceCore, P = globalThis.StormtracePlatform, W = globalThis.StormtraceWarnings;
  const ID = 'ea-floods';
  const UI = globalThis.StormtraceUI;
  function validBatch(payload) {
    if (payload?.configured !== true || !payload.health || !Array.isArray(payload.records) || !Array.isArray(payload.observations)) throw new C.ProviderError('malformed', ID, 'local_response');
    for (const event of [...payload.records, ...payload.observations]) {
      C.event(event);
      const p = event.domainPayload;
      if (event.provider !== ID || event.kind !== 'warning' || ![1,2,3,4].includes(p.level) || p.status !== (p.level === 4 ? 'NO_LONGER_IN_FORCE' : 'ACTIVE') || !['headline','description','classification','county','riverOrSea'].every((k) => typeof p[k] === 'string') || !p.sourceTimes || !Object.values(p.sourceTimes).every((v) => typeof v === 'string')) throw new C.ProviderError('malformed', ID, 'local_response');
    }
    return payload;
  }
  function mountFloods({ demo = false, showOnMap = null } = {}) {
    const $ = (id) => document.getElementById(id), dialog = $('floodsDialog'), list = $('floodList');
    const country = $('floodCountry');
    const currentSource = () => C.getSource(country?.value || ID);
    const controller = new W.WarningController({ id: ID, endpoint: '/api/floods', validate: validBatch, interval: 900000, isOlder: (event, latest) => {
      const a = event.domainPayload.sourceTimes.reviewed, b = latest.domainPayload.sourceTimes.reviewed;
      return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(a) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(b) && a < b;
    }, onChange: render });
    const collection=UI.collection(dialog,list,$('floodArchive'),$('floodHistory'));
    dialog.addEventListener('collectionchange',render);
    let timer = null, initialization = null;
    $('floodAttribution').textContent = C.getSource(ID).attribution;
    const text = (parent, tag, value, cls = '') => { const el = document.createElement(tag); el.textContent = value; el.className = cls; parent.append(el); return el; };
    async function initialize() {
      if (!initialization) initialization = (async () => {
        try { const [history, snapshots] = await Promise.all([P.IndexedDBStorageAdapter.open(), P.IndexedDBStorageAdapter.open(undefined, 'stormtrace-flood-state')]); controller.history = new C.RevisionHistory(history); controller.snapshotStorage = snapshots; await controller.restore(); }
        catch { controller.storageFailure(); }
      })();
      await initialization;
    }
    function card(parent, event, historyView = false) {
      const p = event.domainPayload, el = text(parent, 'article', '', 'warning-card flood-card');
      text(el, 'strong', p.classification, 'warning-badge'); text(el, 'h3', p.headline);
      UI.cardActions(el, { onShowMap: showOnMap && !historyView ? () => { dialog.close(); showOnMap(event, controller.state.health, controller.state.cached); } : null,
        link: { label: 'Check this area on GOV.UK', url: `https://check-for-flooding.service.gov.uk/target-area/${encodeURIComponent(p.areaId)}` } });
      text(el, 'p', [p.county, p.riverOrSea].filter(Boolean).join(' · '));
      text(el, 'p', p.description, 'warning-text');
      for (const [key, label] of [['reviewed','Last reviewed'],['messageChanged','Message changed'],['severityChanged','Severity changed']]) if (p.sourceTimes[key]) text(el, 'p', `${label}: ${p.sourceTimes[key]} (source time${/(?:Z|[+-]\d\d:\d\d)$/.test(p.sourceTimes[key]) ? '' : '; timezone not supplied'})`);
    }
    function render() {
      if (!dialog.open) return;

      const s=controller.state;
      const source = currentSource();
      $('floodAttribution').textContent = source.attribution;
      if ($('floodCoverage')) $('floodCoverage').textContent = source.id === ID ? 'England live feed, all areas. This list does not check whether your saved point is affected.' : source.summary || source.notes;
      if ($('floodOfficialLink')) { $('floodOfficialLink').href = source.homepage; $('floodOfficialLink').textContent = `Official ${source.coverage} flood information ↗`; }
      if (source.id !== ID) {
        UI.keyed(list,[],card);
        $('floodRefresh').disabled = true; $('floodHistory').disabled = true;
        $('floodStatus').textContent = demo ? 'Live flood warnings are disabled in demo mode.' : `Stormtrace does not have live warnings for ${source.coverage}. Use the official service linked above.`;
        $('floodStorageStatus').textContent = 'No live warnings are retrieved for this country; unavailable coverage is not an empty warning feed.';
        return;
      }
      const fresh = C.freshness(s.health, controller.now()), records = s.records.filter((r) => r.domainPayload.status === 'ACTIVE').sort((a,b) => a.domainPayload.level-b.domainPayload.level || a.domainPayload.headline.localeCompare(b.domainPayload.headline));
      $('floodRefresh').disabled = s.loading || demo; $('floodHistory').disabled = demo;
      $('floodStatus').textContent=demo?'Live flood warnings are disabled in demo mode.':UI.healthMessage(s,controller.now(),'active alerts/warnings',records.length);
      if (s.storageError && !demo) $('floodStatus').textContent += ' Saved history is unavailable.';
      $('floodStorageStatus').textContent = s.storageError ? 'Saved history is unavailable on this device.' : 'This device keeps versions seen while this view was open, for up to 90 days. A warning is only shown as withdrawn when the source says so.';
      const selected=records.filter(r=>UI.matches(r,collection.filter()));
      if (!collection.isHistory?.()) collection.summary?.(selected.length,records.length);
      if (!demo) UI.keyed(list,selected.slice(0,collection.limit()),card);
      UI.sourceStatus('floodsButton',s);
    }
    async function poll() { if (demo || document.hidden || !dialog.open || currentSource().id !== ID) return; await initialize(); if (dialog.open && !document.hidden) await controller.refresh(); }
    $('floodsButton').addEventListener('click', () => { dialog.showModal(); render(); poll(); clearInterval(timer); timer = setInterval(poll,900000); });
    country?.addEventListener('change', async () => { collection.reset(); $('floodArchive').renderArchive=null; $('floodArchive').replaceChildren(); render(); await poll(); });
    $('floodRefresh').addEventListener('click',poll);
    $('floodHistory').addEventListener('click',async () => {
      await initialize(); const archive = $('floodArchive'); archive.replaceChildren();
      try { const revisions = await controller.history?.query({ provider: ID, time: 'persistedAt' }) || []; revisions.sort((a,b) => b.persistedAt-a.persistedAt); UI.archiveView(archive,revisions,(parent,event)=>card(parent,event,true),collection); }
      catch { text(archive,'p','Saved history is unavailable on this device.'); }
    });
    dialog.addEventListener('close',() => { clearInterval(timer); timer = null; $('floodArchive').replaceChildren(); });
    document.addEventListener('visibilitychange',() => { if (!document.hidden && dialog.open) poll(); });
    return controller;
  }
  globalThis.StormtraceFloods = { validBatch, mountFloods };
})();
