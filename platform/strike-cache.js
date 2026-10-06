(() => {
  "use strict";
  // Compatibility adapter for the existing V1 database, schema and key ordering.
  const P = globalThis.StormtracePlatform;
  function load(db, cutoff, limit) {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve) => {
      const tx = db.transaction("strikes", "readonly"), index = tx.objectStore("strikes").index("time");
      const range = IDBKeyRange.lowerBound(cutoff);
      const read = (range, trim = false) => { const request = index.getAll(range); request.onsuccess = () => resolve(trim ? (request.result || []).slice(-limit) : request.result || []); request.onerror = () => resolve([]); };
      const count = index.count(range); count.onerror = () => resolve([]); tx.onabort = () => resolve([]);
      count.onsuccess = () => {
        if (count.result <= limit) { read(range); return; }
        const request = index.openKeyCursor(range); let skipped = false;
        request.onerror = () => resolve([]);
        request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve([]); return; } if (!skipped) { skipped = true; cursor.advance(count.result - limit); } else read(IDBKeyRange.lowerBound(cursor.key), true); };
      };
    });
  }
  function write(db, strikes, oncomplete) {
    const transaction = db.transaction("strikes", "readwrite"), store = transaction.objectStore("strikes");
    strikes.forEach((strike) => store.put(strike)); transaction.oncomplete = oncomplete;
  }
  function prune(db, cutoff, limit) {
    const tx = db.transaction("strikes", "readwrite"), index = tx.objectStore("strikes").index("time");
    index.openCursor(IDBKeyRange.upperBound(cutoff)).onsuccess = (event) => { const cursor = event.target.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    tx.oncomplete = () => { try { cap(db, limit); } catch { /* profile may be closing */ } };
  }
  function cap(db, limit) {
    const store = db.transaction("strikes", "readwrite").objectStore("strikes"), count = store.count();
    count.onsuccess = () => {
      let remaining = Math.max(0, count.result - limit); if (!remaining) return;
      store.index("time").openCursor().onsuccess = (event) => { const cursor = event.target.result; if (cursor && remaining > 0) { cursor.delete(); remaining--; cursor.continue(); } };
    };
  }
  Object.assign(P.strikeStorage, { load, write, prune, cap });
})();
