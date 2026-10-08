(() => {
  "use strict";
  const detached = (v) => v == null ? null : JSON.parse(JSON.stringify(v));
  class MemoryStorageAdapter {
    constructor() { this.rows = new Map(); this.queue = Promise.resolve(); }
    async get(key) { await this.queue; return detached(this.rows.get(key)); }
    update(key, mutate) {
      const next = this.queue.then(() => { const value = mutate(detached(this.rows.get(key))); if (value == null) this.rows.delete(key); else this.rows.set(key, detached(value)); });
      this.queue = next.catch(() => {}); return next;
    }
    async entries() { await this.queue; return [...this.rows].map(([key, value]) => [key, detached(value)]); }
  }
  class IndexedDBStorageAdapter {
    constructor(db) { this.db = db; }
    static open(indexedDB = globalThis.indexedDB, name = "stormtrace-revisions") {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("events")) request.result.createObjectStore("events"); };
        request.onerror = () => reject(request.error);
        let blocked = false;
        request.onblocked = () => { blocked = true; reject(new Error("Revision storage upgrade blocked")); };
        request.onsuccess = () => { if (blocked) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(new IndexedDBStorageAdapter(request.result)); };
      });
    }
    get(key) { return new Promise((resolve, reject) => { const request = this.db.transaction("events", "readonly").objectStore("events").get(key); request.onsuccess = () => resolve(detached(request.result)); request.onerror = () => reject(request.error); }); }
    update(key, mutate) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction("events", "readwrite"), store = tx.objectStore("events");
        const request = store.get(key); let failure;
        request.onsuccess = () => { try { const value = mutate(detached(request.result)); if (value == null) store.delete(key); else store.put(detached(value), key); } catch (error) { failure = error; tx.abort(); } };
        tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(failure || tx.error || request.error);
      });
    }
    entries() {
      return new Promise((resolve, reject) => {
        const result = [], tx = this.db.transaction("events", "readonly"), store = tx.objectStore("events");
        // IndexedDB already returns detached structured clones. Bulk reads
        // avoid a cursor callback and an extra JSON clone for every row.
        const read = (range) => {
          const keys = store.getAllKeys(range, 256), values = store.getAll(range, 256);
          values.onsuccess = () => {
            const batch = keys.result;
            for (let index = 0; index < batch.length; index++) result.push([batch[index], values.result[index]]);
            if (batch.length === 256) read(globalThis.IDBKeyRange.lowerBound(batch.at(-1), true));
          };
        };
        read();
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    }
    close() { this.db.close(); }
  }
  const locationAdapter = { available: () => Boolean(globalThis.navigator?.geolocation), current: () => globalThis.StormtraceLocation.locate(globalThis.navigator.geolocation) };
  const notificationAdapter = {
    permission: () => globalThis.Notification?.permission || "unsupported",
    requestPermission: async () => globalThis.Notification ? globalThis.Notification.requestPermission() : "unsupported",
    show: (intent) => new globalThis.Notification(intent.title, { body: intent.body, icon: intent.icon, tag: intent.tag }),
  };
  const settingsStorage = {
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  };
  const strikeStorage = {
    open() {
      return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open("stormtrace", 1);
        request.onupgradeneeded = () => { const store = request.result.createObjectStore("strikes", { keyPath: "id" }); store.createIndex("time", "time"); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    },
  };
  const systemAdapter = { available: () => Boolean(globalThis.window?.webkit?.messageHandlers?.stormtrace), post: (action) => globalThis.window.webkit.messageHandlers.stormtrace.postMessage(action) };
  globalThis.StormtracePlatform = { MemoryStorageAdapter, IndexedDBStorageAdapter, locationAdapter, notificationAdapter, settingsStorage, strikeStorage, systemAdapter };
})();
