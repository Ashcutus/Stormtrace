(() => {
  'use strict';
  const C = globalThis.StormtraceCore;
  const caches = new WeakMap(), popupStates=new WeakMap();
  const date = (value) => value == null ? 'Time not supplied' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(value) + ' UK local';
  function text(parent, tag, value, cls = '') { const n = document.createElement(tag); n.textContent = value; n.className = cls; parent.append(n); return n; }
  function keyed(container, records, build, extra = '') {
    const old = caches.get(container) || new Map(), next = new Map(), nodes = [];
    for (const r of records) {
      const copy = JSON.parse(JSON.stringify(r)); if (copy.provenance) delete copy.provenance.fetchedAt;
      const signature = C.canonical(copy) + (typeof extra === 'function' ? extra(r) : extra);
      let item = old.get(r.id);
      if (!item || item.signature !== signature) {
        const temp = document.createElement('div'); build(temp, r); const node = temp.firstElementChild || temp.children[0];
        if (item) {
          const details = [...(item.node.querySelectorAll?.('details') || [])];
          [...(node.querySelectorAll?.('details') || [])].forEach((d,i) => { d.open = details[i]?.open || false; });
          const controls=[...(item.node.querySelectorAll?.('button,a,summary,input,select')||[])],focused=document.activeElement;
          const focusKey=n=>`${n.tagName}:${n.getAttribute?.('aria-label')||n.textContent}`;
          const focusedKey=controls.includes(focused)?focusKey(focused):null;
          const history=item.node.querySelector?.('.warning-history'),newHistory=node.querySelector?.('.warning-history');if(history&&newHistory)newHistory.replaceChildren(...history.childNodes);
          if(focusedKey)node.restoreFocus=()=>{const target=[...node.querySelectorAll('button,a,summary,input,select')].find(n=>focusKey(n)===focusedKey);if(target)target.focus();else{node.tabIndex=-1;node.focus();}};
        }
        item = { node, signature };
      }
      next.set(r.id, item); nodes.push(item.node);
    }
    // Do not detach unchanged nodes, preserving focus, disclosure and scroll state.
    if (container.insertBefore) {
      for (const {node} of old.values()) if (!nodes.includes(node)) node.remove();
      nodes.forEach((node,i) => { if (container.children[i] !== node) container.insertBefore(node,container.children[i] || null); node.restoreFocus?.(); delete node.restoreFocus; });
    } else { container.replaceChildren(...nodes); }
    caches.set(container,next);
  }
  function healthMessage(state, now = Date.now(), noun = 'items', count = state.records?.length || 0) {
    // count is the displayed set; callers that filter records must pass it.
    const h = state.health || {}, checked = h.lastSuccessfulFetch == null ? 'Not checked yet.' : `Checked ${date(h.lastSuccessfulFetch)}.`;
    if (state.loading) return `Checking the source… ${checked}`;
    if (state.configured === false) return 'Connection setup required. Use the setup or official-source link.';
    const fresh = C.freshness(h,now);
    const componentFailure=state.components?.some(c=>c.error);
    const retry = state.retryAt || h.retryAt;
    const wait = retry > now ? ` Next source attempt after ${date(retry)}.` : '';
    const reason=h.lastError?.status===403?'The source blocked access (403); use its official website.':h.lastError?.code==='parse'||h.lastError?.code==='malformed'?'The source response could not be read. Try again or use the official website.':h.lastError?.code==='network'||h.lastError?.code==='timeout'?'Connection failed. Check network access and retry.':h.lastError||componentFailure?'One or more source products could not be retrieved.':h.lastSuccessfulFetch?'Source information is older than expected.':'Not checked yet. Select Refresh to retrieve data.';
    if (state.cached || h.lastError || !['fresh','delayed'].includes(fresh)) return `${count ? 'Cached information. ' : ''}${checked} ${reason}${wait}`;
    const partial=state.components?.filter(c=>c.error).length;
    return `${partial?'Partial coverage. ':''}${checked}${fresh === 'delayed' ? ' Source information is delayed.' : ''} ${count} ${noun}.${count?'':' An empty feed is not an all-clear.'}`;
  }
  // Display rounding only; the source value stays unchanged in the record.
  function depth(km) { return `${Math.round(km * 10) / 10} km`; }
  function announce(id, message) { const n=document.getElementById(id); if (n) n.textContent=message; }
  function sourceStatus(id,state) {
    const n=document.getElementById(id);if (!n) return;
    const label=n.dataset?.label || n.textContent; if (n.dataset) n.dataset.label=label;
    const status=state.components?.some(c=>c.error)?'Partial coverage · on demand':state.loading?'Checking…':state.configured===false?'Setup required':state.health?.lastError?'Retrieval failed':state.cached?'Cached · on demand':state.health?.lastSuccessfulFetch?`Checked ${date(state.health.lastSuccessfulFetch)} · on demand`:'On demand';
    n.title=`${label} · ${status}`;
    const option=document.querySelector?.(`#domainChooser option[value="${id}"]`);if(option){const base=option.dataset.baseLabel||option.textContent;option.dataset.baseLabel=base;option.textContent=`${base} — ${status}`;}
    const context=document.getElementById('domainContext');if(context) context.textContent=`${label}: ${status}. Only lightning streams continuously; other views are checked while open.`;
  }
  function refreshPopupHealth() {
    for(const n of document.querySelectorAll?.('.popup-retrieval')||[]) {
      const state=popupStates.get(n);if(!state)continue;const {health:h,cached}=state;
      const stale=C.freshness({...h,available:h.available??true},Date.now())==='stale';
      const message=`${cached||h.lastError?'Cached after retrieval failure. ':''}${h.lastSuccessfulFetch==null?'Retrieval time unavailable.':`Last checked ${date(h.lastSuccessfulFetch)}.`}${stale?' Information is older than expected; reopen the source view to check it.':''} Check the official source for current information.`;
      if(n.textContent!==message)n.textContent=message;
    }
  }
  function popupHealth(parent,health={},cached=false) {
    const n=text(parent,'p','','flood-map-time popup-retrieval');
    const update=(h=health,cache=cached)=>{popupStates.set(n,{health:h,cached:cache});n.textContent=`${cache||h.lastError?'Cached after retrieval failure. ':''}${h.lastSuccessfulFetch==null?'Retrieval time unavailable.':`Last checked ${date(h.lastSuccessfulFetch)}.`} Check the official source for current information.`;refreshPopupHealth();};update();return update;
  }
  function scrollTo(node) { node?.scrollIntoView?.({block:'nearest',behavior:'auto'}); }
  function reducedMotion() { return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches); }
  function flyOptions(duration = 1) { return {duration: reducedMotion()?0:duration,animate:!reducedMotion()}; }
  function collection(dialog,list,archive,historyButton) {
    if (!dialog?.querySelector || !historyButton) return {filter:()=>'',limit:()=>100,reset(){}};
    const header=dialog.querySelector('header') || dialog.querySelector('.dialog-card');
    const tools=text(header,'div','', 'collection-tools');
    const current=text(tools,'button','Current','mini-button');current.type='button';current.setAttribute('aria-pressed','true');
    historyButton.setAttribute('aria-pressed','false');
    tools.append(historyButton);
    const label=text(tools,'label','Filter');const search=document.createElement('input');search.type='search';search.placeholder='Place, title, source or status';label.append(search);
    const more=text(tools,'button','Show 100 more','mini-button');more.type='button';let limit=100;
    const summary=text(header,'p','', 'collection-summary');summary.setAttribute('role','status');
    const change=()=>{ if (!archive.hidden) archive.renderArchive?.(); dialog.dispatchEvent?.(new Event('collectionchange')); };
    const reset=()=>{ list.hidden=false;archive.hidden=true;current.setAttribute('aria-pressed','true');historyButton.setAttribute('aria-pressed','false'); };
    reset();
    current.addEventListener('click',()=>{reset();change();});
    historyButton.addEventListener('click',()=>{list.hidden=true;archive.hidden=false;current.setAttribute('aria-pressed','false');historyButton.setAttribute('aria-pressed','true');archive.tabIndex=0;archive.focus?.();});
    search.addEventListener('input',()=>{limit=100;change();});more.addEventListener('click',()=>{limit+=100;change();});
    dialog.addEventListener('close',()=>{reset();archive.renderArchive=null;});
    return {filter:()=>search.value.trim().toLowerCase(),limit:()=>limit,reset,isHistory:()=>!archive.hidden,summary(count,total){summary.textContent=total===0?'No records in this view.':`${Math.min(count,limit)} shown of ${count}${count!==total?` matching (${total} total)`:''}.${count===0?' Clear the filter to see all records.':''}`;more.hidden=count<=limit;}};
  }
  function archiveView(archive,rows,build,collection) {
    archive.replaceChildren(); text(archive,'h3','Locally observed source history');
    const count=text(archive,'p',''); const body=text(archive,'div','');
    archive.renderArchive=()=> {
      const selected=rows.filter(row=>matches(row.event,collection.filter()));const bounded=selected.slice(0,collection.limit());
      count.textContent=`${selected.length} historical revisions match; showing ${bounded.length}. These are locally observed records, not current alerts.${selected.length?'':' No local revisions recorded.'}`;
      collection.summary?.(selected.length,rows.length);
      keyed(body,bounded.map(row=>({id:row.event.id+':'+row.sequence,event:row.event})),(parent,row)=>build(parent,row.event,true));
    };archive.renderArchive();
  }
  function matches(r, query) { return !query || JSON.stringify([r.sourceAuthority,r.domainPayload.title,r.domainPayload.headline,r.domainPayload.place,r.domainPayload.classification,r.domainPayload.status,r.domainPayload.centre,r.domainPayload.county,r.domainPayload.riverOrSea,r.domainPayload.badge,r.kind,r.domainPayload.classificationLabel,r.domainPayload.affectedAreas,r.domainPayload.areas,r.domainPayload.weatherTypes,r.domainPayload.details]).toLowerCase().includes(query); }
  globalThis.StormtraceUI={date,depth,text,keyed,healthMessage,sourceStatus,popupHealth,refreshPopupHealth,scrollTo,reducedMotion,flyOptions,collection,archiveView,matches};
})();
