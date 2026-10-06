(() => {
  "use strict";
  const C = globalThis.StormtraceCore ||= {};
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  function revisionContent(event) {
    const copy = clone(event);
    // Fetch time alone is not a meaningful source revision.
    delete copy.provenance.fetchedAt;
    return canonical(copy);
  }
  class RevisionHistory {
    constructor(storage, { now = Date.now } = {}) { this.storage = storage; this.now = now; }
    async record(event) {
      const snapshot = clone(C.event(event));
      const key = JSON.stringify([snapshot.provider, snapshot.id]);
      const content = revisionContent(snapshot);
      let result;
      await this.storage.update(key, (existing) => {
        const row = existing || { provider: snapshot.provider, eventId: snapshot.id, revisions: [] };
        const last = row.revisions.at(-1);
        if (last && revisionContent(last.event) === content) { result = { added: false, revision: clone(last) }; return row; }
        const revision = { sequence: (last?.sequence || 0) + 1, persistedAt: this.now(), event: snapshot };
        row.revisions.push(revision); result = { added: true, revision: clone(revision) }; return row;
      });
      return result;
    }
    async revisions(provider, eventId) { return clone((await this.storage.get(JSON.stringify([provider, String(eventId)])))?.revisions || []); }
    async query({ from = -Infinity, to = Infinity, provider = null, time = "observedAt" } = {}) {
      if (!["observedAt", "updatedAt", "fetchedAt", "persistedAt"].includes(time)) throw new TypeError("Unknown history time field");
      return (await this.storage.entries()).flatMap(([, row]) => row.revisions.filter((r) => {
        const timestamp = time === "persistedAt" ? r.persistedAt : time === "fetchedAt" ? r.event.provenance.fetchedAt : r.event[time];
        return (!provider || row.provider === provider) && timestamp != null && timestamp >= from && timestamp <= to;
      })).map(clone);
    }
    async retain({ before, keepLatest = true, provider = null, maxEvents = null }) {
      if (!Number.isFinite(before)) throw new TypeError("Retention cutoff is required");
      if (maxEvents != null && (!Number.isInteger(maxEvents) || maxEvents < 0)) throw new TypeError("Invalid event retention limit");
      let removed = 0;
      for (const [key] of await this.storage.entries()) await this.storage.update(key, (row) => {
        if (!row) return null;
        if (provider && row.provider !== provider) return row;
        const last = row.revisions.at(-1);
        const kept = row.revisions.filter((r) => r.persistedAt >= before || (keepLatest && r === last));
        removed += row.revisions.length - kept.length;
        return kept.length ? { ...row, revisions: kept } : null;
      });
      if (maxEvents != null) {
        const rows = (await this.storage.entries()).filter(([, row]) => !provider || row.provider === provider)
          .sort((a, b) => b[1].revisions.at(-1).persistedAt - a[1].revisions.at(-1).persistedAt || a[0].localeCompare(b[0]));
        for (const [key, snapshot] of rows.slice(maxEvents)) await this.storage.update(key, (row) => {
          // Do not evict an event updated after selecting the retention candidates.
          if (!row || canonical(row) !== canonical(snapshot)) return row;
          removed += row.revisions.length; return null;
        });
      }
      return removed;
    }
  }
  Object.assign(C, { canonical, RevisionHistory });
})();
