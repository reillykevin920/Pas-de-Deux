(() => {
  'use strict';

  const STORAGE_KEY = 'sundance-row-map:v1';
  const DB_NAME = 'sundance-row-map-handles';
  const DB_STORE = 'handles';
  const FESTIVAL_START = '2027-01-21';
  const FESTIVAL_END = '2027-01-31';
  const VENUE_NEAR_FEET = 500;
  const BOULDER_CENTER = [40.0176, -105.2797];

  const ADDRESS_QUERY = 'https://gis.bouldercolorado.gov/ags_svr1/rest/services/plan/AddressPoints/MapServer/0/query';
  const BUILDING_QUERY = 'https://gis.bouldercolorado.gov/ags_svr3/rest/services/pw/BuildingFootprints/MapServer/0/query';

  // Official 2027 venue list grouped by physical site. Addresses are used only to locate the sites.
  const VENUES = [
    { id:'boulder-theater', name:'Boulder Theater', addressNumber:'2032', street:'14th', address:'2032 14th St', uses:'Screenings' },
    { id:'boulder-high', name:'Boulder High School Auditorium', addressNumber:'1604', street:'Arapahoe', address:'1604 Arapahoe Ave', uses:'Screenings' },
    { id:'casey', name:'Casey Middle School Auditorium', addressNumber:'1301', street:'High', address:'1301 High St', uses:'Screenings' },
    { id:'chautauqua', name:'Chautauqua Auditorium', addressNumber:'900', street:'Baseline', address:'900 Baseline Rd', uses:'Screenings' },
    { id:'cinemark', name:'Cinemark Century Boulder', addressNumber:'1700', street:'29th', address:'1700 29th St', uses:'Press & industry screenings' },
    { id:'etown', name:'eTown Hall', addressNumber:'1535', street:'Spruce', address:'1535 Spruce St', uses:'Screenings + programming' },
    { id:'dairy', name:'Dairy Arts Center', addressNumber:'2590', street:'Walnut', address:'2590 Walnut St', uses:'Boedecker Theater • Gordon Gamm Theater • programming' },
    { id:'macky', name:'Macky Auditorium Concert Hall', addressNumber:'1595', street:'Pleasant', address:'1595 Pleasant St', uses:'Screenings' },
    { id:'muenzinger', name:'Muenzinger Auditorium', addressNumber:'1905', street:'Colorado', address:'1905 Colorado Ave', uses:'Screenings' },
    { id:'roe-green', name:'Roe Green Theatre', addressNumber:'1515', street:'Central Campus Mall', address:'1515 Central Campus Mall', uses:'Screenings' },
    { id:'old-main', name:'Old Main', addressNumber:'1540', street:'Pleasant', address:'1540 Pleasant St', uses:'Talks + programming' },
    { id:'canyon', name:'Canyon Theater — Boulder Public Library', addressNumber:'1001', street:'Arapahoe', address:'1001 Arapahoe Ave', uses:'Talks + programming' }
  ];


  const STATUS_VALUES = ['Application','Upcoming','Active','Closed','Archived'];

  let state = loadState();
  let map;
  let permitCluster;
  let venueLayer;
  let venueBuildingLayer;
  let venueContextLayer;
  let corridorLayer;
  let currentPermitId = null;
  let pendingCorridorLatLngs = null;
  let currentCorridorId = null;
  let mapMovePermitId = null;
  let manualPlacePermitId = null;
  let folderHandle = null;
  let renderScheduled = false;
  let toastTimer = null;
  const corridorRuntime = new Map();
  const venueRuntime = new Map();
  const addressLookupCache = new Map();

  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();
    initMap();
    initStatusFilters();
    bindUI();

    if (!state.initialized) {
      state.initialized = true;
      saveState();
      toast('Ready. Connect a permit folder or drag permit PDFs/folders onto the map. Only filenames will be used.');
    }

    folderHandle = await idbGet('permitFolder');
    updateFolderButton();
    rebuildCorridors();
    await resolveVenues();
    await locateUnlocatedPermits({ quiet:true });
    renderAll();
  }

  function cacheElements() {
    [
      'visibleCount','totalCount','unlocatedCount','connectFolderBtn','filePicker','exportBtn','importBackup',
      'layerPermits','layerVenues','layerBuildings','layerVenueContext','layerCorridors','fitAllBtn','drawCorridorBtn','corridorList',
      'searchFilter','statusFilters','dateFrom','dateTo','festivalWindowBtn','clearDatesBtn','workTypeFilter','contractorFilter','corridorOnlyFilter',
      'venueOnlyFilter','hideClosedFilter','hideArchivedFilter','resetFiltersBtn','showUnlocatedBtn','exportCsvBtn',
      'clearAllBtn','map','dropZone','toast','permitDialog','permitForm','permitDialogTitle','sourceBlock','matchInfo',
      'movePinBtn','retryLocateBtn','archivePermitBtn','deletePermitBtn','corridorDialog','corridorForm','unlocatedDialog',
      'closeUnlocatedBtn','unlocatedList'
    ].forEach(id => els[id] = document.getElementById(id));
  }

  function initMap() {
    map = L.map('map', { zoomControl:true, preferCanvas:true }).setView(BOULDER_CENTER, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:20,
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map);

    permitCluster = L.markerClusterGroup({ disableClusteringAtZoom:17, showCoverageOnHover:false, maxClusterRadius:46 });
    venueLayer = L.layerGroup().addTo(map);
    venueBuildingLayer = L.layerGroup().addTo(map);
    venueContextLayer = L.layerGroup();
    corridorLayer = L.layerGroup().addTo(map);
    permitCluster.addTo(map);

    const legend = L.control({ position:'bottomleft' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div','legend-box');
      div.innerHTML = `
        <div><span class="legend-dot" style="background:#c77dff"></span>Application</div>
        <div><span class="legend-dot" style="background:#4db6ff"></span>Upcoming</div>
        <div><span class="legend-dot" style="background:#ff9f43"></span>Active</div>
        <div><span class="legend-dot" style="background:#7d8792"></span>Closed</div>
        <div><span class="legend-dot" style="background:#e7ff66"></span>Sundance venue</div>`;
      return div;
    };
    legend.addTo(map);

    map.on(L.Draw.Event.CREATED, e => {
      if (e.layerType !== 'polyline') return;
      pendingCorridorLatLngs = e.layer.getLatLngs().map(ll => [ll.lat, ll.lng]);
      currentCorridorId = null;
      els.corridorForm.reset();
      els.corridorForm.elements.bufferFeet.value = 150;
      els.corridorDialog.showModal();
    });

    map.on('click', e => {
      if (mapMovePermitId || manualPlacePermitId) {
        const id = mapMovePermitId || manualPlacePermitId;
        const permit = state.permits.find(p => p.id === id);
        if (!permit) return;
        permit.lat = e.latlng.lat;
        permit.lng = e.latlng.lng;
        permit.matchMethod = 'manual';
        permit.matchedFullAddr = 'Manual map placement';
        permit.updatedAt = new Date().toISOString();
        mapMovePermitId = null;
        manualPlacePermitId = null;
        saveState();
        renderAll();
        toast('Pin location saved manually.');
      }
    });
  }

  function initStatusFilters() {
    els.statusFilters.innerHTML = STATUS_VALUES.map(s => {
      const checked = s === 'Application' || s === 'Upcoming' || s === 'Active' || s === 'Closed';
      return `<label class="chip"><input type="checkbox" data-status="${escapeHtml(s)}" ${checked ? 'checked':''}>${escapeHtml(s)}</label>`;
    }).join('');
  }

  function bindUI() {
    els.connectFolderBtn.addEventListener('click', connectOrSyncFolder);
    els.filePicker.addEventListener('change', async e => {
      const names = [...e.target.files]
        .filter(f => f.name.toLowerCase().endsWith('.pdf'))
        .map(f => ({ name:f.name, relativePath:f.webkitRelativePath || f.name }));
      await importNames(names);
      e.target.value = '';
    });

    els.exportBtn.addEventListener('click', exportBackup);
    els.importBackup.addEventListener('change', importBackup);
    els.exportCsvBtn.addEventListener('click', exportCsv);
    els.clearAllBtn.addEventListener('click', clearAllData);
    els.fitAllBtn.addEventListener('click', fitAll);
    els.drawCorridorBtn.addEventListener('click', () => {
      new L.Draw.Polyline(map, { shapeOptions:{ color:'#4db6ff', weight:5, opacity:.9 } }).enable();
      toast('Click along the route; click the last point again to finish.');
    });

    ['layerPermits','layerVenues','layerBuildings','layerVenueContext','layerCorridors'].forEach(id => els[id].addEventListener('change', updateLayerVisibility));
    ['searchFilter','dateFrom','dateTo','workTypeFilter','contractorFilter','corridorOnlyFilter','venueOnlyFilter','hideClosedFilter','hideArchivedFilter']
      .forEach(id => els[id].addEventListener('input', scheduleRender));
    els.statusFilters.addEventListener('change', scheduleRender);
    els.resetFiltersBtn.addEventListener('click', resetFilters);
    els.festivalWindowBtn.addEventListener('click', () => { els.dateFrom.value=FESTIVAL_START; els.dateTo.value=FESTIVAL_END; renderAll(); });
    els.clearDatesBtn.addEventListener('click', () => { els.dateFrom.value=''; els.dateTo.value=''; renderAll(); });

    els.permitForm.addEventListener('submit', savePermitForm);
    els.movePinBtn.addEventListener('click', startMoveCurrentPermit);
    els.retryLocateBtn.addEventListener('click', retryCurrentPermitLocation);
    els.archivePermitBtn.addEventListener('click', archiveCurrentPermit);
    els.deletePermitBtn.addEventListener('click', deleteCurrentPermit);

    els.corridorForm.addEventListener('submit', saveCorridorForm);
    els.showUnlocatedBtn.addEventListener('click', showUnlocated);
    els.closeUnlocatedBtn.addEventListener('click', () => els.unlocatedDialog.close());

    window.addEventListener('dragenter', e => { e.preventDefault(); els.dropZone.classList.add('visible'); });
    window.addEventListener('dragover', e => { e.preventDefault(); els.dropZone.classList.add('visible'); });
    window.addEventListener('dragleave', e => {
      if (e.target === document.documentElement || e.target === document.body) els.dropZone.classList.remove('visible');
    });
    window.addEventListener('drop', handleDrop);
  }

  async function handleDrop(e) {
    e.preventDefault();
    els.dropZone.classList.remove('visible');
    const names = [];
    const items = [...(e.dataTransfer.items || [])];
    if (items.length && items[0].webkitGetAsEntry) {
      for (const item of items) {
        const entry = item.webkitGetAsEntry();
        if (entry) await collectEntryNames(entry, '', names);
      }
    } else {
      for (const file of [...e.dataTransfer.files]) {
        if (file.name.toLowerCase().endsWith('.pdf')) names.push({ name:file.name, relativePath:file.name });
      }
    }
    await importNames(names);
  }

  async function collectEntryNames(entry, parentPath, out) {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
      if (entry.name.toLowerCase().endsWith('.pdf')) out.push({ name:entry.name, relativePath:path });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = entry.createReader();
    while (true) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await collectEntryNames(child, path, out);
    }
  }

  async function connectOrSyncFolder() {
    try {
      if (!('showDirectoryPicker' in window)) {
        toast('This browser does not support folder connection. Use Import filenames / drag-and-drop instead.');
        return;
      }
      if (!folderHandle) {
        folderHandle = await window.showDirectoryPicker({ mode:'read' });
        await idbSet('permitFolder', folderHandle);
      } else {
        const permission = await verifyPermission(folderHandle);
        if (!permission) {
          folderHandle = await window.showDirectoryPicker({ mode:'read' });
          await idbSet('permitFolder', folderHandle);
        }
      }
      updateFolderButton();
      const names = [];
      await scanDirectoryHandle(folderHandle, '', names);
      await importNames(names);
    } catch (err) {
      if (err?.name !== 'AbortError') toast(`Folder scan failed: ${err.message || err}`);
    }
  }

  async function scanDirectoryHandle(handle, parentPath, out) {
    for await (const [name, child] of handle.entries()) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      if (child.kind === 'directory') {
        await scanDirectoryHandle(child, path, out);
      } else if (name.toLowerCase().endsWith('.pdf')) {
        // Intentionally do not call child.getFile(). Filename only.
        out.push({ name, relativePath:path });
      }
    }
  }

  async function verifyPermission(handle) {
    const opts = { mode:'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  function updateFolderButton() {
    els.connectFolderBtn.textContent = folderHandle ? 'Sync permit folder' : 'Connect permit folder';
  }

  async function importNames(entries, opts={}) {
    if (!entries.length) {
      if (!opts.silent) toast('No PDF filenames found.');
      return;
    }
    let added = 0, known = 0, invalid = 0;
    for (const entry of entries) {
      const parsed = parsePermitFilename(entry.name);
      if (!parsed) { invalid++; continue; }
      const existing = state.permits.find(p => p.sourceFilename === entry.name);
      if (existing) {
        known++;
        if (!existing.relativePath && entry.relativePath) existing.relativePath = entry.relativePath;
        continue;
      }
      state.permits.push({
        id: cryptoRandomId('permit'),
        sourceFilename:entry.name,
        relativePath:entry.relativePath || entry.name,
        addressNumber:parsed.addressNumber,
        street:parsed.street,
        workType:parsed.workType,
        contractor:parsed.contractor,
        permitNumber:'',
        status:'Application',
        startDate:'',
        endDate:'',
        rowImpact:'',
        notes:'',
        lat:null,
        lng:null,
        matchMethod:'',
        matchedFullAddr:'',
        importedAt:new Date().toISOString(),
        updatedAt:new Date().toISOString()
      });
      added++;
    }
    saveState();
    refreshFilterOptions();
    await locateUnlocatedPermits({ quiet:true, onlyRecent:true });
    renderAll();
    if (!opts.silent) toast(`${added} added • ${known} already known${invalid ? ` • ${invalid} filename${invalid===1?'':'s'} skipped`:''}. No PDF contents read.`);
  }

  function parsePermitFilename(filename) {
    if (!/\.pdf$/i.test(filename)) return null;
    const base = filename.replace(/\.pdf$/i, '');
    const parts = base.split(' - ');
    if (parts.length < 4) return null;
    return {
      addressNumber:parts[0],
      street:parts[1],
      workType:parts[2],
      contractor:parts.slice(3).join(' - ')
    };
  }

  async function locateUnlocatedPermits({ quiet=false }={}) {
    const queue = state.permits.filter(p => !isFiniteNumber(p.lat) || !isFiniteNumber(p.lng));
    let located = 0;
    for (const permit of queue) {
      const ok = await locatePermit(permit, false, true);
      if (ok) located++;
    }
    saveState();
    if (!quiet && located) toast(`Located ${located} permit${located===1?'':'s'} using Boulder public address data.`);
  }

  async function locatePermit(permit, force=false, quiet=false) {
    if (!permit || (!force && isFiniteNumber(permit.lat) && isFiniteNumber(permit.lng))) return true;
    try {
      const result = await queryAddressPoint(permit.addressNumber, permit.street);
      if (!result) {
        permit.matchMethod = 'unlocated';
        permit.matchedFullAddr = '';
        if (!quiet) toast(`No confident public-address match for ${displayAddress(permit)}.`);
        return false;
      }
      permit.lat = result.lat;
      permit.lng = result.lng;
      permit.matchMethod = 'Boulder Address Points';
      permit.matchedFullAddr = result.fullAddr || '';
      permit.updatedAt = new Date().toISOString();
      return true;
    } catch (err) {
      permit.matchMethod = permit.matchMethod || 'lookup unavailable';
      if (!quiet) toast('Boulder address lookup is unavailable right now; the permit remains in the unlocated list.');
      return false;
    }
  }

  async function queryAddressPoint(addressNumberRaw, streetRaw) {
    const cacheKey = `${String(addressNumberRaw).trim()}|${normalizeMatch(streetRaw)}`;
    if (addressLookupCache.has(cacheKey)) return addressLookupCache.get(cacheKey);
    const addressNumber = String(addressNumberRaw).trim().replace(/'/g,"''");
    const params = new URLSearchParams({
      where:`ADDRNUM='${addressNumber}'`,
      outFields:'FULLADDR,ADDRNUM,PREDIR,STREETNAME,STREETSUFFIX,POSTDIR,CITY,STATUS,POINTTYPE',
      returnGeometry:'true',
      outSR:'4326',
      resultRecordCount:'50',
      f:'geojson'
    });
    const res = await fetch(`${ADDRESS_QUERY}?${params}`);
    if (!res.ok) throw new Error(`Address service ${res.status}`);
    const data = await res.json();
    const candidates = (data.features || []).filter(f => Array.isArray(f.geometry?.coordinates));
    if (!candidates.length) { addressLookupCache.set(cacheKey, null); return null; }
    const scored = candidates.map(f => ({ f, score:scoreAddressCandidate(streetRaw, f.properties || {}) })).sort((a,b) => b.score-a.score);
    if (scored[0].score < 45) { addressLookupCache.set(cacheKey, null); return null; }
    const f = scored[0].f;
    const result = { lng:f.geometry.coordinates[0], lat:f.geometry.coordinates[1], fullAddr:f.properties?.FULLADDR || '' };
    addressLookupCache.set(cacheKey, result);
    return result;
  }

  function scoreAddressCandidate(sourceStreet, props) {
    const src = normalizeMatch(sourceStreet);
    const predir = normalizeMatch(props.PREDIR || '');
    const name = normalizeMatch(props.STREETNAME || '');
    const suffix = normalizeMatch(props.STREETSUFFIX || '');
    const postdir = normalizeMatch(props.POSTDIR || '');
    const full = [predir,name,suffix,postdir].filter(Boolean).join(' ');
    const noSuffix = [predir,name,postdir].filter(Boolean).join(' ');
    let score = 0;
    if (src === full) score += 100;
    if (src === noSuffix) score += 95;
    if (src === name) score += 85;
    if (full.startsWith(src + ' ')) score += 65;
    if (noSuffix.startsWith(src + ' ')) score += 65;
    if (name === src.replace(/^(n|s|e|w)\s+/,'')) score += 55;
    if ((props.CITY || '').toLowerCase() === 'boulder') score += 10;
    if ((props.STATUS || '').toLowerCase() === 'current') score += 5;
    if ((props.POINTTYPE || '').toLowerCase() === 'building') score += 3;
    return score;
  }

  async function resolveVenues() {
    venueLayer.clearLayers();
    venueBuildingLayer.clearLayers();
    venueContextLayer.clearLayers();
    for (const venue of VENUES) {
      try {
        const loc = await queryAddressPoint(venue.addressNumber, venue.street);
        if (!loc) continue;
        venue.lat = loc.lat; venue.lng = loc.lng; venue.matchedFullAddr = loc.fullAddr;
        venueRuntime.set(venue.id, venue);
        addVenueMarker(venue);
        L.circle([venue.lat,venue.lng], { radius:VENUE_NEAR_FEET*0.3048, color:'#e7ff66', weight:1, opacity:.22, fillColor:'#e7ff66', fillOpacity:.035, dashArray:'4 5', interactive:false }).addTo(venueContextLayer);
        await addVenueBuilding(venue);
      } catch (err) {
        console.warn('Venue lookup failed', venue.name, err);
      }
    }
    updateLayerVisibility();
  }

  function addVenueMarker(venue) {
    const icon = L.divIcon({ className:'', html:'<div class="venue-marker"><span>S</span></div>', iconSize:[22,22], iconAnchor:[11,11] });
    const marker = L.marker([venue.lat, venue.lng], { icon, zIndexOffset:500 });
    marker.bindPopup(`<div class="popup-title">${escapeHtml(venue.name)}</div><div class="popup-row">${escapeHtml(venue.address)}</div><div class="popup-row">${escapeHtml(venue.uses)}</div>`);
    marker.addTo(venueLayer);
  }

  async function addVenueBuilding(venue) {
    const params = new URLSearchParams({
      where:'1=1',
      geometry:`${venue.lng},${venue.lat}`,
      geometryType:'esriGeometryPoint',
      inSR:'4326',
      spatialRel:'esriSpatialRelIntersects',
      distance:'120',
      units:'esriSRUnit_Meter',
      outFields:'FACILITYID,SHORTNAME,LONGNAME,BLDGTYPE',
      returnGeometry:'true',
      outSR:'4326',
      resultRecordCount:'100',
      f:'geojson'
    });
    const res = await fetch(`${BUILDING_QUERY}?${params}`);
    if (!res.ok) throw new Error(`Building service ${res.status}`);
    const data = await res.json();
    const features = data.features || [];
    if (!features.length) return;
    const point = turf.point([venue.lng, venue.lat]);
    const ranked = features.map(f => ({ f, score:scoreBuilding(venue, point, f) })).sort((a,b) => b.score-a.score);
    const best = ranked[0]?.f;
    if (!best) return;
    const facilityId = best.properties?.FACILITYID || `${venue.id}:${JSON.stringify(best.geometry).slice(0,100)}`;
    if ([...venueBuildingLayer.getLayers()].some(l => l.options?.facilityId === facilityId)) return;
    const layer = L.geoJSON(best, {
      style:{ color:'#e7ff66', weight:2, fillColor:'#e7ff66', fillOpacity:.28 },
      onEachFeature:(_f,l) => l.bindPopup(`<div class="popup-title">Sundance venue building</div><div class="popup-row">${escapeHtml(venue.name)}</div>`)
    });
    layer.options.facilityId = facilityId;
    layer.eachLayer(l => { l.options.facilityId = facilityId; });
    layer.addTo(venueBuildingLayer);
  }

  function scoreBuilding(venue, point, feature) {
    let score = 0;
    try { if (turf.booleanPointInPolygon(point, feature)) score += 200; } catch {}
    const label = normalizeMatch(`${feature.properties?.LONGNAME || ''} ${feature.properties?.SHORTNAME || ''}`);
    for (const token of normalizeMatch(venue.name).split(' ').filter(t => t.length > 3)) if (label.includes(token)) score += 15;
    try {
      const line = turf.polygonToLine(feature);
      const d = turf.pointToLineDistance(point, line, { units:'meters' });
      score -= Math.min(d,150);
    } catch {}
    return score;
  }

  function rebuildCorridors() {
    corridorLayer.clearLayers();
    corridorRuntime.clear();
    for (const corridor of state.corridors) addCorridorRuntime(corridor);
    renderCorridorList();
  }

  function addCorridorRuntime(corridor) {
    const group = L.layerGroup();
    const latlngs = corridor.latlngs.map(([lat,lng]) => L.latLng(lat,lng));
    let bufferLayer = null;
    const bufferFeet = Number(corridor.bufferFeet || 0);
    if (bufferFeet > 0 && latlngs.length > 1) {
      try {
        const line = turf.lineString(latlngs.map(ll => [ll.lng,ll.lat]));
        const buffered = turf.buffer(line, bufferFeet, { units:'feet' });
        if (buffered) bufferLayer = L.geoJSON(buffered, { style:{ color:'#4db6ff', weight:1, opacity:.2, fillColor:'#4db6ff', fillOpacity:.08, dashArray:'4 5' } }).addTo(group);
      } catch {}
    }
    const line = L.polyline(latlngs, { color:'#4db6ff', weight:corridor.priority==='Primary'?6:4, opacity:.9 }).addTo(group);
    line.bindPopup(`<div class="popup-title">${escapeHtml(corridor.name)}</div><div class="popup-row"><span class="popup-label">Priority</span>${escapeHtml(corridor.priority)}</div><div class="popup-row"><span class="popup-label">Buffer</span>${escapeHtml(String(corridor.bufferFeet || 0))} ft</div>`);
    group.addTo(corridorLayer);
    corridorRuntime.set(corridor.id, { group, line, bufferLayer });
  }

  function renderCorridorList() {
    if (!state.corridors.length) {
      els.corridorList.innerHTML = '<div class="hint">No corridors drawn yet.</div>';
      return;
    }
    els.corridorList.innerHTML = state.corridors.map(c => `
      <div class="mini-card" data-corridor="${escapeHtml(c.id)}">
        <div class="mini-card-main"><div class="mini-card-name">${escapeHtml(c.name)}</div><div class="mini-card-meta">${escapeHtml(c.priority)} • ${escapeHtml(String(c.bufferFeet||0))} ft context buffer</div></div>
        <div class="mini-card-actions">
          <button class="tiny-btn" data-action="edit">Edit</button>
          <button class="tiny-btn" data-action="shape">Shape</button>
          <button class="tiny-btn" data-action="delete">×</button>
        </div>
      </div>`).join('');
    els.corridorList.querySelectorAll('.mini-card').forEach(card => {
      card.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = card.dataset.corridor;
        if (btn.dataset.action === 'edit') editCorridor(id);
        if (btn.dataset.action === 'shape') toggleCorridorShape(id, btn);
        if (btn.dataset.action === 'delete') deleteCorridor(id);
      });
    });
  }

  function editCorridor(id) {
    const c = state.corridors.find(x => x.id===id); if (!c) return;
    currentCorridorId = id;
    pendingCorridorLatLngs = null;
    els.corridorForm.elements.name.value = c.name;
    els.corridorForm.elements.priority.value = c.priority;
    els.corridorForm.elements.bufferFeet.value = c.bufferFeet;
    els.corridorForm.elements.notes.value = c.notes || '';
    els.corridorDialog.showModal();
  }

  function toggleCorridorShape(id, btn) {
    const runtime = corridorRuntime.get(id);
    const c = state.corridors.find(x => x.id===id);
    if (!runtime || !c) return;
    if (!runtime.line.editing?.enabled()) {
      runtime.line.editing.enable();
      btn.textContent = 'Save';
      toast('Drag corridor vertices, then click Save.');
    } else {
      runtime.line.editing.disable();
      c.latlngs = runtime.line.getLatLngs().map(ll => [ll.lat,ll.lng]);
      c.updatedAt = new Date().toISOString();
      saveState();
      rebuildCorridors();
      renderAll();
      toast('Corridor shape saved.');
    }
  }

  function deleteCorridor(id) {
    const c = state.corridors.find(x => x.id===id); if (!c) return;
    if (!confirm(`Delete corridor “${c.name}”?`)) return;
    state.corridors = state.corridors.filter(x => x.id!==id);
    saveState();
    rebuildCorridors();
    renderAll();
  }

  function saveCorridorForm(e) {
    e.preventDefault();
    const form = new FormData(els.corridorForm);
    if (currentCorridorId) {
      const c = state.corridors.find(x => x.id===currentCorridorId);
      if (!c) return;
      c.name = String(form.get('name') || 'Corridor');
      c.priority = String(form.get('priority') || 'Primary');
      c.bufferFeet = Number(form.get('bufferFeet') || 0);
      c.notes = String(form.get('notes') || '');
      c.updatedAt = new Date().toISOString();
    } else if (pendingCorridorLatLngs?.length > 1) {
      state.corridors.push({
        id:cryptoRandomId('corridor'),
        name:String(form.get('name') || 'Corridor'),
        priority:String(form.get('priority') || 'Primary'),
        bufferFeet:Number(form.get('bufferFeet') || 0),
        notes:String(form.get('notes') || ''),
        latlngs:pendingCorridorLatLngs,
        createdAt:new Date().toISOString(),
        updatedAt:new Date().toISOString()
      });
    }
    currentCorridorId = null;
    pendingCorridorLatLngs = null;
    saveState();
    els.corridorDialog.close();
    rebuildCorridors();
    renderAll();
  }

  function renderAll() {
    refreshFilterOptions();
    renderPermits();
    renderCorridorList();
    updateStats();
    updateLayerVisibility();
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => { renderScheduled=false; renderAll(); });
  }

  function renderPermits() {
    permitCluster.clearLayers();
    const visible = filteredPermits();
    for (const permit of visible) {
      if (!isFiniteNumber(permit.lat) || !isFiniteNumber(permit.lng)) continue;
      const icon = L.divIcon({
        className:'',
        html:`<div class="permit-marker ${statusClass(permit.status)}"><span></span></div>`,
        iconSize:[18,18], iconAnchor:[9,18], popupAnchor:[0,-16]
      });
      const marker = L.marker([permit.lat,permit.lng], { icon, title:displayAddress(permit) });
      marker.bindPopup(permitPopupHtml(permit));
      marker.on('popupopen', e => {
        const button = e.popup.getElement()?.querySelector('[data-edit-permit]');
        if (button) button.addEventListener('click', () => openPermitDialog(permit.id), { once:true });
      });
      permitCluster.addLayer(marker);
    }
  }

  function permitPopupHtml(p) {
    return `<div>
      <div class="popup-title">${escapeHtml(displayAddress(p))}</div>
      <div class="popup-row"><span class="popup-label">Work</span>${escapeHtml(prettySource(p.workType))}</div>
      <div class="popup-row"><span class="popup-label">Contractor</span>${escapeHtml(prettySource(p.contractor))}</div>
      ${p.permitNumber ? `<div class="popup-row"><span class="popup-label">Permit</span>${escapeHtml(p.permitNumber)}</div>`:''}
      <div class="popup-row"><span class="popup-label">Status</span>${escapeHtml(p.status)}</div>
      ${p.rowImpact ? `<div class="popup-row"><span class="popup-label">ROW</span>${escapeHtml(p.rowImpact)}</div>`:''}
      ${p.startDate || p.endDate ? `<div class="popup-row"><span class="popup-label">Dates</span>${escapeHtml(p.startDate||'—')} → ${escapeHtml(p.endDate||'—')}</div>`:''}
      <button class="popup-btn" data-edit-permit="${escapeHtml(p.id)}">Open permit record</button>
    </div>`;
  }

  function openPermitDialog(id) {
    const p = state.permits.find(x => x.id===id); if (!p) return;
    currentPermitId = id;
    els.permitDialogTitle.textContent = displayAddress(p);
    els.sourceBlock.innerHTML = `<div class="source-grid">
      <div class="source-item"><strong>Address # — source</strong>${escapeHtml(p.addressNumber)}</div>
      <div class="source-item"><strong>Street — source</strong>${escapeHtml(p.street)}</div>
      <div class="source-item"><strong>Work type — source</strong>${escapeHtml(p.workType)}</div>
      <div class="source-item"><strong>Contractor — source</strong>${escapeHtml(p.contractor)}</div>
    </div><div class="source-filename">${escapeHtml(p.sourceFilename)}</div>`;
    for (const key of ['permitNumber','status','startDate','endDate','rowImpact','notes']) els.permitForm.elements[key].value = p[key] || '';
    els.matchInfo.textContent = locationDescription(p);
    els.archivePermitBtn.textContent = p.status === 'Archived' ? 'Restore to Closed' : 'Archive';
    els.permitDialog.showModal();
  }

  function savePermitForm(e) {
    e.preventDefault();
    const p = state.permits.find(x => x.id===currentPermitId); if (!p) return;
    applyFormToPermit(p);
    saveState();
    els.permitDialog.close();
    renderAll();
    toast('Permit record saved.');
  }

  function applyFormToPermit(p) {
    p.permitNumber = els.permitForm.elements.permitNumber.value;
    p.status = els.permitForm.elements.status.value;
    p.startDate = els.permitForm.elements.startDate.value;
    p.endDate = els.permitForm.elements.endDate.value;
    p.rowImpact = els.permitForm.elements.rowImpact.value;
    p.notes = els.permitForm.elements.notes.value;
    p.updatedAt = new Date().toISOString();
  }

  function startMoveCurrentPermit() {
    const p = state.permits.find(x => x.id===currentPermitId); if (!p) return;
    applyFormToPermit(p); saveState();
    mapMovePermitId = p.id;
    els.permitDialog.close();
    toast(`Click the correct map location for ${displayAddress(p)}.`);
  }

  async function retryCurrentPermitLocation() {
    const p = state.permits.find(x => x.id===currentPermitId); if (!p) return;
    applyFormToPermit(p);
    p.lat = null; p.lng = null;
    const ok = await locatePermit(p, true, false);
    saveState(); renderAll();
    els.matchInfo.textContent = locationDescription(p);
    if (ok) {
      map.setView([p.lat,p.lng], 17);
      toast(`Matched ${p.matchedFullAddr || displayAddress(p)}.`);
    }
  }

  function archiveCurrentPermit() {
    const p = state.permits.find(x => x.id===currentPermitId); if (!p) return;
    applyFormToPermit(p);
    p.status = p.status === 'Archived' ? 'Closed' : 'Archived';
    saveState();
    els.permitDialog.close();
    renderAll();
    toast(p.status === 'Archived' ? 'Permit archived.' : 'Permit restored to Closed.');
  }

  function deleteCurrentPermit() {
    const p = state.permits.find(x => x.id===currentPermitId); if (!p) return;
    if (!confirm(`Permanently delete ${p.sourceFilename}?\n\nRe-importing the same filename later would create it again.`)) return;
    state.permits = state.permits.filter(x => x.id!==p.id);
    saveState();
    els.permitDialog.close();
    renderAll();
    toast('Permit permanently deleted from local data.');
  }

  function showUnlocated() {
    renderUnlocatedList();
    els.unlocatedDialog.showModal();
  }

  function renderUnlocatedList() {
    const items = state.permits.filter(p => !isFiniteNumber(p.lat) || !isFiniteNumber(p.lng));
    if (!items.length) {
      els.unlocatedList.innerHTML = '<div class="hint">Every permit currently has a map location.</div>';
      return;
    }
    els.unlocatedList.innerHTML = items.map(p => `<div class="unlocated-row" data-id="${escapeHtml(p.id)}"><div><strong>${escapeHtml(displayAddress(p))}</strong><small>${escapeHtml(prettySource(p.workType))} • ${escapeHtml(prettySource(p.contractor))}</small></div><div><button class="btn compact" data-action="retry">Retry</button> <button class="btn compact" data-action="place">Place on map</button></div></div>`).join('');
    els.unlocatedList.querySelectorAll('.unlocated-row').forEach(row => row.addEventListener('click', async e => {
      const btn = e.target.closest('button'); if (!btn) return;
      const p = state.permits.find(x => x.id===row.dataset.id); if (!p) return;
      if (btn.dataset.action === 'retry') {
        const ok = await locatePermit(p, true, false); saveState(); renderAll(); renderUnlocatedList();
        if (ok) map.setView([p.lat,p.lng],17);
      } else if (btn.dataset.action === 'place') {
        manualPlacePermitId = p.id;
        els.unlocatedDialog.close();
        toast(`Click the correct map location for ${displayAddress(p)}.`);
      }
    }));
  }

  function filteredPermits() {
    const search = normalizeMatch(els.searchFilter.value);
    const statuses = new Set([...els.statusFilters.querySelectorAll('input:checked')].map(i => i.dataset.status));
    const workType = els.workTypeFilter.value;
    const contractor = els.contractorFilter.value;
    const from = els.dateFrom.value;
    const to = els.dateTo.value;
    return state.permits.filter(p => {
      if (!statuses.has(p.status)) return false;
      if (els.hideClosedFilter.checked && p.status === 'Closed') return false;
      if (els.hideArchivedFilter.checked && p.status === 'Archived') return false;
      if (workType && p.workType !== workType) return false;
      if (contractor && p.contractor !== contractor) return false;
      if (search) {
        const hay = normalizeMatch([p.addressNumber,p.street,p.workType,p.contractor,p.permitNumber,p.status,p.rowImpact,p.notes,p.sourceFilename].join(' '));
        if (!hay.includes(search)) return false;
      }
      if ((from || to) && !dateRangeIntersects(p.startDate,p.endDate,from,to)) return false;
      if (els.corridorOnlyFilter.checked && !permitNearAnyCorridor(p)) return false;
      if (els.venueOnlyFilter.checked && !permitNearAnyVenue(p)) return false;
      return true;
    });
  }

  function permitNearAnyCorridor(p) {
    if (!isFiniteNumber(p.lat) || !isFiniteNumber(p.lng)) return false;
    const point = turf.point([p.lng,p.lat]);
    for (const c of state.corridors) {
      if (!c.latlngs?.length || c.latlngs.length < 2) continue;
      const feet = Number(c.bufferFeet || 0);
      try {
        const line = turf.lineString(c.latlngs.map(([lat,lng]) => [lng,lat]));
        if (feet > 0) {
          const poly = turf.buffer(line, feet, { units:'feet' });
          if (poly && turf.booleanPointInPolygon(point, poly)) return true;
        } else if (turf.pointToLineDistance(point,line,{units:'feet'}) <= 25) return true;
      } catch {}
    }
    return false;
  }

  function permitNearAnyVenue(p) {
    if (!isFiniteNumber(p.lat) || !isFiniteNumber(p.lng)) return false;
    const point = turf.point([p.lng,p.lat]);
    for (const v of venueRuntime.values()) {
      const d = turf.distance(point, turf.point([v.lng,v.lat]), { units:'miles' }) * 5280;
      if (d <= VENUE_NEAR_FEET) return true;
    }
    return false;
  }

  function dateRangeIntersects(start,end,from,to) {
    if (!start && !end) return false;
    const s = start || end;
    const e = end || start;
    if (from && e < from) return false;
    if (to && s > to) return false;
    return true;
  }

  function refreshFilterOptions() {
    const currentWork = els.workTypeFilter.value;
    const currentContractor = els.contractorFilter.value;
    const workTypes = uniqueExact(state.permits.map(p => p.workType));
    const contractors = uniqueExact(state.permits.map(p => p.contractor));
    els.workTypeFilter.innerHTML = '<option value="">All work types</option>' + workTypes.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(prettySource(v))}</option>`).join('');
    els.contractorFilter.innerHTML = '<option value="">All contractors</option>' + contractors.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(prettySource(v))}</option>`).join('');
    els.workTypeFilter.value = workTypes.includes(currentWork) ? currentWork : '';
    els.contractorFilter.value = contractors.includes(currentContractor) ? currentContractor : '';
  }

  function updateStats() {
    els.totalCount.textContent = state.permits.length;
    els.visibleCount.textContent = filteredPermits().filter(p => isFiniteNumber(p.lat) && isFiniteNumber(p.lng)).length;
    els.unlocatedCount.textContent = state.permits.filter(p => !isFiniteNumber(p.lat) || !isFiniteNumber(p.lng)).length;
  }

  function updateLayerVisibility() {
    toggleLayer(permitCluster, els.layerPermits.checked);
    toggleLayer(venueLayer, els.layerVenues.checked);
    toggleLayer(venueBuildingLayer, els.layerBuildings.checked);
    toggleLayer(venueContextLayer, els.layerVenueContext.checked);
    toggleLayer(corridorLayer, els.layerCorridors.checked);
  }

  function toggleLayer(layer, show) {
    if (show && !map.hasLayer(layer)) layer.addTo(map);
    if (!show && map.hasLayer(layer)) map.removeLayer(layer);
  }

  function resetFilters() {
    els.searchFilter.value = '';
    els.dateFrom.value = '';
    els.dateTo.value = '';
    els.workTypeFilter.value = '';
    els.contractorFilter.value = '';
    els.corridorOnlyFilter.checked = false;
    els.venueOnlyFilter.checked = false;
    els.hideClosedFilter.checked = true;
    els.hideArchivedFilter.checked = true;
    els.statusFilters.querySelectorAll('input').forEach(i => i.checked = i.dataset.status !== 'Archived');
    renderAll();
  }

  function fitAll() {
    const points = [];
    for (const p of filteredPermits()) if (isFiniteNumber(p.lat) && isFiniteNumber(p.lng)) points.push([p.lat,p.lng]);
    for (const v of venueRuntime.values()) points.push([v.lat,v.lng]);
    for (const c of state.corridors) points.push(...(c.latlngs || []));
    if (points.length) map.fitBounds(points, { padding:[35,35], maxZoom:16 });
    else map.setView(BOULDER_CENTER,13);
  }

  function exportBackup() {
    const payload = {
      format:'sundance-row-map-backup',
      version:1,
      exportedAt:new Date().toISOString(),
      festival:{ start:FESTIVAL_START,end:FESTIVAL_END },
      permits:state.permits,
      corridors:state.corridors
    };
    downloadBlob(`sundance-row-map-backup-${todayStamp()}.json`, JSON.stringify(payload,null,2), 'application/json');
  }

  async function importBackup(e) {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload.format !== 'sundance-row-map-backup' || !Array.isArray(payload.permits) || !Array.isArray(payload.corridors)) throw new Error('Not a Sundance ROW Map backup');
      if (!confirm(`Replace local data with this backup?\n\n${payload.permits.length} permits • ${payload.corridors.length} corridors`)) return;
      state.permits = payload.permits;
      state.corridors = payload.corridors;
      state.initialized = true;
      saveState();
      rebuildCorridors(); renderAll();
      toast('Backup imported.');
    } catch (err) { toast(`Backup import failed: ${err.message || err}`); }
    finally { e.target.value=''; }
  }

  function exportCsv() {
    const headers = ['source_filename','address_number','street','work_type','contractor','permit_number','status','start_date','end_date','row_impact','notes','latitude','longitude','location_method'];
    const rows = state.permits.map(p => [p.sourceFilename,p.addressNumber,p.street,p.workType,p.contractor,p.permitNumber,p.status,p.startDate,p.endDate,p.rowImpact,p.notes,p.lat??'',p.lng??'',p.matchMethod]);
    const csv = [headers,...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadBlob(`sundance-row-permits-${todayStamp()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function clearAllData() {
    if (!confirm('Clear ALL local permits, corridors, notes, dates, and statuses from this browser? Export a backup first if you may need them.')) return;
    state = { initialized:true, permits:[], corridors:[] };
    saveState(); rebuildCorridors(); renderAll();
    toast('Local permit and corridor data cleared.');
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { initialized:false, permits:[], corridors:[] };
      const parsed = JSON.parse(raw);
      return { initialized:!!parsed.initialized, permits:Array.isArray(parsed.permits)?parsed.permits:[], corridors:Array.isArray(parsed.corridors)?parsed.corridors:[] };
    } catch { return { initialized:false, permits:[], corridors:[] }; }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function locationDescription(p) {
    if (p.matchMethod === 'manual') return `Location: manual map placement (${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)})`;
    if (isFiniteNumber(p.lat) && isFiniteNumber(p.lng)) return `Location: ${p.matchedFullAddr || 'Boulder public address match'} • ${p.matchMethod || 'matched'}`;
    return 'Location: not matched yet. The permit remains available for manual placement.';
  }

  function displayAddress(p) {
    return `${String(p.addressNumber).trim()} ${prettyStreet(p.street)}`.trim();
  }

  function prettyStreet(value) { return prettySource(value); }

  function prettySource(value) {
    return String(value ?? '').replace(/\b([a-z][a-z']*)\b/gi, token => {
      if (/^[A-Z0-9]{2,}$/.test(token)) return token;
      if (/^\d+(st|nd|rd|th)$/i.test(token)) return token.toLowerCase();
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    });
  }

  function normalizeMatch(value) {
    return String(value ?? '').toLowerCase().replace(/[.,#]/g,' ').replace(/\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|way)\b/g,' ').replace(/\s+/g,' ').trim();
  }

  function uniqueExact(arr) {
    return [...new Set(arr.filter(v => v !== null && v !== undefined && v !== ''))].sort((a,b) => prettySource(a).localeCompare(prettySource(b)));
  }

  function statusClass(status) { return String(status||'').toLowerCase().replace(/[^a-z0-9]+/g,'-'); }
  function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function cryptoRandomId(prefix) { return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
  function todayStamp() { return new Date().toISOString().slice(0,10); }
  function csvCell(v) { const s=String(v??''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
  function downloadBlob(name,text,type) { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); }
  function escapeHtml(s) { return String(s??'').replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g,'&#39;'); }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4200);
  }

  function openDb() {
    return new Promise((resolve,reject) => {
      const req = indexedDB.open(DB_NAME,1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key,value) {
    try { const db=await openDb(); await new Promise((resolve,reject)=>{ const tx=db.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).put(value,key); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); db.close(); } catch {}
  }
  async function idbGet(key) {
    try { const db=await openDb(); const value=await new Promise((resolve,reject)=>{ const tx=db.transaction(DB_STORE,'readonly'); const req=tx.objectStore(DB_STORE).get(key); req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error); }); db.close(); return value; } catch { return null; }
  }
})();
