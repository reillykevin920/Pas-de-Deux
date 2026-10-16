(() => {
  'use strict';

  const STORAGE_KEY = 'sundance-row-map:v1'; // keep v1 key so first-build data survives the upgrade
  const DB_NAME = 'sundance-row-map-handles';
  const DB_STORE = 'handles';
  const FESTIVAL_START = '2027-01-21';
  const FESTIVAL_END = '2027-01-31';
  const VENUE_NEAR_FEET = 500;
  const BOULDER_CENTER = [40.0176, -105.2797];

  const ADDRESS_QUERY = 'https://gis.bouldercolorado.gov/ags_svr1/rest/services/plan/AddressPoints/MapServer/0/query';
  const BUILDING_QUERY = 'https://gis.bouldercolorado.gov/ags_svr3/rest/services/pw/BuildingFootprints/MapServer/0/query';
  const STREET_QUERY = 'https://gis.bouldercolorado.gov/ags_svr3/rest/services/trans/StreetsSimple/MapServer/0/query';
  const CONE_ZONES_EXPERIENCE_ID = '45ea51935a18499281af2980bfa3b7e5';
  const ARCGIS_ITEMS_ROOT = 'https://www.arcgis.com/sharing/rest/content/items';

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

  const STATUS_VALUES = ['Upcoming','Active','Closed'];

  let state = migrateState(loadState());
  let map;
  let permitCluster;
  let venueLayer;
  let venueBuildingLayer;
  let venueContextLayer;
  let corridorLayer;
  let corridorPreviewLayer;
  let corridorEndpointLayer;
  let coneZonesLayer;
  let coneZonesLoaded = false;
  let coneZonesLoading = null;
  let coneZonesFeatureCount = 0;
  let currentPermitId = null;
  let currentCorridorId = null;
  let pendingCorridor = null;
  let mapMovePermitId = null;
  let manualPlacePermitId = null;
  let folderHandle = null;
  let renderScheduled = false;
  let toastTimer = null;
  let activeDrawHandler = null;
  let corridorMode = null; // select-street | select-section | draw-custom
  let selectedStreet = null;
  let sectionStart = null;
  let corridorRequestToken = 0;
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
    saveState(); // save any migration immediately

    if (!state.initialized) {
      state.initialized = true;
      saveState();
      toast('Ready. Connect a permit folder or drop permit files onto the map. Only filenames are used.');
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
      'visibleCount','totalCount','unlocatedCount','connectFolderBtn','filePicker','exportBtn','importBackup','exportCsvBtn','clearAllBtn',
      'dataMenuBtn','dataMenu','layerPermits','layerVenues','layerBuildings','layerVenueContext','layerCorridors','layerConeZones','coneZonesStatus','fitAllBtn',
      'addCorridorBtn','corridorActions','selectStreetCorridorBtn','drawCorridorBtn','corridorList','searchFilter','statusFilters','dateFrom','dateTo',
      'festivalWindowBtn','clearDatesBtn','workTypeFilter','contractorFilter','corridorOnlyFilter','venueOnlyFilter','hideClosedFilter','hideArchivedFilter',
      'resetFiltersBtn','showUnlocatedBtn','map','dropZone','toast','corridorModeBar','corridorModeTitle','corridorModeText','cancelCorridorModeBtn',
      'mapKeyToggle','mapKeyBody','permitDialog','permitForm','permitDialogTitle','sourceBlock','matchInfo','movePinBtn','retryLocateBtn','archivePermitBtn',
      'deletePermitBtn','streetScopeDialog','streetScopeForm','selectedStreetName','wholeStreetBtn','streetSectionBtn','corridorDialog','corridorForm',
      'unlocatedDialog','closeUnlocatedBtn','unlocatedList'
    ].forEach(id => els[id] = document.getElementById(id));
  }

  function initMap() {
    map = L.map('map', { zoomControl:true, preferCanvas:true }).setView(BOULDER_CENTER, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19,
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map);

    permitCluster = L.markerClusterGroup({ disableClusteringAtZoom:17, showCoverageOnHover:false, maxClusterRadius:44 });
    venueLayer = L.layerGroup().addTo(map);
    venueBuildingLayer = L.layerGroup().addTo(map);
    venueContextLayer = L.layerGroup();
    corridorLayer = L.layerGroup().addTo(map);
    corridorPreviewLayer = L.layerGroup().addTo(map);
    corridorEndpointLayer = L.layerGroup().addTo(map);
    coneZonesLayer = L.featureGroup();
    permitCluster.addTo(map);

    map.on(L.Draw.Event.CREATED, e => {
      if (corridorMode !== 'draw-custom' || e.layerType !== 'polyline') return;
      const path = e.layer.getLatLngs().map(ll => [ll.lat, ll.lng]);
      activeDrawHandler = null;
      if (path.length < 2) return cancelCorridorMode();
      pendingCorridor = { sourceType:'custom', scope:'Custom route', streetLabel:'', paths:[path] };
      exitCorridorMapMode(false);
      prepareCorridorForm({ suggestedName:'Custom corridor' });
    });

    map.on('click', async e => {
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
        return;
      }

      if (corridorMode === 'select-street') {
        await selectStreetAt(e.latlng);
        return;
      }

      if (corridorMode === 'select-section') {
        chooseSectionPoint(e.latlng);
      }
    });
  }

  function initStatusFilters() {
    els.statusFilters.innerHTML = STATUS_VALUES.map(s => `<label class="status-chip"><input type="checkbox" data-status="${escapeHtml(s)}" checked><span>${escapeHtml(s)}</span></label>`).join('');
  }

  function bindUI() {
    els.connectFolderBtn.addEventListener('click', connectOrSyncFolder);
    els.filePicker.addEventListener('change', async e => {
      const names = [...e.target.files].filter(f => f.name.toLowerCase().endsWith('.pdf')).map(f => ({ name:f.name, relativePath:f.webkitRelativePath || f.name }));
      await importNames(names);
      e.target.value = '';
    });

    els.dataMenuBtn.addEventListener('click', () => toggleDataMenu());
    document.addEventListener('click', e => {
      if (!e.target.closest('.menu-wrap')) toggleDataMenu(false);
    });
    els.exportBtn.addEventListener('click', () => { toggleDataMenu(false); exportBackup(); });
    els.importBackup.addEventListener('change', e => { toggleDataMenu(false); importBackup(e); });
    els.exportCsvBtn.addEventListener('click', () => { toggleDataMenu(false); exportCsv(); });
    els.clearAllBtn.addEventListener('click', () => { toggleDataMenu(false); clearAllData(); });

    els.fitAllBtn.addEventListener('click', fitAll);
    els.addCorridorBtn.addEventListener('click', () => { els.corridorActions.hidden = !els.corridorActions.hidden; });
    els.selectStreetCorridorBtn.addEventListener('click', startStreetCorridorMode);
    els.drawCorridorBtn.addEventListener('click', startCustomCorridorMode);
    els.cancelCorridorModeBtn.addEventListener('click', cancelCorridorMode);
    els.wholeStreetBtn.addEventListener('click', chooseWholeStreet);
    els.streetSectionBtn.addEventListener('click', startStreetSectionMode);
    els.streetScopeDialog.addEventListener('close', () => {
      if (els.streetScopeDialog.returnValue === 'cancel' && selectedStreet && !pendingCorridor) cancelCorridorMode();
    });
    els.corridorDialog.addEventListener('close', () => {
      if (els.corridorDialog.returnValue === 'cancel') {
        pendingCorridor = null;
        currentCorridorId = null;
        clearCorridorPreview();
      }
    });
    els.corridorForm.addEventListener('submit', saveCorridorForm);

    ['layerPermits','layerVenues','layerBuildings','layerVenueContext','layerCorridors'].forEach(id => els[id].addEventListener('change', updateLayerVisibility));
    els.layerConeZones.addEventListener('change', async () => {
      updateLayerVisibility();
      if (els.layerConeZones.checked) await ensureConeZonesLoaded();
    });
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

    els.showUnlocatedBtn.addEventListener('click', showUnlocated);
    els.closeUnlocatedBtn.addEventListener('click', () => els.unlocatedDialog.close());
    els.mapKeyToggle.addEventListener('click', () => {
      const show = els.mapKeyBody.hidden;
      els.mapKeyBody.hidden = !show;
      els.mapKeyToggle.setAttribute('aria-expanded', String(show));
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && corridorMode) {
        e.preventDefault();
        cancelCorridorMode();
      }
    }, true);

    window.addEventListener('dragenter', e => { e.preventDefault(); els.dropZone.classList.add('visible'); });
    window.addEventListener('dragover', e => { e.preventDefault(); els.dropZone.classList.add('visible'); });
    window.addEventListener('dragleave', e => { if (e.target === document.documentElement || e.target === document.body) els.dropZone.classList.remove('visible'); });
    window.addEventListener('drop', handleDrop);
  }

  function toggleDataMenu(force) {
    const show = typeof force === 'boolean' ? force : els.dataMenu.hidden;
    els.dataMenu.hidden = !show;
    els.dataMenuBtn.setAttribute('aria-expanded', String(show));
  }

  async function handleDrop(e) {
    e.preventDefault();
    els.dropZone.classList.remove('visible');
    const names = [];
    const items = [...(e.dataTransfer?.items || [])];
    if (items.length && items[0].webkitGetAsEntry) {
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) await collectEntryNames(entry, '', names);
      }
    } else {
      for (const f of [...(e.dataTransfer?.files || [])]) if (f.name.toLowerCase().endsWith('.pdf')) names.push({ name:f.name, relativePath:f.webkitRelativePath || f.name });
    }
    await importNames(names);
  }

  async function collectEntryNames(entry, parentPath, out) {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
      if (entry.name.toLowerCase().endsWith('.pdf')) out.push({ name:entry.name, relativePath:path });
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((resolve,reject) => reader.readEntries(resolve,reject));
        for (const child of batch) await collectEntryNames(child, path, out);
      } while (batch.length);
    }
  }

  async function connectOrSyncFolder() {
    try {
      if (!('showDirectoryPicker' in window)) {
        toast('This browser does not support folder connection. Use Import filenames or drag-and-drop instead.');
        return;
      }
      if (!folderHandle) {
        folderHandle = await window.showDirectoryPicker({ mode:'read' });
        await idbSet('permitFolder', folderHandle);
      } else if (!(await verifyPermission(folderHandle))) {
        folderHandle = await window.showDirectoryPicker({ mode:'read' });
        await idbSet('permitFolder', folderHandle);
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
      if (child.kind === 'directory') await scanDirectoryHandle(child, path, out);
      else if (name.toLowerCase().endsWith('.pdf')) out.push({ name, relativePath:path }); // filename only; never child.getFile()
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
    let added=0, known=0, invalid=0;
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
        id:cryptoRandomId('permit'), sourceFilename:entry.name, relativePath:entry.relativePath || entry.name,
        addressNumber:parsed.addressNumber, street:parsed.street, workType:parsed.workType, contractor:parsed.contractor,
        permitNumber:'', status:'Upcoming', archived:false, startDate:'', endDate:'', rowImpact:'', notes:'',
        lat:null, lng:null, matchMethod:'', matchedFullAddr:'', importedAt:new Date().toISOString(), updatedAt:new Date().toISOString()
      });
      added++;
    }
    saveState();
    refreshFilterOptions();
    await locateUnlocatedPermits({ quiet:true });
    renderAll();
    if (!opts.silent) toast(`${added} added • ${known} already known${invalid ? ` • ${invalid} filename${invalid===1?'':'s'} skipped`:''}. No PDF contents read.`);
  }

  function parsePermitFilename(filename) {
    if (!/\.pdf$/i.test(filename)) return null;
    const base = filename.replace(/\.pdf$/i, '');
    const parts = base.split(' - ');
    if (parts.length < 4) return null;
    return { addressNumber:parts[0], street:parts[1], workType:parts[2], contractor:parts.slice(3).join(' - ') };
  }

  async function locateUnlocatedPermits({ quiet=false }={}) {
    const queue = state.permits.filter(p => !isFiniteNumber(p.lat) || !isFiniteNumber(p.lng));
    let located=0;
    for (const permit of queue) if (await locatePermit(permit,false,true)) located++;
    saveState();
    if (!quiet && located) toast(`Located ${located} permit${located===1?'':'s'} using Boulder public address data.`);
  }

  async function locatePermit(permit, force=false, quiet=false) {
    if (!permit || (!force && isFiniteNumber(permit.lat) && isFiniteNumber(permit.lng))) return true;
    try {
      const result = await queryAddressPoint(permit.addressNumber, permit.street);
      if (!result) {
        permit.matchMethod='unlocated'; permit.matchedFullAddr='';
        if (!quiet) toast(`No confident public-address match for ${displayAddress(permit)}.`);
        return false;
      }
      permit.lat=result.lat; permit.lng=result.lng; permit.matchMethod='Boulder Address Points'; permit.matchedFullAddr=result.fullAddr || ''; permit.updatedAt=new Date().toISOString();
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
      where:`ADDRNUM='${addressNumber}'`, outFields:'FULLADDR,ADDRNUM,PREDIR,STREETNAME,STREETSUFFIX,POSTDIR,CITY,STATUS,POINTTYPE',
      returnGeometry:'true', outSR:'4326', resultRecordCount:'50', f:'geojson'
    });
    const res = await fetch(`${ADDRESS_QUERY}?${params}`);
    if (!res.ok) throw new Error(`Address service ${res.status}`);
    const data = await res.json();
    const candidates = (data.features || []).filter(f => Array.isArray(f.geometry?.coordinates));
    if (!candidates.length) { addressLookupCache.set(cacheKey,null); return null; }
    const scored = candidates.map(f => ({ f, score:scoreAddressCandidate(streetRaw,f.properties||{}) })).sort((a,b)=>b.score-a.score);
    if (scored[0].score < 45) { addressLookupCache.set(cacheKey,null); return null; }
    const f = scored[0].f;
    const result = { lng:f.geometry.coordinates[0], lat:f.geometry.coordinates[1], fullAddr:f.properties?.FULLADDR || '' };
    addressLookupCache.set(cacheKey,result);
    return result;
  }

  function scoreAddressCandidate(sourceStreet, props) {
    const src=normalizeMatch(sourceStreet), predir=normalizeMatch(props.PREDIR||''), name=normalizeMatch(props.STREETNAME||''), suffix=normalizeMatch(props.STREETSUFFIX||''), postdir=normalizeMatch(props.POSTDIR||'');
    const full=[predir,name,suffix,postdir].filter(Boolean).join(' '), noSuffix=[predir,name,postdir].filter(Boolean).join(' ');
    let score=0;
    if (src===full) score+=100; if (src===noSuffix) score+=95; if (src===name) score+=85; if (full.startsWith(src+' ')) score+=65; if (noSuffix.startsWith(src+' ')) score+=65;
    if (name===src.replace(/^(n|s|e|w)\s+/,'')) score+=55; if ((props.CITY||'').toLowerCase()==='boulder') score+=10; if ((props.STATUS||'').toLowerCase()==='current') score+=5; if ((props.POINTTYPE||'').toLowerCase()==='building') score+=3;
    return score;
  }

  async function resolveVenues() {
    venueLayer.clearLayers(); venueBuildingLayer.clearLayers(); venueContextLayer.clearLayers(); venueRuntime.clear();
    for (const venue of VENUES) {
      try {
        const loc = await queryAddressPoint(venue.addressNumber, venue.street);
        if (!loc) continue;
        venue.lat=loc.lat; venue.lng=loc.lng; venue.matchedFullAddr=loc.fullAddr; venueRuntime.set(venue.id,venue);
        addVenueMarker(venue);
        L.circle([venue.lat,venue.lng], { radius:VENUE_NEAR_FEET*.3048, color:'#b39a36', weight:1, opacity:.35, fillColor:'#b39a36', fillOpacity:.035, dashArray:'4 5', interactive:false }).addTo(venueContextLayer);
        await addVenueBuilding(venue);
      } catch (err) { console.warn('Venue lookup failed', venue.name, err); }
    }
    updateLayerVisibility();
  }

  function addVenueMarker(venue) {
    const icon=L.divIcon({ className:'', html:'<div class="venue-marker"><span></span></div>', iconSize:[22,22], iconAnchor:[11,11] });
    const marker=L.marker([venue.lat,venue.lng],{icon,zIndexOffset:500});
    marker.bindPopup(`<div class="popup-title">${escapeHtml(venue.name)}</div><div class="popup-row"><span class="popup-label">Address</span>${escapeHtml(venue.address)}</div><div class="popup-row"><span class="popup-label">Use</span>${escapeHtml(venue.uses)}</div>`).addTo(venueLayer);
  }

  async function addVenueBuilding(venue) {
    const params=new URLSearchParams({ where:'1=1', geometry:`${venue.lng},${venue.lat}`, geometryType:'esriGeometryPoint', inSR:'4326', spatialRel:'esriSpatialRelIntersects', distance:'120', units:'esriSRUnit_Meter', outFields:'FACILITYID,SHORTNAME,LONGNAME,BLDGTYPE', returnGeometry:'true', outSR:'4326', resultRecordCount:'100', f:'geojson' });
    const res=await fetch(`${BUILDING_QUERY}?${params}`); if (!res.ok) throw new Error(`Building service ${res.status}`);
    const data=await res.json(), features=data.features||[]; if (!features.length) return;
    const point=turf.point([venue.lng,venue.lat]);
    const best=features.map(f=>({f,score:scoreBuilding(venue,point,f)})).sort((a,b)=>b.score-a.score)[0]?.f; if (!best) return;
    const facilityId=best.properties?.FACILITYID || `${venue.id}:${JSON.stringify(best.geometry).slice(0,100)}`;
    if ([...venueBuildingLayer.getLayers()].some(l=>l.options?.facilityId===facilityId)) return;
    const layer=L.geoJSON(best,{ style:{ color:'#a8902f', weight:1.5, fillColor:'#d7c66d', fillOpacity:.32 }, onEachFeature:(_f,l)=>l.bindPopup(`<div class="popup-title">${escapeHtml(venue.name)}</div><div class="popup-row"><span class="popup-label">Layer</span>Venue building</div>`) });
    layer.options.facilityId=facilityId; layer.eachLayer(l=>{l.options.facilityId=facilityId;}); layer.addTo(venueBuildingLayer);
  }

  function scoreBuilding(venue, point, feature) {
    let score=0; try { if (turf.booleanPointInPolygon(point,feature)) score+=200; } catch {}
    const label=normalizeMatch(`${feature.properties?.LONGNAME||''} ${feature.properties?.SHORTNAME||''}`);
    for (const token of normalizeMatch(venue.name).split(' ').filter(t=>t.length>3)) if (label.includes(token)) score+=15;
    try { score-=Math.min(turf.pointToLineDistance(point,turf.polygonToLine(feature),{units:'meters'}),150); } catch {}
    return score;
  }

  // ---------------- Corridor workflow ----------------

  function startStreetCorridorMode() {
    cancelCorridorMode(true);
    els.corridorActions.hidden=true;
    corridorMode='select-street'; selectedStreet=null; sectionStart=null; pendingCorridor=null;
    showCorridorMode('Select a street','Click a Boulder street on the map. Pas de Deux will use the public street centerline, not a hand-drawn approximation.');
  }

  function startCustomCorridorMode() {
    cancelCorridorMode(true);
    els.corridorActions.hidden=true;
    corridorMode='draw-custom'; pendingCorridor=null;
    showCorridorMode('Draw a custom route','Click along the route. Click the last point again to finish, or Cancel / Esc to leave without creating anything.');
    activeDrawHandler = new L.Draw.Polyline(map,{ shapeOptions:{ color:'#2e6f9e', weight:5, opacity:.9 }, guidelineDistance:14 });
    activeDrawHandler.enable();
  }

  async function selectStreetAt(latlng) {
    const token=++corridorRequestToken;
    showCorridorMode('Finding street…','Matching your click to Boulder public street centerlines.');
    try {
      const selected=await queryNearestStreet(latlng);
      if (token!==corridorRequestToken || corridorMode!=='select-street') return;
      if (!selected) {
        showCorridorMode('Select a street','No street centerline was close enough to that click. Try again closer to the roadway.');
        return;
      }
      selectedStreet=selected;
      showCorridorMode('Loading street…',`Loading ${selected.label} centerline segments.`);
      selectedStreet.features=await queryWholeStreet(selected.feature);
      if (token!==corridorRequestToken || corridorMode!=='select-street') return;
      if (!selectedStreet.features.length) {
        showCorridorMode('Select a street','The street was identified, but its geometry could not be loaded. Try again.');
        return;
      }
      previewStreetFeatures(selectedStreet.features,false);
      els.selectedStreetName.textContent=selectedStreet.label;
      els.streetScopeDialog.returnValue='';
      els.streetScopeDialog.showModal();
      els.corridorModeBar.hidden=true;
    } catch (err) {
      console.warn('Street selection failed',err);
      showCorridorMode('Select a street','Street data could not be loaded. Try again, or use Draw custom route.');
    }
  }

  async function queryNearestStreet(latlng) {
    const geometry=JSON.stringify({ x:latlng.lng, y:latlng.lat, spatialReference:{wkid:4326} });
    const params=new URLSearchParams({
      where:"LIFECYCLE='Active'", geometry, geometryType:'esriGeometryPoint', inSR:'4326', spatialRel:'esriSpatialRelIntersects', distance:'120', units:'esriSRUnit_Foot',
      outFields:'OBJECTID,LIFECYCLE,PREDIR,STREETNAME,STREETTYPE,SUFFIX,STREETCLASS,CENTERLINE', returnGeometry:'true', outSR:'4326', resultRecordCount:'30', f:'geojson'
    });
    const res=await fetch(`${STREET_QUERY}?${params}`); if (!res.ok) throw new Error(`Street service ${res.status}`);
    const data=await res.json(), point=turf.point([latlng.lng,latlng.lat]);
    const candidates=(data.features||[]).filter(f=>f.geometry && (f.geometry.type==='LineString' || f.geometry.type==='MultiLineString'));
    if (!candidates.length) return null;
    const ranked=[];
    for (const f of candidates) {
      let distance=Infinity;
      for (const line of featureLines(f)) {
        try { distance=Math.min(distance,turf.pointToLineDistance(point,line,{units:'feet'})); } catch {}
      }
      ranked.push({f,distance});
    }
    ranked.sort((a,b)=>a.distance-b.distance);
    if (!Number.isFinite(ranked[0]?.distance) || ranked[0].distance>140) return null;
    const feature=ranked[0].f;
    return { feature, label:streetLabel(feature.properties||{}), key:streetKey(feature.properties||{}), distanceFeet:ranked[0].distance, features:[] };
  }

  async function queryWholeStreet(seedFeature) {
    const name=String(seedFeature.properties?.STREETNAME||'').replace(/'/g,"''");
    if (!name) return [];
    const params=new URLSearchParams({ where:`STREETNAME='${name}' AND LIFECYCLE='Active'`, outFields:'OBJECTID,LIFECYCLE,PREDIR,STREETNAME,STREETTYPE,SUFFIX,STREETCLASS,CENTERLINE', returnGeometry:'true', outSR:'4326', resultRecordCount:'1000', f:'geojson' });
    const res=await fetch(`${STREET_QUERY}?${params}`); if (!res.ok) throw new Error(`Street service ${res.status}`);
    const data=await res.json();
    const key=streetKey(seedFeature.properties||{});
    return (data.features||[]).filter(f=>streetKey(f.properties||{})===key && f.geometry);
  }

  function streetKey(props) {
    return [props.PREDIR||'',props.STREETNAME||'',props.STREETTYPE||'',props.SUFFIX||''].map(v=>String(v).trim().toUpperCase()).join('|');
  }

  function streetLabel(props) {
    return [props.PREDIR,props.STREETNAME,props.STREETTYPE,props.SUFFIX].map(v=>String(v||'').trim()).filter(Boolean).join(' ');
  }

  function chooseWholeStreet() {
    if (!selectedStreet?.features?.length) return;
    pendingCorridor={ sourceType:'street', scope:'Entire street', streetLabel:selectedStreet.label, streetKey:selectedStreet.key, paths:featuresToPaths(selectedStreet.features) };
    els.streetScopeDialog.returnValue='default';
    els.streetScopeDialog.close();
    exitCorridorMapMode(false);
    prepareCorridorForm({ suggestedName:selectedStreet.label });
  }

  function startStreetSectionMode() {
    if (!selectedStreet?.features?.length) return;
    els.streetScopeDialog.returnValue='default';
    els.streetScopeDialog.close();
    corridorMode='select-section'; sectionStart=null;
    showCorridorMode(`Select section — ${selectedStreet.label}`,'Click the first end of the street section. Then click the second end. Both clicks will snap to the selected street.');
    previewStreetFeatures(selectedStreet.features,false);
  }

  function chooseSectionPoint(latlng) {
    if (!selectedStreet?.features?.length) return;
    const snapped=snapPointToStreet(latlng,selectedStreet.features);
    if (!snapped) { toast('Could not snap that point to the selected street.'); return; }
    if (!sectionStart) {
      sectionStart=snapped;
      corridorEndpointLayer.clearLayers();
      L.circleMarker([snapped.lat,snapped.lng],{radius:6,color:'#17324d',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(corridorEndpointLayer);
      showCorridorMode(`Select section — ${selectedStreet.label}`,'Start set. Click the other end of the section, or Cancel / Esc.');
      return;
    }
    const sectionEnd=snapped;
    L.circleMarker([sectionEnd.lat,sectionEnd.lng],{radius:6,color:'#17324d',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(corridorEndpointLayer);
    const paths=clipStreetToSection(selectedStreet.features,sectionStart,sectionEnd);
    if (!paths.length) { toast('That section could not be resolved. Try the two endpoints again.'); sectionStart=null; corridorEndpointLayer.clearLayers(); return; }
    pendingCorridor={ sourceType:'street', scope:'Selected section', streetLabel:selectedStreet.label, streetKey:selectedStreet.key, paths };
    corridorPreviewLayer.clearLayers();
    previewPaths(paths,true);
    exitCorridorMapMode(false);
    prepareCorridorForm({ suggestedName:selectedStreet.label });
  }

  function snapPointToStreet(latlng,features) {
    const point=turf.point([latlng.lng,latlng.lat]);
    let best=null;
    for (const feature of features) {
      for (const line of featureLines(feature)) {
        try {
          const distance=turf.pointToLineDistance(point,line,{units:'feet'});
          if (!best || distance<best.distance) {
            const snapped=turf.nearestPointOnLine(line,point,{units:'feet'});
            best={ distance, lat:snapped.geometry.coordinates[1], lng:snapped.geometry.coordinates[0] };
          }
        } catch {}
      }
    }
    return best;
  }

  function clipStreetToSection(features,a,b) {
    const padMeters=55;
    const midLat=(a.lat+b.lat)/2;
    const padLat=padMeters/111320;
    const padLng=padMeters/(111320*Math.cos(midLat*Math.PI/180));
    const bbox=[Math.min(a.lng,b.lng)-padLng,Math.min(a.lat,b.lat)-padLat,Math.max(a.lng,b.lng)+padLng,Math.max(a.lat,b.lat)+padLat];
    const paths=[];
    for (const feature of features) {
      for (const line of featureLines(feature)) {
        try {
          const clipped=turf.bboxClip(line,bbox);
          if (clipped?.geometry?.type==='LineString' && clipped.geometry.coordinates.length>1) paths.push(clipped.geometry.coordinates.map(([lng,lat])=>[lat,lng]));
          if (clipped?.geometry?.type==='MultiLineString') for (const coords of clipped.geometry.coordinates) if (coords.length>1) paths.push(coords.map(([lng,lat])=>[lat,lng]));
        } catch {}
      }
    }
    return dedupePaths(paths);
  }

  function featureLines(feature) {
    if (!feature?.geometry) return [];
    if (feature.geometry.type==='LineString') return [turf.lineString(feature.geometry.coordinates)];
    if (feature.geometry.type==='MultiLineString') return feature.geometry.coordinates.map(coords=>turf.lineString(coords));
    return [];
  }

  function featuresToPaths(features) {
    const paths=[];
    for (const f of features) {
      if (f.geometry?.type==='LineString') paths.push(f.geometry.coordinates.map(([lng,lat])=>[lat,lng]));
      else if (f.geometry?.type==='MultiLineString') for (const coords of f.geometry.coordinates) paths.push(coords.map(([lng,lat])=>[lat,lng]));
    }
    return dedupePaths(paths.filter(p=>p.length>1));
  }

  function dedupePaths(paths) {
    const seen=new Set();
    return paths.filter(path=>{
      const key=path.map(([lat,lng])=>`${lat.toFixed(6)},${lng.toFixed(6)}`).join(';');
      const rev=[...path].reverse().map(([lat,lng])=>`${lat.toFixed(6)},${lng.toFixed(6)}`).join(';');
      if (seen.has(key)||seen.has(rev)) return false;
      seen.add(key); return true;
    });
  }

  function previewStreetFeatures(features,strong) { previewPaths(featuresToPaths(features),strong); }

  function previewPaths(paths,strong=false) {
    corridorPreviewLayer.clearLayers();
    for (const path of paths) L.polyline(path,{ color:strong?'#17324d':'#2e6f9e', weight:strong?7:5, opacity:strong?.92:.48, className:'street-preview', interactive:false }).addTo(corridorPreviewLayer);
  }

  function prepareCorridorForm({suggestedName}) {
    currentCorridorId=null;
    els.corridorForm.reset();
    els.corridorForm.elements.name.value=suggestedName || 'Corridor';
    els.corridorForm.elements.priority.value='Primary';
    els.corridorForm.elements.bufferFeet.value=150;
    els.corridorDialog.returnValue='';
    els.corridorDialog.showModal();
  }

  function showCorridorMode(title,text) {
    els.corridorModeTitle.textContent=title;
    els.corridorModeText.textContent=text;
    els.corridorModeBar.hidden=false;
    document.body.classList.add('mode-selecting');
  }

  function exitCorridorMapMode(clearPreview=true) {
    if (activeDrawHandler) { try { activeDrawHandler.disable(); } catch {} activeDrawHandler=null; }
    corridorMode=null; sectionStart=null;
    els.corridorModeBar.hidden=true;
    document.body.classList.remove('mode-selecting');
    corridorEndpointLayer.clearLayers();
    if (clearPreview) corridorPreviewLayer.clearLayers();
  }

  function clearCorridorPreview() {
    corridorPreviewLayer.clearLayers(); corridorEndpointLayer.clearLayers(); selectedStreet=null; sectionStart=null;
  }

  function cancelCorridorMode(silent=false) {
    corridorRequestToken++;
    exitCorridorMapMode(true);
    pendingCorridor=null; selectedStreet=null; sectionStart=null;
    if (els.streetScopeDialog?.open) { els.streetScopeDialog.returnValue='default'; els.streetScopeDialog.close(); }
    if (els.corridorDialog?.open && !currentCorridorId) { els.corridorDialog.returnValue='cancel'; els.corridorDialog.close(); }
    if (!silent) toast('Corridor selection cancelled.');
  }

  function saveCorridorForm(e) {
    e.preventDefault();
    const form=new FormData(els.corridorForm);
    if (currentCorridorId) {
      const c=state.corridors.find(x=>x.id===currentCorridorId); if (!c) return;
      c.name=String(form.get('name')||'Corridor'); c.priority=String(form.get('priority')||'Primary'); c.bufferFeet=Number(form.get('bufferFeet')||0); c.notes=String(form.get('notes')||''); c.updatedAt=new Date().toISOString();
    } else if (pendingCorridor?.paths?.length) {
      state.corridors.push({ id:cryptoRandomId('corridor'), name:String(form.get('name')||pendingCorridor.streetLabel||'Corridor'), priority:String(form.get('priority')||'Primary'), bufferFeet:Number(form.get('bufferFeet')||0), notes:String(form.get('notes')||''), sourceType:pendingCorridor.sourceType, scope:pendingCorridor.scope, streetLabel:pendingCorridor.streetLabel||'', streetKey:pendingCorridor.streetKey||'', paths:pendingCorridor.paths, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    }
    currentCorridorId=null; pendingCorridor=null; selectedStreet=null;
    saveState();
    els.corridorDialog.returnValue='default'; els.corridorDialog.close();
    clearCorridorPreview(); rebuildCorridors(); renderAll(); toast('Corridor saved.');
  }

  function rebuildCorridors() {
    corridorLayer.clearLayers(); corridorRuntime.clear();
    for (const corridor of state.corridors) addCorridorRuntime(corridor);
    renderCorridorList();
  }

  function addCorridorRuntime(corridor) {
    const group=L.layerGroup();
    const paths=getCorridorPaths(corridor);
    const bufferFeet=Number(corridor.bufferFeet||0);
    if (bufferFeet>0 && paths.length) {
      try {
        const geo=paths.length===1 ? turf.lineString(paths[0].map(([lat,lng])=>[lng,lat])) : turf.multiLineString(paths.map(path=>path.map(([lat,lng])=>[lng,lat])));
        const buffered=turf.buffer(geo,bufferFeet,{units:'feet'});
        if (buffered) L.geoJSON(buffered,{ style:{ color:'#2e6f9e',weight:1,opacity:.22,fillColor:'#2e6f9e',fillOpacity:.055,dashArray:'4 5' }, interactive:false }).addTo(group);
      } catch {}
    }
    const lines=[];
    for (const path of paths) {
      const line=L.polyline(path,{ color:'#2e6f9e',weight:corridor.priority==='Primary'?5:3.5,opacity:.88 }).addTo(group);
      line.bindPopup(`<div class="popup-title">${escapeHtml(corridor.name)}</div><div class="popup-row"><span class="popup-label">Type</span>${escapeHtml(corridor.scope||'Corridor')}</div><div class="popup-row"><span class="popup-label">Priority</span>${escapeHtml(corridor.priority)}</div><div class="popup-row"><span class="popup-label">Context</span>${escapeHtml(String(corridor.bufferFeet||0))} ft</div>`);
      lines.push(line);
    }
    group.addTo(corridorLayer); corridorRuntime.set(corridor.id,{group,lines});
  }

  function renderCorridorList() {
    if (!state.corridors.length) { els.corridorList.innerHTML='<div class="empty-state">No corridors designated yet.</div>'; return; }
    els.corridorList.innerHTML=state.corridors.map(c=>`<div class="record-card" data-corridor="${escapeHtml(c.id)}"><div class="record-card-head"><div><div class="record-card-name">${escapeHtml(c.name)}</div><div class="record-card-meta">${escapeHtml(c.scope||'Custom route')} • ${escapeHtml(c.priority)} • ${escapeHtml(String(c.bufferFeet||0))} ft context</div></div><div class="record-card-actions"><button class="mini-action" data-action="zoom">View</button><button class="mini-action" data-action="edit">Edit</button><button class="mini-action" data-action="delete">×</button></div></div></div>`).join('');
    els.corridorList.querySelectorAll('.record-card').forEach(card=>card.addEventListener('click',e=>{
      const btn=e.target.closest('button'); if (!btn) return; const id=card.dataset.corridor;
      if (btn.dataset.action==='edit') editCorridor(id); if (btn.dataset.action==='zoom') zoomCorridor(id); if (btn.dataset.action==='delete') deleteCorridor(id);
    }));
  }

  function editCorridor(id) {
    const c=state.corridors.find(x=>x.id===id); if (!c) return;
    currentCorridorId=id; pendingCorridor=null;
    els.corridorForm.elements.name.value=c.name; els.corridorForm.elements.priority.value=c.priority; els.corridorForm.elements.bufferFeet.value=c.bufferFeet; els.corridorForm.elements.notes.value=c.notes||'';
    els.corridorDialog.returnValue=''; els.corridorDialog.showModal();
  }

  function zoomCorridor(id) {
    const c=state.corridors.find(x=>x.id===id); if (!c) return;
    const points=getCorridorPaths(c).flat(); if (points.length) map.fitBounds(points,{padding:[55,55],maxZoom:17});
  }

  function deleteCorridor(id) {
    const c=state.corridors.find(x=>x.id===id); if (!c) return;
    if (!confirm(`Delete corridor “${c.name}”?`)) return;
    state.corridors=state.corridors.filter(x=>x.id!==id); saveState(); rebuildCorridors(); renderAll();
  }

  function getCorridorPaths(c) {
    if (Array.isArray(c.paths)) return c.paths.filter(p=>Array.isArray(p)&&p.length>1);
    if (Array.isArray(c.latlngs)&&c.latlngs.length>1) return [c.latlngs];
    return [];
  }

  // ---------------- Permits, filters, persistence ----------------

  function renderAll() { refreshFilterOptions(); renderPermits(); renderCorridorList(); updateStats(); updateLayerVisibility(); }
  function scheduleRender() { if (renderScheduled) return; renderScheduled=true; requestAnimationFrame(()=>{renderScheduled=false;renderAll();}); }

  function renderPermits() {
    permitCluster.clearLayers();
    for (const permit of filteredPermits()) {
      if (!isFiniteNumber(permit.lat)||!isFiniteNumber(permit.lng)) continue;
      const icon=L.divIcon({ className:'', html:`<div class="permit-marker ${statusClass(permit.status)}"><span></span></div>`, iconSize:[18,18], iconAnchor:[9,18], popupAnchor:[0,-16] });
      const marker=L.marker([permit.lat,permit.lng],{icon,title:displayAddress(permit)});
      marker.bindPopup(permitPopupHtml(permit));
      marker.on('popupopen',e=>{ const button=e.popup.getElement()?.querySelector('[data-edit-permit]'); if (button) button.addEventListener('click',()=>openPermitDialog(permit.id),{once:true}); });
      permitCluster.addLayer(marker);
    }
  }

  function permitPopupHtml(p) {
    return `<div><div class="popup-title">${escapeHtml(displayAddress(p))}</div><div class="popup-row"><span class="popup-label">Work</span>${escapeHtml(prettySource(p.workType))}</div><div class="popup-row"><span class="popup-label">Contractor</span>${escapeHtml(prettySource(p.contractor))}</div>${p.permitNumber?`<div class="popup-row"><span class="popup-label">Permit</span>${escapeHtml(p.permitNumber)}</div>`:''}<div class="popup-row"><span class="popup-label">Status</span>${escapeHtml(p.status)}${p.archived?' • Archived':''}</div>${p.rowImpact?`<div class="popup-row"><span class="popup-label">Impact</span>${escapeHtml(p.rowImpact)}</div>`:''}${p.startDate||p.endDate?`<div class="popup-row"><span class="popup-label">Dates</span>${escapeHtml(p.startDate||'—')} → ${escapeHtml(p.endDate||'—')}</div>`:''}<button class="popup-btn" data-edit-permit="${escapeHtml(p.id)}">Open permit record</button></div>`;
  }

  function openPermitDialog(id) {
    const p=state.permits.find(x=>x.id===id); if (!p) return;
    currentPermitId=id; els.permitDialogTitle.textContent=displayAddress(p);
    els.sourceBlock.innerHTML=`<div class="source-grid"><div class="source-item"><strong>Address # — source</strong>${escapeHtml(p.addressNumber)}</div><div class="source-item"><strong>Street — source</strong>${escapeHtml(p.street)}</div><div class="source-item"><strong>Work type — source</strong>${escapeHtml(p.workType)}</div><div class="source-item"><strong>Contractor — source</strong>${escapeHtml(p.contractor)}</div></div><div class="source-filename">${escapeHtml(p.sourceFilename)}</div>`;
    for (const key of ['permitNumber','status','startDate','endDate','rowImpact','notes']) els.permitForm.elements[key].value=p[key]||'';
    els.matchInfo.textContent=locationDescription(p); els.archivePermitBtn.textContent=p.archived?'Restore from archive':'Archive'; els.permitDialog.showModal();
  }

  function savePermitForm(e) { e.preventDefault(); const p=state.permits.find(x=>x.id===currentPermitId); if (!p) return; applyFormToPermit(p); saveState(); els.permitDialog.close(); renderAll(); toast('Permit record saved.'); }
  function applyFormToPermit(p) { p.permitNumber=els.permitForm.elements.permitNumber.value; p.status=els.permitForm.elements.status.value; p.startDate=els.permitForm.elements.startDate.value; p.endDate=els.permitForm.elements.endDate.value; p.rowImpact=els.permitForm.elements.rowImpact.value; p.notes=els.permitForm.elements.notes.value; p.updatedAt=new Date().toISOString(); }

  function startMoveCurrentPermit() { const p=state.permits.find(x=>x.id===currentPermitId); if (!p) return; applyFormToPermit(p); saveState(); mapMovePermitId=p.id; els.permitDialog.close(); toast(`Click the correct map location for ${displayAddress(p)}.`); }

  async function retryCurrentPermitLocation() {
    const p=state.permits.find(x=>x.id===currentPermitId); if (!p) return; applyFormToPermit(p); p.lat=null; p.lng=null;
    const ok=await locatePermit(p,true,false); saveState(); renderAll(); els.matchInfo.textContent=locationDescription(p); if (ok) { map.setView([p.lat,p.lng],17); toast(`Matched ${p.matchedFullAddr||displayAddress(p)}.`); }
  }

  function archiveCurrentPermit() { const p=state.permits.find(x=>x.id===currentPermitId); if (!p) return; applyFormToPermit(p); p.archived=!p.archived; saveState(); els.permitDialog.close(); renderAll(); toast(p.archived?'Permit archived.':'Permit restored from archive.'); }

  function deleteCurrentPermit() {
    const p=state.permits.find(x=>x.id===currentPermitId); if (!p) return;
    if (!confirm(`Permanently delete ${p.sourceFilename}?\n\nRe-importing the same filename later would create it again.`)) return;
    state.permits=state.permits.filter(x=>x.id!==p.id); saveState(); els.permitDialog.close(); renderAll(); toast('Permit permanently deleted from local data.');
  }

  function showUnlocated() { renderUnlocatedList(); els.unlocatedDialog.showModal(); }
  function renderUnlocatedList() {
    const items=state.permits.filter(p=>!isFiniteNumber(p.lat)||!isFiniteNumber(p.lng));
    if (!items.length) { els.unlocatedList.innerHTML='<div class="empty-state">Every permit currently has a map location.</div>'; return; }
    els.unlocatedList.innerHTML=items.map(p=>`<div class="unlocated-row" data-id="${escapeHtml(p.id)}"><div><strong>${escapeHtml(displayAddress(p))}</strong><small>${escapeHtml(prettySource(p.workType))} • ${escapeHtml(prettySource(p.contractor))}</small></div><div><button class="button small" data-action="retry">Retry</button> <button class="button small" data-action="place">Place on map</button></div></div>`).join('');
    els.unlocatedList.querySelectorAll('.unlocated-row').forEach(row=>row.addEventListener('click',async e=>{
      const btn=e.target.closest('button'); if (!btn) return; const p=state.permits.find(x=>x.id===row.dataset.id); if (!p) return;
      if (btn.dataset.action==='retry') { const ok=await locatePermit(p,true,false); saveState(); renderAll(); renderUnlocatedList(); if (ok) map.setView([p.lat,p.lng],17); }
      else if (btn.dataset.action==='place') { manualPlacePermitId=p.id; els.unlocatedDialog.close(); toast(`Click the correct map location for ${displayAddress(p)}.`); }
    }));
  }

  function filteredPermits() {
    const search=normalizeMatch(els.searchFilter.value); const statuses=new Set([...els.statusFilters.querySelectorAll('input:checked')].map(i=>i.dataset.status));
    const workType=els.workTypeFilter.value, contractor=els.contractorFilter.value, from=els.dateFrom.value, to=els.dateTo.value;
    return state.permits.filter(p=>{
      if (!statuses.has(p.status)) return false; if (els.hideClosedFilter.checked&&p.status==='Closed') return false; if (els.hideArchivedFilter.checked&&p.archived) return false;
      if (workType&&p.workType!==workType) return false; if (contractor&&p.contractor!==contractor) return false;
      if (search) { const hay=normalizeMatch([p.addressNumber,p.street,p.workType,p.contractor,p.permitNumber,p.status,p.rowImpact,p.notes,p.sourceFilename].join(' ')); if (!hay.includes(search)) return false; }
      if ((from||to)&&!dateRangeIntersects(p.startDate,p.endDate,from,to)) return false;
      if (els.corridorOnlyFilter.checked&&!permitNearAnyCorridor(p)) return false; if (els.venueOnlyFilter.checked&&!permitNearAnyVenue(p)) return false;
      return true;
    });
  }

  async function ensureConeZonesLoaded() {
    if (coneZonesLoaded) return true;
    if (coneZonesLoading) return coneZonesLoading;
    setConeZonesStatus('Loading current City Cone Zones…');
    coneZonesLoading = loadConeZonesFromOfficialExperience();
    try {
      const count = await coneZonesLoading;
      coneZonesLoaded = true;
      coneZonesFeatureCount = count;
      setConeZonesStatus(`<strong>${count}</strong> current Cone Zones feature${count===1?'':'s'} loaded from the City map.`);
      if (els.layerConeZones.checked) toggleLayer(coneZonesLayer,true);
      return true;
    } catch (err) {
      console.warn('Cone Zones load failed', err);
      coneZonesLayer.clearLayers();
      coneZonesLoaded = false;
      const msg = escapeHtml(err?.message || 'Public Cone Zones data could not be loaded.');
      setConeZonesStatus(`Cone Zones unavailable right now. ${msg}`, true);
      toast('Cone Zones could not be loaded from the City public map. Your permit data is unaffected.');
      return false;
    } finally {
      coneZonesLoading = null;
    }
  }

  function setConeZonesStatus(html, isError=false) {
    if (!els.coneZonesStatus) return;
    els.coneZonesStatus.hidden = false;
    els.coneZonesStatus.classList.toggle('error', !!isError);
    els.coneZonesStatus.innerHTML = html;
  }

  async function loadConeZonesFromOfficialExperience() {
    coneZonesLayer.clearLayers();
    const experienceData = await arcgisItemData(CONE_ZONES_EXPERIENCE_ID);
    const ids = collectArcGisItemIds(experienceData);
    if (!ids.length) throw new Error('The public Cone Zones app did not expose a map item.');

    const metadataResults = await Promise.all(ids.slice(0,80).map(async id => {
      try { return await arcgisItemInfo(id); } catch { return null; }
    }));
    let webMaps = metadataResults.filter(item => item && item.type === 'Web Map');
    if (!webMaps.length) {
      const nestedIds = new Set();
      for (const item of metadataResults.filter(Boolean).slice(0,24)) {
        try { collectArcGisItemIds(await arcgisItemData(item.id)).forEach(id => nestedIds.add(id)); } catch {}
      }
      const nestedMetadata = await Promise.all([...nestedIds].slice(0,80).map(async id => {
        try { return await arcgisItemInfo(id); } catch { return null; }
      }));
      webMaps = nestedMetadata.filter(item => item && item.type === 'Web Map');
    }
    if (!webMaps.length) throw new Error('The public Cone Zones web map could not be discovered.');

    webMaps = webMaps.sort((a,b) => coneMapScore(b)-coneMapScore(a));
    const bestScore = coneMapScore(webMaps[0]);
    const selected = bestScore > 0 ? webMaps.filter(m => coneMapScore(m) === bestScore) : [webMaps[0]];

    let added = 0;
    for (const webMap of selected.slice(0,2)) {
      const data = await arcgisItemData(webMap.id);
      const leaves = flattenArcGisOperationalLayers(data?.operationalLayers || []);
      const relevant = leaves.filter(isConeZonesOperationalLayer);
      const toLoad = relevant.length ? relevant : leaves.filter(l => !/camera|city limit|basemap/i.test(l.title || ''));
      for (const descriptor of toLoad) {
        try { added += await addConeZonesDescriptor(descriptor); }
        catch (err) { console.warn('Cone Zones layer skipped', descriptor.title, err); }
      }
    }
    if (!added) throw new Error('The City map loaded, but no public construction geometry was returned.');
    return added;
  }

  function coneMapScore(item) {
    const text = `${item?.title || ''} ${(item?.tags || []).join(' ')} ${item?.snippet || ''}`.toLowerCase();
    let score = 0;
    if (text.includes('cone')) score += 50;
    if (text.includes('construction')) score += 20;
    if (text.includes('travel')) score += 15;
    if (text.includes('impact')) score += 15;
    if (text.includes('boulder')) score += 5;
    return score;
  }

  function collectArcGisItemIds(root) {
    const ids = new Set();
    const visit = value => {
      if (!value) return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (typeof value !== 'object') return;
      for (const [key,val] of Object.entries(value)) {
        const k = key.toLowerCase();
        const itemKey = k.includes('itemid') || k.includes('portalitem') || k.includes('webmap');
        if (itemKey && typeof val === 'string' && /^(?:[a-f0-9]{32})$/i.test(val)) ids.add(val);
        else if (itemKey && Array.isArray(val)) for (const entry of val) if (typeof entry === 'string' && /^(?:[a-f0-9]{32})$/i.test(entry)) ids.add(entry);
        visit(val);
      }
    };
    visit(root);
    return [...ids];
  }

  async function arcgisItemInfo(id) {
    const res = await fetch(`${ARCGIS_ITEMS_ROOT}/${encodeURIComponent(id)}?f=json`);
    if (!res.ok) throw new Error(`ArcGIS item ${res.status}`);
    const json = await res.json();
    if (json?.error) throw new Error(json.error.message || 'ArcGIS item error');
    return json;
  }

  async function arcgisItemData(id) {
    const res = await fetch(`${ARCGIS_ITEMS_ROOT}/${encodeURIComponent(id)}/data?f=json`);
    if (!res.ok) throw new Error(`ArcGIS data ${res.status}`);
    const json = await res.json();
    if (json?.error) throw new Error(json.error.message || 'ArcGIS data error');
    return json;
  }

  function flattenArcGisOperationalLayers(layers, parentTitle='') {
    const out = [];
    for (const layer of layers || []) {
      const title = [parentTitle, layer?.title || layer?.name || ''].filter(Boolean).join(' — ');
      if (Array.isArray(layer?.layers) && layer.layers.length) {
        if (layer.url) {
          for (const sub of layer.layers) {
            out.push({ ...sub, title:[title,sub.title || sub.name || `Layer ${sub.id}`].filter(Boolean).join(' — '), url:sub.url || `${layer.url.replace(/\/$/,'')}/${sub.id}` });
          }
        } else {
          out.push(...flattenArcGisOperationalLayers(layer.layers, title));
        }
        continue;
      }
      out.push({ ...layer, title });
    }
    return out;
  }

  function isConeZonesOperationalLayer(layer) {
    const text = `${layer?.title || ''} ${layer?.url || ''}`.toLowerCase();
    if (/camera|city limit|basemap|reference|boundary/.test(text)) return false;
    return /cone|construction|project|closure|detour|delay|impact|work zone|event|maintenance|outage/.test(text);
  }

  async function addConeZonesDescriptor(descriptor) {
    if (descriptor.featureCollection?.layers?.length) {
      let count = 0;
      for (const fc of descriptor.featureCollection.layers) {
        const features = fc?.featureSet?.features || [];
        const converted = esriFeaturesToGeoJson(features, fc?.featureSet?.geometryType || fc?.layerDefinition?.geometryType);
        count += addConeZonesGeoJson(converted, descriptor.title || fc?.layerDefinition?.name || 'Cone Zones');
      }
      return count;
    }
    if (!descriptor.url && descriptor.itemId) {
      const item = await arcgisItemInfo(descriptor.itemId);
      if (item?.url) descriptor = { ...descriptor, url:item.url };
      else {
        const itemData = await arcgisItemData(descriptor.itemId);
        const embedded = itemData?.layers || itemData?.featureCollection?.layers || [];
        let count = 0;
        for (const fc of embedded) {
          const features = fc?.featureSet?.features || [];
          const converted = esriFeaturesToGeoJson(features, fc?.featureSet?.geometryType || fc?.layerDefinition?.geometryType);
          count += addConeZonesGeoJson(converted, descriptor.title || item.title || fc?.layerDefinition?.name || 'Cone Zones');
        }
        return count;
      }
    }
    if (!descriptor.url) return 0;
    const queryTargets = await resolveArcGisQueryTargets(descriptor);
    let count = 0;
    for (const target of queryTargets) {
      const geojson = await queryArcGisGeoJson(target.url, target.where);
      count += addConeZonesGeoJson(geojson, target.title || descriptor.title || 'Cone Zones');
    }
    return count;
  }

  async function resolveArcGisQueryTargets(descriptor) {
    const url = descriptor.url.replace(/\/$/,'');
    const where = descriptor?.layerDefinition?.definitionExpression || descriptor?.definitionExpression || '1=1';
    if (/\/(?:FeatureServer|MapServer)\/\d+$/i.test(url)) return [{ url, title:descriptor.title, where }];
    if (!/\/(?:FeatureServer|MapServer)$/i.test(url)) return [];
    const res = await fetch(`${url}?f=json`);
    if (!res.ok) throw new Error(`Cone Zones service ${res.status}`);
    const meta = await res.json();
    const configured = new Map((descriptor.layers || []).map(l => [Number(l.id), l]));
    return (meta.layers || []).filter(l => !l.subLayerIds?.length).map(l => {
      const cfg = configured.get(Number(l.id));
      return {
        url:`${url}/${l.id}`,
        title:[descriptor.title,cfg?.title || l.name].filter(Boolean).join(' — '),
        where:cfg?.layerDefinition?.definitionExpression || cfg?.definitionExpression || where
      };
    });
  }

  async function queryArcGisGeoJson(layerUrl, where='1=1') {
    const all = { type:'FeatureCollection', features:[] };
    let offset = 0;
    for (let page=0; page<6; page++) {
      const params = new URLSearchParams({
        where:where || '1=1', outFields:'*', returnGeometry:'true', outSR:'4326', f:'geojson',
        resultOffset:String(offset), resultRecordCount:'2000'
      });
      const res = await fetch(`${layerUrl}/query?${params}`);
      if (!res.ok) throw new Error(`Cone Zones query ${res.status}`);
      const json = await res.json();
      if (json?.error) throw new Error(json.error.message || 'Cone Zones query error');
      const features = Array.isArray(json?.features) ? json.features : [];
      all.features.push(...features);
      if (features.length < 2000 || !json.exceededTransferLimit) break;
      offset += features.length;
    }
    return all;
  }

  function addConeZonesGeoJson(geojson, layerTitle) {
    const features = Array.isArray(geojson?.features) ? geojson.features.filter(f => f?.geometry) : [];
    if (!features.length) return 0;
    const layer = L.geoJSON({ type:'FeatureCollection', features }, {
      pane:'overlayPane',
      style: feature => coneZoneStyle(feature),
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius:6, color:'#fff', weight:2, fillColor:'#d66b24', fillOpacity:.95 }),
      onEachFeature: (feature, leafletLayer) => leafletLayer.bindPopup(coneZonePopup(feature, layerTitle), { maxWidth:340, className:'cone-zone-popup' })
    });
    layer.addTo(coneZonesLayer);
    return features.length;
  }

  function coneZoneStyle(feature) {
    const type = feature?.geometry?.type || '';
    if (/Polygon/i.test(type)) return { color:'#c65d1d', weight:2, opacity:.9, fillColor:'#e39a54', fillOpacity:.16 };
    return { color:'#d66b24', weight:4, opacity:.88 };
  }

  function coneZonePopup(feature, layerTitle) {
    const p = feature?.properties || {};
    const title = firstProperty(p, ['projectname','project_name','name','title','project','location','address']) || layerTitle || 'Cone Zones';
    const rows = [];
    const preferred = [
      ['Impact',['impact','travelimpact','travel_impact','description','details','summary']],
      ['Status',['status','projectstatus','project_status']],
      ['Start',['startdate','start_date','begindate','begin_date','fromdate','datefrom']],
      ['End',['enddate','end_date','completiondate','completion_date','todate','dateto']],
      ['Location',['location','address','street','limits']]
    ];
    const used = new Set();
    for (const [label, keys] of preferred) {
      const hit = firstPropertyEntry(p, keys);
      if (!hit || hit[1]===null || hit[1]==='') continue;
      used.add(hit[0]);
      rows.push(`<div class="popup-row"><span class="popup-label">${escapeHtml(label)}</span>${escapeHtml(formatConeValue(hit[1]))}</div>`);
      if (rows.length >= 5) break;
    }
    if (rows.length < 3) {
      for (const [key,value] of Object.entries(p)) {
        if (used.has(key) || value===null || value==='' || /objectid|globalid|shape|fid|latitude|longitude/i.test(key)) continue;
        rows.push(`<div class="popup-row"><span class="popup-label">${escapeHtml(friendlyFieldName(key))}</span>${escapeHtml(formatConeValue(value))}</div>`);
        if (rows.length >= 5) break;
      }
    }
    return `<div class="cone-zone-layer-name">${escapeHtml(layerTitle || 'Cone Zones')}</div><div class="popup-title">${escapeHtml(formatConeValue(title))}</div>${rows.join('')}<div class="cone-zone-source">Live reference from City of Boulder Cone Zones</div>`;
  }

  function firstProperty(props, names) { const hit=firstPropertyEntry(props,names); return hit ? hit[1] : ''; }
  function firstPropertyEntry(props, names) {
    const entries=Object.entries(props || {});
    for (const wanted of names) {
      const hit=entries.find(([k]) => k.toLowerCase().replace(/[^a-z0-9]/g,'') === wanted.toLowerCase().replace(/[^a-z0-9]/g,''));
      if (hit) return hit;
    }
    return null;
  }
  function friendlyFieldName(key) { return String(key).replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/\b\w/g,m=>m.toUpperCase()); }
  function formatConeValue(value) {
    if (typeof value === 'number' && value > 946684800000 && value < 4102444800000) {
      const d=new Date(value); if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
    }
    const s=String(value ?? '');
    const ms=/^\/Date\((\d+)\)\/$/.exec(s); if (ms) { const d=new Date(Number(ms[1])); if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(); }
    return s.length > 260 ? `${s.slice(0,257)}…` : s;
  }

  function esriFeaturesToGeoJson(features, geometryType) {
    const out=[];
    for (const f of features || []) {
      const g=f.geometry || {};
      let geometry=null;
      if (Number.isFinite(g.x) && Number.isFinite(g.y)) geometry={type:'Point',coordinates:[g.x,g.y]};
      else if (Array.isArray(g.paths)) geometry={type:g.paths.length>1?'MultiLineString':'LineString',coordinates:g.paths.length>1?g.paths:g.paths[0]};
      else if (Array.isArray(g.rings)) geometry={type:'Polygon',coordinates:g.rings};
      if (geometry) out.push({type:'Feature',geometry,properties:f.attributes || {}});
    }
    return {type:'FeatureCollection',features:out};
  }

  function permitNearAnyCorridor(p) {
    if (!isFiniteNumber(p.lat)||!isFiniteNumber(p.lng)) return false; const point=turf.point([p.lng,p.lat]);
    for (const c of state.corridors) {
      const feet=Number(c.bufferFeet||0);
      for (const path of getCorridorPaths(c)) {
        try { const line=turf.lineString(path.map(([lat,lng])=>[lng,lat])); if (turf.pointToLineDistance(point,line,{units:'feet'})<=Math.max(feet,25)) return true; } catch {}
      }
    }
    return false;
  }

  function permitNearAnyVenue(p) {
    if (!isFiniteNumber(p.lat)||!isFiniteNumber(p.lng)) return false; const point=turf.point([p.lng,p.lat]);
    for (const v of venueRuntime.values()) if (turf.distance(point,turf.point([v.lng,v.lat]),{units:'miles'})*5280<=VENUE_NEAR_FEET) return true;
    return false;
  }

  function dateRangeIntersects(start,end,from,to) { if (!start&&!end) return false; const s=start||end,e=end||start; if (from&&e<from) return false; if (to&&s>to) return false; return true; }

  function refreshFilterOptions() {
    const currentWork=els.workTypeFilter.value,currentContractor=els.contractorFilter.value; const workTypes=uniqueExact(state.permits.map(p=>p.workType)),contractors=uniqueExact(state.permits.map(p=>p.contractor));
    els.workTypeFilter.innerHTML='<option value="">All work types</option>'+workTypes.map(v=>`<option value="${escapeAttr(v)}">${escapeHtml(prettySource(v))}</option>`).join('');
    els.contractorFilter.innerHTML='<option value="">All contractors</option>'+contractors.map(v=>`<option value="${escapeAttr(v)}">${escapeHtml(prettySource(v))}</option>`).join('');
    els.workTypeFilter.value=workTypes.includes(currentWork)?currentWork:''; els.contractorFilter.value=contractors.includes(currentContractor)?currentContractor:'';
  }

  function updateStats() { els.totalCount.textContent=state.permits.length; els.visibleCount.textContent=filteredPermits().filter(p=>isFiniteNumber(p.lat)&&isFiniteNumber(p.lng)).length; els.unlocatedCount.textContent=state.permits.filter(p=>!isFiniteNumber(p.lat)||!isFiniteNumber(p.lng)).length; }
  function updateLayerVisibility() { toggleLayer(permitCluster,els.layerPermits.checked); toggleLayer(venueLayer,els.layerVenues.checked); toggleLayer(venueBuildingLayer,els.layerBuildings.checked); toggleLayer(venueContextLayer,els.layerVenueContext.checked); toggleLayer(corridorLayer,els.layerCorridors.checked); toggleLayer(coneZonesLayer,els.layerConeZones.checked); }
  function toggleLayer(layer,show) { if (show&&!map.hasLayer(layer)) layer.addTo(map); if (!show&&map.hasLayer(layer)) map.removeLayer(layer); }

  function resetFilters() {
    els.searchFilter.value=''; els.dateFrom.value=''; els.dateTo.value=''; els.workTypeFilter.value=''; els.contractorFilter.value=''; els.corridorOnlyFilter.checked=false; els.venueOnlyFilter.checked=false; els.hideClosedFilter.checked=true; els.hideArchivedFilter.checked=true;
    els.statusFilters.querySelectorAll('input').forEach(i=>i.checked=true); renderAll();
  }

  function fitAll() {
    const points=[]; for (const p of filteredPermits()) if (isFiniteNumber(p.lat)&&isFiniteNumber(p.lng)) points.push([p.lat,p.lng]); for (const v of venueRuntime.values()) points.push([v.lat,v.lng]); for (const c of state.corridors) for (const path of getCorridorPaths(c)) points.push(...path);
    if (els.layerConeZones.checked && coneZonesLoaded && coneZonesLayer.getLayers().length) { const b=coneZonesLayer.getBounds(); if (b.isValid()) { points.push([b.getSouth(),b.getWest()],[b.getNorth(),b.getEast()]); } }
    if (points.length) map.fitBounds(points,{padding:[35,35],maxZoom:16}); else map.setView(BOULDER_CENTER,13);
  }

  function exportBackup() {
    const payload={ format:'pas-de-deux-backup', version:2, exportedAt:new Date().toISOString(), festival:{start:FESTIVAL_START,end:FESTIVAL_END}, permits:state.permits, corridors:state.corridors };
    downloadBlob(`pas-de-deux-backup-${todayStamp()}.json`,JSON.stringify(payload,null,2),'application/json');
  }

  async function importBackup(e) {
    const file=e.target.files?.[0]; if (!file) return;
    try {
      const payload=JSON.parse(await file.text()); const validFormat=['pas-de-deux-backup','sundance-row-map-backup'].includes(payload.format);
      if (!validFormat||!Array.isArray(payload.permits)||!Array.isArray(payload.corridors)) throw new Error('Not a Pas de Deux backup');
      if (!confirm(`Replace local data with this backup?\n\n${payload.permits.length} permits • ${payload.corridors.length} corridors`)) return;
      state=migrateState({initialized:true,permits:payload.permits,corridors:payload.corridors}); saveState(); rebuildCorridors(); renderAll(); toast('Backup imported.');
    } catch (err) { toast(`Backup import failed: ${err.message||err}`); } finally { e.target.value=''; }
  }

  function exportCsv() {
    const headers=['source_filename','address_number','street','work_type','contractor','permit_number','status','archived','start_date','end_date','impact_assessment','notes','latitude','longitude','location_method'];
    const rows=state.permits.map(p=>[p.sourceFilename,p.addressNumber,p.street,p.workType,p.contractor,p.permitNumber,p.status,p.archived?'Yes':'No',p.startDate,p.endDate,p.rowImpact,p.notes,p.lat??'',p.lng??'',p.matchMethod]);
    const csv=[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'); downloadBlob(`pas-de-deux-permits-${todayStamp()}.csv`,csv,'text/csv;charset=utf-8');
  }

  function clearAllData() {
    if (!confirm('Clear ALL local permits, corridors, notes, dates, and statuses from this browser? Export a backup first if you may need them.')) return;
    state={initialized:true,permits:[],corridors:[]}; saveState(); rebuildCorridors(); renderAll(); toast('Local permit and corridor data cleared.');
  }

  function loadState() {
    try { const raw=localStorage.getItem(STORAGE_KEY); if (!raw) return {initialized:false,permits:[],corridors:[]}; const parsed=JSON.parse(raw); return {initialized:!!parsed.initialized,permits:Array.isArray(parsed.permits)?parsed.permits:[],corridors:Array.isArray(parsed.corridors)?parsed.corridors:[]}; }
    catch { return {initialized:false,permits:[],corridors:[]}; }
  }

  function migrateState(input) {
    const output={initialized:!!input.initialized,permits:Array.isArray(input.permits)?input.permits:[],corridors:Array.isArray(input.corridors)?input.corridors:[]};
    for (const p of output.permits) {
      if (p.status==='Application') p.status='Upcoming';
      if (p.status==='Archived') { p.status='Closed'; p.archived=true; }
      if (!STATUS_VALUES.includes(p.status)) p.status='Upcoming';
      if (typeof p.archived!=='boolean') p.archived=false;
    }
    for (const c of output.corridors) {
      if (!Array.isArray(c.paths) && Array.isArray(c.latlngs)) c.paths=[c.latlngs];
      if (!c.sourceType) c.sourceType='custom';
      if (!c.scope) c.scope=c.sourceType==='street'?'Street corridor':'Custom route';
    }
    return output;
  }

  function saveState() { localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
  function locationDescription(p) { if (p.matchMethod==='manual') return `Location: manual map placement (${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)})`; if (isFiniteNumber(p.lat)&&isFiniteNumber(p.lng)) return `Location: ${p.matchedFullAddr||'Boulder public address match'} • ${p.matchMethod||'matched'}`; return 'Location: not matched yet. The permit remains available for manual placement.'; }
  function displayAddress(p) { return `${String(p.addressNumber).trim()} ${prettySource(p.street)}`.trim(); }

  function prettySource(value) {
    return String(value??'').replace(/\b([a-z][a-z']*)\b/gi,token=>{ if (/^[A-Z0-9]{2,}$/.test(token)) return token; if (/^\d+(st|nd|rd|th)$/i.test(token)) return token.toLowerCase(); return token.charAt(0).toUpperCase()+token.slice(1).toLowerCase(); });
  }
  function normalizeMatch(value) { return String(value??'').toLowerCase().replace(/[.,#]/g,' ').replace(/\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|way)\b/g,' ').replace(/\s+/g,' ').trim(); }
  function uniqueExact(arr) { return [...new Set(arr.filter(v=>v!==null&&v!==undefined&&v!==''))].sort((a,b)=>prettySource(a).localeCompare(prettySource(b))); }
  function statusClass(status) { return String(status||'').toLowerCase().replace(/[^a-z0-9]+/g,'-'); }
  function isFiniteNumber(v) { return typeof v==='number'&&Number.isFinite(v); }
  function cryptoRandomId(prefix) { return `${prefix}-${crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
  function todayStamp() { return new Date().toISOString().slice(0,10); }
  function csvCell(v) { const s=String(v??''); return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
  function downloadBlob(name,text,type) { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); }
  function escapeHtml(s) { return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g,'&#39;'); }

  function toast(message) { els.toast.textContent=message; els.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>els.toast.classList.remove('show'),4200); }

  function openDb() { return new Promise((resolve,reject)=>{ const req=indexedDB.open(DB_NAME,1); req.onupgradeneeded=()=>req.result.createObjectStore(DB_STORE); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
  async function idbSet(key,value) { try { const db=await openDb(); await new Promise((resolve,reject)=>{ const tx=db.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).put(value,key); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); db.close(); } catch {} }
  async function idbGet(key) { try { const db=await openDb(); const value=await new Promise((resolve,reject)=>{ const tx=db.transaction(DB_STORE,'readonly'); const req=tx.objectStore(DB_STORE).get(key); req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error); }); db.close(); return value; } catch { return null; } }
})();
