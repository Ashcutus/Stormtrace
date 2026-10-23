import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../core/index.js';
import '../client/presentation.js';
import '../client/warnings.js';
import '../client/public-hazards.js';
import '../client/warning-map.js';

const now = Date.now();
const square = (west, south, east, north) => ({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const warning = (id, badge, geometry, affectedAreas = [{ regionName: 'London & South East England', subRegions: ['Kent'] }], title = 'WIND', validFrom = now) => ({ id: `metoffice-warnings-esri:${id}`, provider: 'metoffice-warnings-esri', kind: 'warning', sourceAuthority: 'Met Office', observedAt: now - 60000, updatedAt: null, validFrom, validTo: now + 3600000, geometry,
  sourceSeverity: { level: badge }, displayPriority: 'high', provenance: { provider: 'metoffice-warnings-esri', sourceAuthority: 'Met Office', upstreamId: id, fetchedAt: now, observedAt: now - 60000, updatedAt: null, transformations: [] },
  domainPayload: { title, badge, affectedAreas, url: 'https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings', body: 'Storm', instruction: '', mode: 'warning', details: ['Kent'], headline: 'Damaging winds', whatToExpect: 'Disruption' } });

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.textContent = ''; this.className = ''; this.open = false; this.classes = new Set(); this.attributes = {};
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.classList = { toggle: (name, on) => { if (on) this.classes.add(name); else this.classes.delete(name); } }; }
  get firstElementChild() { return this.children[0]; }
  getBoundingClientRect() { return this.rect; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(node) { this.children.push(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  fire(name) { for (const fn of this.listeners[name] || []) fn(); }
  querySelectorAll(selector) { const found = []; const walk = (n) => { for (const c of n.children) { if ((selector === '[data-warning-id]' && c.dataset.warningId) || (selector === '.severity-chip' && c.className === 'severity-chip')) found.push(c); walk(c); } }; walk(this); return found; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
}

test('warning list entries carry official colours, highlight their map area and filter by severity', async (t) => {
  const elements = {}, get = (id) => elements[id] ||= new Element();
  const records = [warning('y', 'YELLOW', square(-6, 49, -2, 52)), warning('r', 'RED', square(-5, 50, -3, 51))];
  const areas = [];
  const chips = ['YELLOW', 'AMBER', 'RED'].map((level) => { const chip = new Element('button'); chip.className = 'severity-chip'; chip.dataset.level = level; get('warningMapDialog').append(chip); return chip; });
  const old = { document: globalThis.document, fetch: globalThis.fetch, L: globalThis.L };
  t.after(() => Object.assign(globalThis, old));
  globalThis.document = { hidden: false, getElementById: get, createElement: (tag) => new Element(tag), addEventListener() {} };
  globalThis.fetch = async function () { return { ok: true, json: async () => ({ configured: true, records, observations: [], health: { ...C.health(300000), available: true, lastSuccessfulFetch: now } }) }; };
  const fitted = [];
  const map = { setView() { return map; }, attributionControl: { setPrefix() {}, addAttribution() {} }, fitBounds(bounds) { fitted.push(bounds); }, invalidateSize() {}, closePopup() {}, on(name, fn) { (map.events ||= {})[name] = fn; return map; } };
  globalThis.L = {
    map: () => map,
    tileLayer: () => ({ addTo() { return this; } }),
    layerGroup: () => ({ addTo() { return this; }, addLayer() {}, clearLayers() { areas.length = 0; } }),
    geoJSON(geometry, { style }) {
      const label = new Element(); label.rect = { left: 0, right: 120, top: 0, bottom: 24 };
      const area = { geometry, popupOpen: false, getBounds: () => geometry.coordinates[0], openPopup() { this.popupOpen = true; }, style: { ...style }, options: { style }, label, front: 0, events: {}, setStyle(next) { Object.assign(this.style, next); }, bringToFront() { this.front++; }, getTooltip: () => ({ getElement: () => label }),
        bindTooltip() { return this; }, bindPopup() { return this; }, on(name, fn) { this.events[name] = fn; return this; } };
      areas.push(area); return area;
    },
  };
  t.after(() => get('warningMapDialog').close());
  globalThis.StormtraceWarningMap.mount();
  get('warningMapButton').fire('click');
  for (let i = 0; i < 100 && areas.length < 2; i++) await new Promise((resolve) => setImmediate(resolve));

  const buttons = get('warningMapList').children;
  assert.deepEqual(buttons.map((b) => b.style['--warning-colour']), ['#FFE923', '#CC0033']);
  const badge = buttons[1].children[0];
  assert.equal(badge.textContent, 'RED · WIND');
  assert.deepEqual([badge.style.background, badge.style.color], ['#CC0033', '#fff']);
  assert.equal(buttons[1].children[1].textContent, 'Kent');

  const [yellow, red] = areas;
  // Overlapping centre labels: the most severe shows, the focused one wins while emphasised.
  assert.ok(yellow.label.classes.has('collided')); assert.ok(!red.label.classes.has('collided'));
  buttons[0].fire('mouseenter');
  assert.ok(!yellow.label.classes.has('collided')); assert.ok(red.label.classes.has('collided'));
  buttons[0].fire('mouseleave');
  assert.ok(yellow.label.classes.has('collided')); assert.ok(!red.label.classes.has('collided'));
  yellow.label.rect = { left: 200, right: 320, top: 0, bottom: 24 }; map.events.zoomend();
  assert.ok(!yellow.label.classes.has('collided'), 'separated labels both show after zooming');
  yellow.label.rect = { left: 0, right: 120, top: 0, bottom: 24 }; map.events.zoomend();
  buttons[1].fire('mouseenter');
  assert.equal(red.style.weight, 5); assert.equal(red.front, 1); assert.ok(yellow.style.fillOpacity < 0.4);
  assert.equal(red.style.color, '#CC0033', 'official colours are not changed by highlighting');
  assert.ok(buttons[1].classes.has('active')); assert.ok(!buttons[0].classes.has('active'));
  assert.ok(red.label.classes.has('active')); assert.ok(yellow.label.classes.has('dimmed')); assert.equal(red.label.style['--warning-colour'], '#CC0033');
  buttons[1].fire('mouseleave');
  assert.equal(red.style.weight, 2); assert.equal(yellow.style.fillOpacity, 0.4); assert.ok(!buttons[1].classes.has('active'));
  assert.ok(!red.label.classes.has('active')); assert.ok(!yellow.label.classes.has('dimmed'));

  buttons[0].fire('focus');
  assert.equal(yellow.style.weight, 5);
  buttons[0].fire('blur');
  assert.equal(yellow.style.weight, 2);

  red.events.mouseover();
  assert.ok(buttons[1].classes.has('active'));
  red.events.mouseout();
  assert.ok(!buttons[1].classes.has('active'));

  // Severity chips filter both the map and the list, and report what each level contains.
  assert.deepEqual(chips.map((c) => [c.textContent, c.attributes['aria-pressed']]), [['Yellow 1', 'true'], ['Amber 0', 'true'], ['Red 1', 'true']]);
  chips[0].fire('click');
  assert.deepEqual(areas.map((a) => a.style.color), ['#CC0033']);
  assert.deepEqual(get('warningMapList').children.map((b) => b.children[0].textContent), ['RED · WIND']);
  assert.equal(chips[0].attributes['aria-pressed'], 'false');
  assert.equal(chips[0].textContent, 'Yellow 1', 'hidden levels keep their count');
  assert.match(get('warningMapStatus').textContent, /1 of 2 current or future areas shown; other severity levels are hidden\./);
  chips[2].fire('click');
  assert.equal(areas.length, 0); assert.equal(get('warningMapList').children.length, 0);
  chips[0].fire('click'); chips[2].fire('click');
  assert.equal(areas.length, 2); assert.match(get('warningMapStatus').textContent, / 2 current or future areas shown\./);

  // Opening a warning from the list focuses its area, even when its level was hidden.
  chips[2].fire('click');
  get('warningsDialog').open = true;
  globalThis.StormtraceWarningMap.show({ level: 'RED', types: ['wind'], areas: [{ regionName: 'London & South East England', subRegions: ['Kent'] }] });
  assert.equal(get('warningsDialog').open, false);
  assert.equal(chips[2].attributes['aria-pressed'], 'true');
  const focused = areas.find((a) => a.style.color === '#CC0033');
  assert.deepEqual(fitted.at(-1), focused.geometry.coordinates[0]);
  assert.ok(focused.popupOpen); assert.equal(focused.style.weight, 5, 'the focused area stays emphasised');
  focused.events.popupclose();
  assert.equal(focused.style.weight, 2);

  globalThis.StormtraceWarningMap.show({ level: 'AMBER', types: ['wind'], areas: [{ regionName: 'London & South East England', subRegions: ['Kent'] }] });
  for (let i = 0; i < 100 && !/no matching area/.test(get('warningMapStatus').textContent); i++) await new Promise((resolve) => setImmediate(resolve));
  assert.match(get('warningMapStatus').textContent, /no matching area on this map service yet/);
  get('warningMapDialog').close();
});

test('warnings match the map area with the closest places, ignoring other levels and weather types', () => {
  const { matchArea } = globalThis.StormtraceWarningMap;
  const area = (id, badge, title, areas, validFrom) => warning(id, badge, square(0, 0, 1, 1), areas, title, validFrom);
  const broad = area('broad', 'YELLOW', 'WIND', [{ regionName: 'South West England', subRegions: ['Bath and North East Somerset', 'Bristol', 'Cornwall', 'Devon', 'Gloucestershire'] }, { regionName: 'Wales', subRegions: ['Cardiff'] }]);
  const exact = area('exact', 'YELLOW', 'WIND', [{ regionName: 'East Midlands', subRegions: ['Derby'] }, { regionName: 'South West England', subRegions: ['Gloucestershire', 'South Gloucestershire', 'Swindon', 'Wiltshire'] }]);
  const rain = area('rain', 'YELLOW', 'RAIN', [{ regionName: 'South West England', subRegions: ['Gloucestershire', 'South Gloucestershire', 'Swindon', 'Wiltshire'] }]);
  const amber = area('amber', 'AMBER', 'WIND', [{ regionName: 'South West England', subRegions: ['Cornwall', 'Devon'] }]);
  const records = [broad, exact, rain, amber];
  const query = (level, places, types = ['wind'], validFrom) => ({ level, types, areas: [{ regionName: 'South West England', subRegions: places }], validFrom });
  assert.equal(matchArea(query('YELLOW', ['Gloucestershire', 'South Gloucestershire', 'Swindon', 'Wiltshire']), records), exact);
  assert.equal(matchArea(query('YELLOW', ['Bristol', 'Cornwall', 'Devon']), records), broad);
  assert.equal(matchArea(query('YELLOW', ['Gloucestershire'], ['rain']), records), rain);
  assert.equal(matchArea(query('AMBER', ['Cornwall', 'Devon']), records), amber);
  assert.equal(matchArea(query('RED', ['Cornwall']), records), null);
  assert.equal(matchArea({ level: 'YELLOW', types: ['wind'], areas: [{ regionName: 'Orkney & Shetland', subRegions: [] }] }, records), null);
  // A summary whose place names differ from the area's still matches on its region and shared places.
  const highland = area('highland', 'YELLOW', 'WIND', [{ regionName: 'Highlands & Eilean Siar', subRegions: ['Eilean Siar', 'Highland'] }]);
  assert.equal(matchArea({ level: 'YELLOW', types: ['wind'], areas: [{ regionName: 'Highlands & Eilean Siar', subRegions: ['Na h-Eileanan Siar', 'Highland'] }] }, [highland]), highland);
  // Identical places fall back to the closest start time.
  const later = area('later', 'YELLOW', 'WIND', exact.domainPayload.affectedAreas, now + 86400000);
  assert.equal(matchArea(query('YELLOW', ['Gloucestershire', 'South Gloucestershire', 'Swindon', 'Wiltshire'], ['wind'], now + 86000000), [exact, later]), later);
});
