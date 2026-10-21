(() => {
  'use strict';

  const DB_NAME = 'client-time-db';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const STATE_KEY = 'app-state';

  const appEl = document.getElementById('app');
  const modalRoot = document.getElementById('modalRoot');
  const toastEl = document.getElementById('toast');
  const titleEl = document.getElementById('screenTitle');
  const headerAction = document.getElementById('headerAction');
  const navButtons = [...document.querySelectorAll('.nav-item')];

  let db;
  let state = {
    version: 3,
    clients: [],
    services: [],
    entries: [],
    invoices: [],
    settings: defaultSettings()
  };

  let ui = {
    view: 'time',
    selectedDate: todayISO(),
    selectedClientId: '',
    clientDetailId: '',
    exportClientId: 'all',
    exportStart: firstOfMonthISO(),
    exportEnd: todayISO(),
    exportStatus: 'all',
    storagePersistent: null
  };

  function id() {
    return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function todayISO() {
    const d = new Date();
    return localISO(d);
  }

  function firstOfMonthISO() {
    const d = new Date();
    d.setDate(1);
    return localISO(d);
  }

  function localISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function defaultSettings() {
    return {
      businessName: '',
      businessEmail: '',
      businessPhone: '',
      businessAddress: '',
      currency: 'USD',
      defaultTaxRate: 0,
      defaultMileageRate: 0,
      invoicePrefix: 'INV',
      nextInvoiceNumber: 1
    };
  }

  function currencyCode() {
    return state?.settings?.currency || 'USD';
  }

  function moneyIn(n, currency = currencyCode()) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n || 0));
    } catch (_) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0));
    }
  }

  function money(n) {
    return moneyIn(n);
  }

  function hours(n) {
    const val = Number(n || 0);
    return Number.isInteger(val) ? `${val}` : val.toFixed(2).replace(/0$/, '');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      .format(new Date(y, m - 1, d));
  }

  function shortDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d));
  }

  function displayTime(t) {
    if (!t) return '';
    const [hh, mm] = t.split(':').map(Number);
    const d = new Date(2000, 0, 1, hh, mm);
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d);
  }

  function timeToMinutes(t) {
    const [h, m] = String(t || '00:00').split(':').map(Number);
    return h * 60 + m;
  }

  function isOvernight(start, end) {
    return Boolean(start && end && timeToMinutes(end) < timeToMinutes(start));
  }

  function durationHours(start, end) {
    const a = timeToMinutes(start);
    let b = timeToMinutes(end);
    if (b < a) b += 1440;
    return (b - a) / 60;
  }

  function addMinutesToTime(t, minutes) {
    const total = (timeToMinutes(t) + minutes) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function dateDayNumber(iso) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  }

  function shiftInterval(date, start, end) {
    const day = dateDayNumber(date) * 1440;
    const startMinute = timeToMinutes(start);
    let endMinute = timeToMinutes(end);
    if (endMinute < startMinute) endMinute += 1440;
    return { start: day + startMinute, end: day + endMinute };
  }

  function overlaps(aDate, aStart, aEnd, bDate, bStart, bEnd) {
    const a = shiftInterval(aDate, aStart, aEnd);
    const b = shiftInterval(bDate, bStart, bEnd);
    return Math.max(a.start, b.start) < Math.min(a.end, b.end);
  }

  function shiftEndDate(date, start, end) {
    return isOvernight(start, end) ? addDaysISO(date, 1) : date;
  }

  function shiftTimeLabel(date, start, end, withDate = false) {
    const overnight = isOvernight(start, end);
    if (!withDate) return `${displayTime(start)} – ${displayTime(end)}${overnight ? ' · next day' : ''}`;
    const endDate = shiftEndDate(date, start, end);
    return overnight
      ? `${shortDate(date)} ${displayTime(start)} – ${shortDate(endDate)} ${displayTime(end)}`
      : `${shortDate(date)} ${displayTime(start)} – ${displayTime(end)}`;
  }

  async function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGet(key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbSet(key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function persist() {
    try {
      await dbSet(STATE_KEY, state);
    } catch (err) {
      alert('Invox could not save this change to the device. Your current screen has not been cleared; please keep the app open and make a backup if possible.');
      throw err;
    }
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function getClient(clientId) {
    return state.clients.find(c => c.id === clientId);
  }

  function getService(serviceId) {
    return state.services.find(s => s.id === serviceId);
  }

  function sortEntries(list) {
    return [...list].sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
  }

  function calcMileage(entry) {
    const mode = ['manual','odometer'].includes(entry?.mileageMode) ? entry.mileageMode : 'none';
    const rate = Math.max(0, Number(entry?.mileageRate || 0));
    let miles = 0;
    if (mode === 'manual') {
      miles = Math.max(0, Number(entry?.mileageMiles || 0));
    } else if (mode === 'odometer') {
      const start = Number(entry?.mileageStart);
      const end = Number(entry?.mileageEnd);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) miles = end - start;
    }
    return { mode, miles, rate, amount: miles * rate };
  }

  function calcEntry(entry) {
    const hrs = durationHours(entry.start, entry.end);
    const billingType = entry.billingType || 'hourly';
    const serviceAmount = billingType === 'fixed' ? Number(entry.rate || 0) : hrs * Number(entry.rate || 0);
    const mileage = calcMileage(entry);
    const amount = serviceAmount + mileage.amount;
    return { hrs, amount, serviceAmount, billingType, mileage };
  }

  function statusLabel(status) {
    return status === 'paid' ? 'Paid' : status === 'invoiced' ? 'Invoiced' : 'Unbilled';
  }

  function normalizeState(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const settings = { ...defaultSettings(), ...(base.settings || {}) };
    settings.defaultTaxRate = Number.isFinite(Number(settings.defaultTaxRate)) ? Number(settings.defaultTaxRate) : 0;
    settings.defaultMileageRate = Number.isFinite(Number(settings.defaultMileageRate)) && Number(settings.defaultMileageRate) >= 0 ? Number(settings.defaultMileageRate) : 0;
    settings.nextInvoiceNumber = Math.max(1, parseInt(settings.nextInvoiceNumber || 1, 10) || 1);

    const clients = Array.isArray(base.clients) ? base.clients.map(c => ({
      ...c,
      email: c.email || '',
      billingAddress: c.billingAddress || ''
    })) : [];

    const services = Array.isArray(base.services) ? base.services.map(s => ({
      ...s,
      billingType: s.billingType === 'fixed' ? 'fixed' : 'hourly'
    })) : [];

    const entries = Array.isArray(base.entries) ? base.entries.map(e => ({
      ...e,
      billingType: e.billingType === 'fixed' ? 'fixed' : 'hourly',
      status: ['unbilled','invoiced','paid'].includes(e.status) ? e.status : 'unbilled',
      mileageMode: ['manual','odometer'].includes(e.mileageMode) ? e.mileageMode : 'none',
      mileageStart: Number.isFinite(Number(e.mileageStart)) ? Number(e.mileageStart) : null,
      mileageEnd: Number.isFinite(Number(e.mileageEnd)) ? Number(e.mileageEnd) : null,
      mileageMiles: Number.isFinite(Number(e.mileageMiles)) ? Math.max(0, Number(e.mileageMiles)) : 0,
      mileageRate: Number.isFinite(Number(e.mileageRate)) ? Math.max(0, Number(e.mileageRate)) : 0
    })) : [];

    const invoices = Array.isArray(base.invoices) ? base.invoices.map(inv => ({
      ...inv,
      status: inv.status === 'paid' ? 'paid' : 'issued',
      currency: inv.currency || settings.currency || 'USD',
      lines: Array.isArray(inv.lines) ? inv.lines : [],
      entryIds: Array.isArray(inv.entryIds) ? inv.entryIds : []
    })) : [];

    return { version: 3, clients, services, entries, invoices, settings };
  }

  function totals(list) {
    return list.reduce((acc, e) => {
      const x = calcEntry(e);
      acc.hours += x.hrs;
      acc.serviceAmount += x.serviceAmount;
      acc.mileageMiles += x.mileage.miles;
      acc.mileageAmount += x.mileage.amount;
      acc.amount += x.amount;
      return acc;
    }, { hours: 0, serviceAmount: 0, mileageMiles: 0, mileageAmount: 0, amount: 0 });
  }

  function setView(view) {
    ui.view = view;
    ui.clientDetailId = view === 'clients' ? ui.clientDetailId : '';
    navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    render();
  }

  function render() {
    titleEl.textContent = ui.view === 'time' ? 'Time' : ui.view === 'clients' ? 'Clients' : ui.view === 'rates' ? 'Rates' : 'Billing';
    headerAction.style.display = ui.view === 'export' ? 'none' : 'grid';
    headerAction.setAttribute('aria-label', ui.view === 'time' ? 'Add work block' : ui.view === 'clients' ? 'Add client' : 'Add rate');

    if (ui.view === 'time') renderTime();
    if (ui.view === 'clients') renderClients();
    if (ui.view === 'rates') renderRates();
    if (ui.view === 'export') renderExport();
  }

  function renderTime() {
    if (!ui.selectedClientId && state.clients.length) ui.selectedClientId = state.clients[0].id;
    if (ui.selectedClientId && !getClient(ui.selectedClientId)) ui.selectedClientId = state.clients[0]?.id || '';

    const clientOptions = state.clients.map(c => `<option value="${esc(c.id)}" ${c.id === ui.selectedClientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const dayEntries = sortEntries(state.entries.filter(e => e.clientId === ui.selectedClientId && e.date === ui.selectedDate));
    const dayTotals = totals(dayEntries);

    appEl.innerHTML = `
      <section class="section">
        <div class="card pad">
          <div class="control-grid">
            <div class="field">
              <label for="timeClient">Client</label>
              <select id="timeClient" ${state.clients.length ? '' : 'disabled'}>
                ${state.clients.length ? clientOptions : '<option>No clients yet</option>'}
              </select>
            </div>
            <div class="field">
              <label for="timeDate">Shift start date</label>
              <input id="timeDate" type="date" value="${esc(ui.selectedDate)}" />
            </div>
          </div>
        </div>
      </section>

      ${state.clients.length ? `
        <section class="metrics" aria-label="Day totals">
          <div class="metric"><div class="metric-label">Total hours</div><div class="metric-value">${hours(dayTotals.hours)}</div></div>
          <div class="metric secondary"><div class="metric-label">Day total</div><div class="metric-value">${money(dayTotals.amount)}</div></div>
        </section>

        <section class="section">
          <div class="section-header">
            <div>
              <div class="section-title">Work blocks</div>
              <div class="section-subtitle">${esc(formatDate(ui.selectedDate))}</div>
            </div>
            <button class="btn primary small" id="addBlockInline" type="button">+ Add block</button>
          </div>
          <div class="entry-list">
            ${dayEntries.length ? dayEntries.map(entryCard).join('') : `
              <div class="card empty"><strong>No work logged</strong>Add the first block for this client and date.</div>
            `}
          </div>
        </section>
      ` : `
        <section class="section">
          <div class="card empty">
            <strong>Add a client to begin</strong>
            Work blocks are saved under a client and work date.
            <div style="margin-top:14px"><button class="btn primary" id="firstClient" type="button">Add client</button></div>
          </div>
        </section>
      `}
    `;

    const clientSelect = document.getElementById('timeClient');
    if (clientSelect) clientSelect.onchange = e => { ui.selectedClientId = e.target.value; renderTime(); };
    document.getElementById('timeDate').onchange = e => { ui.selectedDate = e.target.value || todayISO(); renderTime(); };
    document.getElementById('addBlockInline')?.addEventListener('click', () => openBlockModal());
    document.getElementById('firstClient')?.addEventListener('click', () => openClientModal());
    bindEntryActions();
  }

  function entryCard(e) {
    const { hrs, amount, billingType, mileage } = calcEntry(e);
    const notes = e.notes ? `<div class="entry-notes">${esc(e.notes)}</div>` : '';
    const rateText = billingType === 'fixed' ? `${money(e.rate)} fixed` : `${money(e.rate)}/hr`;
    const billingText = billingType === 'fixed' ? `Fixed · ${hours(hrs)} hrs tracked` : `${hours(hrs)} hrs`;
    const mileageText = mileage.miles > 0 ? `<span class="dot mileage-meta">${hours(mileage.miles)} mi · ${money(mileage.amount)} mileage</span>` : '';
    const statusClass = e.status === 'paid' ? 'paid' : e.status === 'invoiced' ? 'invoiced' : 'unbilled';
    return `
      <article class="card entry-card" data-entry="${esc(e.id)}">
        <div class="entry-head">
          <div>
            <div class="entry-time">${esc(displayTime(e.start))} – ${esc(displayTime(e.end))}${isOvernight(e.start, e.end) ? '<span class="overnight-label">next day</span>' : ''}</div>
            <div class="entry-meta">
              <span class="pill accent">${esc(e.serviceName || 'Custom')}</span>
              <span>${billingText}</span>
              <span class="dot">${rateText}</span>
              ${mileageText}
              <span class="pill status-pill ${statusClass}">${statusLabel(e.status)}</span>
            </div>
          </div>
          <div class="entry-amount">${money(amount)}</div>
        </div>
        ${notes}
        <div class="entry-actions">
          <button class="btn outline small edit-entry" data-id="${esc(e.id)}" type="button">Edit</button>
          <button class="btn secondary small delete-entry" data-id="${esc(e.id)}" type="button">Delete</button>
        </div>
      </article>
    `;
  }

  function bindEntryActions() {
    document.querySelectorAll('.edit-entry').forEach(btn => btn.addEventListener('click', () => openBlockModal(btn.dataset.id)));
    document.querySelectorAll('.delete-entry').forEach(btn => btn.addEventListener('click', async () => {
      const entry = state.entries.find(e => e.id === btn.dataset.id);
      if (!entry) return;
      if (!confirm(`Delete the ${shiftTimeLabel(entry.date, entry.start, entry.end, true)} block?`)) return;
      state.entries = state.entries.filter(e => e.id !== entry.id);
      await persist();
      toast('Work block deleted');
      render();
    }));
  }

  function renderClients() {
    if (ui.clientDetailId) {
      renderClientDetail(ui.clientDetailId);
      return;
    }

    const rows = state.clients.map(client => {
      const list = state.entries.filter(e => e.clientId === client.id);
      const t = totals(list);
      const last = sortEntries(list).at(-1);
      return `
        <button class="list-row client-open list-row-button" data-id="${esc(client.id)}" type="button">
          <div class="row-main">
            <div class="row-title">${esc(client.name)}</div>
            <div class="row-sub">${last ? `Last logged ${esc(shortDate(last.date))}` : 'No time logged yet'}</div>
          </div>
          <div class="row-value">${hours(t.hours)} hrs<small>${money(t.amount)}</small></div>
        </button>
      `;
    }).join('');

    appEl.innerHTML = `
      <section class="section">
        <div class="section-header">
          <div><div class="section-title">Client records</div><div class="section-subtitle">Work history and totals</div></div>
        </div>
        <div class="card">
          ${rows || `<div class="empty"><strong>No clients yet</strong>Add a client to start keeping time.</div>`}
        </div>
      </section>
    `;

    document.querySelectorAll('.client-open').forEach(btn => btn.addEventListener('click', () => {
      ui.clientDetailId = btn.dataset.id;
      renderClients();
    }));
  }

  function renderClientDetail(clientId) {
    const client = getClient(clientId);
    if (!client) { ui.clientDetailId = ''; renderClients(); return; }
    const list = sortEntries(state.entries.filter(e => e.clientId === clientId));
    const t = totals(list);
    const grouped = {};
    list.forEach(e => (grouped[e.date] ||= []).push(e));
    const days = Object.keys(grouped).sort().reverse();

    appEl.innerHTML = `
      <section class="section">
        <button class="btn outline small" id="backClients" type="button">← All clients</button>
      </section>
      <section class="section">
        <div class="card pad">
          <div class="entry-head">
            <div>
              <div style="font-size:22px;font-weight:850">${esc(client.name)}</div>
              ${(client.email || client.billingAddress) ? `<div class="client-contact">${client.email ? `<div>${esc(client.email)}</div>` : ''}${client.billingAddress ? `<div>${esc(client.billingAddress).replaceAll('\n','<br>')}</div>` : ''}</div>` : ''}
              ${client.details ? `<div class="client-notes">${esc(client.details)}</div>` : ''}
            </div>
            <button class="btn secondary small" id="editClient" type="button">Edit</button>
          </div>
        </div>
      </section>
      <section class="metrics">
        <div class="metric"><div class="metric-label">All hours</div><div class="metric-value">${hours(t.hours)}</div></div>
        <div class="metric secondary"><div class="metric-label">All work</div><div class="metric-value">${money(t.amount)}</div></div>
      </section>
      <section class="section">
        <div class="section-header"><div><div class="section-title">History</div><div class="section-subtitle">${list.length} work ${list.length === 1 ? 'block' : 'blocks'}</div></div></div>
        ${days.length ? days.map(date => {
          const day = grouped[date];
          const dt = totals(day);
          return `<div class="day-group">
            <div class="day-head"><div class="day-date">${esc(formatDate(date))}</div><div class="day-total">${hours(dt.hours)} hrs · ${money(dt.amount)}</div></div>
            <div class="entry-list">${day.map(entryCard).join('')}</div>
          </div>`;
        }).join('') : `<div class="card empty"><strong>No work logged</strong>This client's work history will appear here.</div>`}
      </section>
    `;

    document.getElementById('backClients').onclick = () => { ui.clientDetailId = ''; renderClients(); };
    document.getElementById('editClient').onclick = () => openClientModal(client.id);
    bindEntryActions();
  }

  function renderRates() {
    const rows = [...state.services].sort((a,b) => a.name.localeCompare(b.name)).map(s => {
      const fixed = (s.billingType || 'hourly') === 'fixed';
      return `
        <div class="list-row rate-row">
          <div class="row-main"><div class="row-title">${esc(s.name)}</div><div class="row-sub">${fixed ? 'Default fixed amount' : 'Default hourly rate'}</div></div>
          <div class="row-value rate-value">${money(s.rate)}<small>${fixed ? 'per block' : 'per hour'}</small></div>
          <button class="btn outline small edit-service" data-id="${esc(s.id)}" type="button">Edit</button>
        </div>
      `;
    }).join('');

    appEl.innerHTML = `
      <section class="section">
        <div class="section-header"><div><div class="section-title">Services & rates</div><div class="section-subtitle">Hourly or fixed-price defaults; any block can still be overridden</div></div></div>
        <div class="card">
          ${rows || `<div class="empty"><strong>No rates set</strong>Add the services or work types you bill for.</div>`}
        </div>
      </section>
      <section class="section">
        <div class="note">Changing a default only affects new work blocks. Existing logs retain the billing method and amount that were saved at the time.</div>
      </section>
    `;
    document.querySelectorAll('.edit-service').forEach(btn => btn.addEventListener('click', () => openServiceModal(btn.dataset.id)));
  }

  function renderExport() {
    const clientOptions = state.clients.map(c => `<option value="${esc(c.id)}" ${ui.exportClientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const invalidRange = !ui.exportStart || !ui.exportEnd || ui.exportStart > ui.exportEnd;
    const filtered = invalidRange ? [] : exportEntries();
    const t = totals(filtered);
    const invoiceCandidates = invalidRange ? [] : invoiceCandidateEntries();
    const invoiceTotals = totals(invoiceCandidates);
    const selectedClient = ui.exportClientId === 'all' ? null : getClient(ui.exportClientId);
    const businessReady = Boolean(String(state.settings.businessName || '').trim());
    const invoiceRows = [...state.invoices].sort((a,b) => `${b.issueDate || ''}|${b.createdAt || ''}`.localeCompare(`${a.issueDate || ''}|${a.createdAt || ''}`)).map(inv => {
      const client = getClient(inv.clientId);
      const statusClass = inv.status === 'paid' ? 'paid' : 'invoiced';
      return `
        <div class="invoice-row">
          <div class="row-main">
            <div class="row-title">${esc(inv.number || 'Invoice')}</div>
            <div class="row-sub">${esc(client?.name || inv.clientSnapshot?.name || 'Client')} · ${esc(shortDate(inv.issueDate))} · due ${esc(shortDate(inv.dueDate))}</div>
          </div>
          <div class="invoice-row-right">
            <div class="row-value">${moneyIn(inv.total, inv.currency)}<small><span class="pill status-pill ${statusClass}">${inv.status === 'paid' ? 'Paid' : 'Issued'}</span></small></div>
            <button class="btn outline small print-invoice" data-id="${esc(inv.id)}" type="button">View / PDF</button>
            ${inv.status !== 'paid' ? `<button class="btn secondary small pay-invoice" data-id="${esc(inv.id)}" type="button">Mark paid</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    appEl.innerHTML = `
      <section class="section">
        <div class="section-header"><div><div class="section-title">Billing period</div><div class="section-subtitle">Filter work for Excel export or invoicing</div></div></div>
        <div class="card pad">
          <div class="control-grid">
            <div class="field full">
              <label for="exportClient">Client</label>
              <select id="exportClient">
                <option value="all" ${ui.exportClientId === 'all' ? 'selected' : ''}>All clients</option>
                ${clientOptions}
              </select>
            </div>
            <div class="field">
              <label for="exportStart">Start date</label>
              <input id="exportStart" type="date" value="${esc(ui.exportStart)}" />
            </div>
            <div class="field">
              <label for="exportEnd">End date</label>
              <input id="exportEnd" type="date" value="${esc(ui.exportEnd)}" />
            </div>
            <div class="field full">
              <label for="exportStatus">Billing status</label>
              <select id="exportStatus">
                <option value="all" ${ui.exportStatus === 'all' ? 'selected' : ''}>All statuses</option>
                <option value="unbilled" ${ui.exportStatus === 'unbilled' ? 'selected' : ''}>Unbilled</option>
                <option value="invoiced" ${ui.exportStatus === 'invoiced' ? 'selected' : ''}>Invoiced</option>
                <option value="paid" ${ui.exportStatus === 'paid' ? 'selected' : ''}>Paid</option>
              </select>
            </div>
          </div>
          ${invalidRange ? '<div class="warning" style="margin-top:12px">The start date must be on or before the end date.</div>' : `<div class="preview-bar"><span>${filtered.length} blocks · ${hours(t.hours)} hrs${t.mileageMiles ? ` · ${hours(t.mileageMiles)} mi` : ''}</span><strong>${money(t.amount)}</strong></div>`}
          <div style="margin-top:12px"><button class="btn primary full" id="xlsxExport" type="button" ${(!invalidRange && filtered.length) ? '' : 'disabled'}>Export Excel (.xlsx)</button></div>
        </div>
      </section>

      <section class="section">
        <div class="section-header"><div><div class="section-title">Invoice</div><div class="section-subtitle">Turn unbilled work into a client invoice</div></div></div>
        <div class="card pad">
          ${!selectedClient ? `
            <div class="empty compact"><strong>Choose one client above</strong>Invoices are created for one client at a time.</div>
          ` : !businessReady ? `
            <div class="empty compact"><strong>Set your business details first</strong>Your name or business identity is required on generated invoices.<div style="margin-top:12px"><button class="btn primary" id="invoiceSetup" type="button">Set business details</button></div></div>
          ` : invoiceCandidates.length ? `
            <div class="preview-bar"><span>${invoiceCandidates.length} unbilled blocks · ${hours(invoiceTotals.hours)} hrs${invoiceTotals.mileageMiles ? ` · ${hours(invoiceTotals.mileageMiles)} mi` : ''}</span><strong>${money(invoiceTotals.amount)}</strong></div>
            <div class="note" style="margin-top:10px">Creating an invoice snapshots these blocks and marks them Invoiced. The work logs remain editable, while the saved invoice keeps its original totals.</div>
            <div style="margin-top:12px"><button class="btn primary full" id="createInvoice" type="button">Create invoice for ${esc(selectedClient.name)}</button></div>
          ` : `
            <div class="empty compact"><strong>No unbilled work in this period</strong>Change the date range or log new work for ${esc(selectedClient.name)}.</div>
          `}
        </div>
      </section>

      <section class="section">
        <div class="section-header"><div><div class="section-title">Invoice history</div><div class="section-subtitle">Saved invoices can be reopened or marked paid</div></div></div>
        <div class="card">
          ${invoiceRows || `<div class="empty"><strong>No invoices yet</strong>Your created invoices will appear here.</div>`}
        </div>
      </section>

      <section class="section">
        <div class="section-header"><div><div class="section-title">Business settings</div><div class="section-subtitle">Identity, currency, tax, and invoice numbering</div></div></div>
        <div class="card pad settings-summary">
          <div><strong>${esc(state.settings.businessName || 'Business details not set')}</strong><div class="row-sub">${esc(currencyCode())} · ${Number(state.settings.defaultTaxRate || 0).toFixed(2).replace(/\.00$/,'')}% default tax · ${money(Number(state.settings.defaultMileageRate || 0))}/mi · ${esc(state.settings.invoicePrefix || 'INV')}-${String(state.settings.nextInvoiceNumber || 1).padStart(4,'0')}</div></div>
          <button class="btn outline small" id="businessSettings" type="button">Edit</button>
        </div>
      </section>

      <section class="section">
        <div class="section-header"><div><div class="section-title">Data backup</div><div class="section-subtitle">Protect the local records stored on this device</div></div></div>
        <div class="card pad">
          <div class="success">Closing Invox does not erase records. A backup protects against device loss, replacement, or cleared browser/app data.</div>
          <div class="control-grid" style="margin-top:12px">
            <button class="btn outline" id="backupBtn" type="button">Save backup</button>
            <button class="btn secondary" id="restoreBtn" type="button">Restore backup</button>
          </div>
          <input type="file" id="restoreFile" accept="application/json,.json" hidden />
        </div>
      </section>

      <section class="section">
        <div class="warning"><strong>Stored on this device:</strong> client information, notes, rates, work logs, and invoices stay in this device's local Invox database. Static web hosting only serves the app files.</div>
        <div class="status-line"><span class="status-dot ${ui.storagePersistent === true ? 'ok' : ui.storagePersistent === false ? 'warn' : ''}"></span><span>Storage protection: ${ui.storagePersistent === true ? 'persistent mode granted' : ui.storagePersistent === false ? 'best-effort mode — keep backups' : 'checking device support'}.</span></div>
      </section>
    `;

    document.getElementById('exportClient').onchange = e => { ui.exportClientId = e.target.value; renderExport(); };
    document.getElementById('exportStart').onchange = e => { ui.exportStart = e.target.value || firstOfMonthISO(); renderExport(); };
    document.getElementById('exportEnd').onchange = e => { ui.exportEnd = e.target.value || todayISO(); renderExport(); };
    document.getElementById('exportStatus').onchange = e => { ui.exportStatus = e.target.value; renderExport(); };
    document.getElementById('xlsxExport').onclick = exportXLSX;
    document.getElementById('createInvoice')?.addEventListener('click', openInvoiceModal);
    document.getElementById('invoiceSetup')?.addEventListener('click', openSettingsModal);
    document.getElementById('businessSettings').onclick = openSettingsModal;
    document.getElementById('backupBtn').onclick = saveBackup;
    document.getElementById('restoreBtn').onclick = () => document.getElementById('restoreFile').click();
    document.getElementById('restoreFile').onchange = restoreBackup;
    document.querySelectorAll('.print-invoice').forEach(btn => btn.addEventListener('click', () => printInvoice(btn.dataset.id)));
    document.querySelectorAll('.pay-invoice').forEach(btn => btn.addEventListener('click', () => markInvoicePaid(btn.dataset.id)));
  }

  function exportEntries() {
    return sortEntries(state.entries.filter(e => {
      const clientMatch = ui.exportClientId === 'all' || e.clientId === ui.exportClientId;
      const statusMatch = ui.exportStatus === 'all' || (e.status || 'unbilled') === ui.exportStatus;
      return clientMatch && statusMatch && e.date >= ui.exportStart && e.date <= ui.exportEnd;
    }));
  }

  function invoiceCandidateEntries() {
    if (ui.exportClientId === 'all') return [];
    return sortEntries(state.entries.filter(e => e.clientId === ui.exportClientId && (e.status || 'unbilled') === 'unbilled' && e.date >= ui.exportStart && e.date <= ui.exportEnd));
  }

  function openModal(title, body, actions = '') {
    modalRoot.innerHTML = `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="modal-head"><div class="modal-title">${esc(title)}</div><button class="close-btn" id="closeModal" type="button" aria-label="Close">×</button></div>
          ${body}
          ${actions}
        </div>
      </div>
    `;
    document.getElementById('closeModal').onclick = () => closeModal();
    const modal = modalRoot.querySelector('.modal');
    modal?.querySelectorAll('input, select, textarea').forEach(control => {
      control.addEventListener('input', () => { modal.dataset.dirty = 'true'; });
      control.addEventListener('change', () => { modal.dataset.dirty = 'true'; });
    });
  }

  function closeModal(force = false) {
    const modal = modalRoot.querySelector('.modal');
    if (!force && modal?.dataset.dirty === 'true' && !confirm('Discard unsaved changes?')) return;
    modalRoot.innerHTML = '';
  }

  function openClientModal(clientId = '') {
    const existing = clientId ? getClient(clientId) : null;
    openModal(existing ? 'Edit client' : 'Add client', `
      <div class="control-grid">
        <div class="field full">
          <label for="clientName">Client name</label>
          <input id="clientName" autocomplete="off" value="${esc(existing?.name || '')}" placeholder="e.g. Client name" />
        </div>
        <div class="field full">
          <label for="clientEmail">Email <span class="optional">optional</span></label>
          <input id="clientEmail" type="email" autocomplete="email" value="${esc(existing?.email || '')}" placeholder="client@example.com" />
        </div>
        <div class="field full">
          <label for="clientAddress">Billing address <span class="optional">optional</span></label>
          <textarea id="clientAddress" autocomplete="street-address" placeholder="Address used on invoices">${esc(existing?.billingAddress || '')}</textarea>
        </div>
        <div class="field full">
          <label for="clientDetails">Client notes</label>
          <textarea id="clientDetails" autocomplete="off" placeholder="Client-specific notes, billing details, contact information, or other reference">${esc(existing?.details || '')}</textarea>
        </div>
      </div>
      <div class="form-error" id="clientError"></div>
      <div class="modal-actions">
        ${existing ? '<button class="btn danger" id="deleteClient" type="button">Delete</button>' : '<button class="btn secondary" id="cancelClient" type="button">Cancel</button>'}
        <button class="btn primary" id="saveClient" type="button">Save client</button>
      </div>
    `);

    document.getElementById('cancelClient')?.addEventListener('click', closeModal);
    document.getElementById('saveClient').onclick = async () => {
      const name = document.getElementById('clientName').value.trim();
      const email = document.getElementById('clientEmail').value.trim();
      const billingAddress = document.getElementById('clientAddress').value.trim();
      const details = document.getElementById('clientDetails').value.trim();
      const error = document.getElementById('clientError');
      if (!name) { error.textContent = 'Client name is required.'; error.classList.add('show'); return; }
      if (existing) {
        existing.name = name; existing.email = email; existing.billingAddress = billingAddress; existing.details = details;
      } else {
        const newClient = { id: id(), name, email, billingAddress, details, createdAt: new Date().toISOString() };
        state.clients.push(newClient);
        ui.selectedClientId = newClient.id;
      }
      await persist(); closeModal(true); toast(existing ? 'Client updated' : 'Client added'); render();
    };

    document.getElementById('deleteClient')?.addEventListener('click', async () => {
      const count = state.entries.filter(e => e.clientId === existing.id).length;
      const invoiceCount = state.invoices.filter(inv => inv.clientId === existing.id).length;
      const extra = invoiceCount ? ` and ${invoiceCount} saved invoice${invoiceCount === 1 ? '' : 's'}` : '';
      const msg = count ? `Delete ${existing.name}, all ${count} associated work blocks${extra}? This cannot be undone.` : `Delete ${existing.name}${extra}?`;
      if (!confirm(msg)) return;
      state.clients = state.clients.filter(c => c.id !== existing.id);
      state.entries = state.entries.filter(e => e.clientId !== existing.id);
      state.invoices = state.invoices.filter(inv => inv.clientId !== existing.id);
      if (ui.selectedClientId === existing.id) ui.selectedClientId = state.clients[0]?.id || '';
      ui.clientDetailId = '';
      await persist(); closeModal(true); toast('Client deleted'); render();
    });
  }

  function openServiceModal(serviceId = '') {
    const existing = serviceId ? getService(serviceId) : null;
    const initialType = existing?.billingType === 'fixed' ? 'fixed' : 'hourly';
    openModal(existing ? 'Edit rate' : 'Add rate', `
      <div class="control-grid">
        <div class="field full"><label for="serviceName">Service / work type</label><input id="serviceName" value="${esc(existing?.name || '')}" placeholder="e.g. Caretaking, Consulting, Site visit" /></div>
        <div class="field full">
          <label for="serviceBillingType">Default billing method</label>
          <select id="serviceBillingType"><option value="hourly" ${initialType === 'hourly' ? 'selected' : ''}>Hourly</option><option value="fixed" ${initialType === 'fixed' ? 'selected' : ''}>Fixed price per block</option></select>
        </div>
        <div class="field full"><label for="serviceRate" id="serviceRateLabel">${initialType === 'fixed' ? 'Default fixed amount' : 'Default hourly rate'}</label><input id="serviceRate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(existing?.rate ?? '')}" placeholder="0.00" /></div>
      </div>
      <div class="form-error" id="serviceError"></div>
      <div class="modal-actions">
        ${existing ? '<button class="btn danger" id="deleteService" type="button">Delete</button>' : '<button class="btn secondary" id="cancelService" type="button">Cancel</button>'}
        <button class="btn primary" id="saveService" type="button">Save rate</button>
      </div>
    `);

    document.getElementById('serviceBillingType').onchange = e => {
      document.getElementById('serviceRateLabel').textContent = e.target.value === 'fixed' ? 'Default fixed amount' : 'Default hourly rate';
    };
    document.getElementById('cancelService')?.addEventListener('click', closeModal);
    document.getElementById('saveService').onclick = async () => {
      const name = document.getElementById('serviceName').value.trim();
      const billingType = document.getElementById('serviceBillingType').value === 'fixed' ? 'fixed' : 'hourly';
      const rateRaw = document.getElementById('serviceRate').value;
      const rate = Number(rateRaw);
      const error = document.getElementById('serviceError');
      if (!name || rateRaw === '' || !Number.isFinite(rate) || rate < 0) {
        error.textContent = 'Enter a service name and a valid default amount.'; error.classList.add('show'); return;
      }
      if (existing) { existing.name = name; existing.rate = rate; existing.billingType = billingType; }
      else state.services.push({ id: id(), name, rate, billingType });
      await persist(); closeModal(true); toast(existing ? 'Rate updated' : 'Rate added'); render();
    };

    document.getElementById('deleteService')?.addEventListener('click', async () => {
      if (!confirm(`Delete ${existing.name} from the rate list? Existing work logs will keep their saved service name, billing method, and rate.`)) return;
      state.services = state.services.filter(s => s.id !== existing.id);
      await persist(); closeModal(true); toast('Rate deleted'); render();
    });
  }

  function openBlockModal(entryId = '') {
    if (!state.clients.length) { openClientModal(); return; }
    const existing = entryId ? state.entries.find(e => e.id === entryId) : null;
    const clientId = existing?.clientId || ui.selectedClientId || state.clients[0].id;
    const date = existing?.date || ui.selectedDate || todayISO();
    const services = [...state.services].sort((a,b) => a.name.localeCompare(b.name));
    const existingServiceAvailable = existing?.serviceId ? Boolean(getService(existing.serviceId)) : false;
    const selectedService = existing ? (existingServiceAvailable ? existing.serviceId : 'custom') : (services[0]?.id || 'custom');
    const initialServiceValue = selectedService;
    const priorDayBlocks = existing ? [] : sortEntries(state.entries.filter(e => e.clientId === clientId && e.date === date));
    const priorEnd = priorDayBlocks.at(-1)?.end;
    const startDefault = existing?.start || priorEnd || '08:00';
    const endDefault = existing?.end || addMinutesToTime(startDefault, 60);
    const serviceDefault = getService(selectedService);
    const initialRate = existing?.rate ?? (serviceDefault?.rate ?? '');
    const initialBillingType = existing?.billingType === 'fixed' ? 'fixed' : (serviceDefault?.billingType === 'fixed' ? 'fixed' : 'hourly');
    const customName = existing && selectedService === 'custom' ? (existing.serviceName || '') : '';
    const linkedInvoice = existing ? state.invoices.find(inv => Array.isArray(inv.entryIds) && inv.entryIds.includes(existing.id)) : null;
    const existingStatus = existing?.status || 'unbilled';
    const initialMileageMode = ['manual','odometer'].includes(existing?.mileageMode) ? existing.mileageMode : 'none';
    const initialMileageRate = existing ? Number(existing.mileageRate || 0) : Number(state.settings.defaultMileageRate || 0);
    const initialMileageMiles = existing ? Number(existing.mileageMiles || 0) : '';
    const initialMileageStart = existing?.mileageStart ?? '';
    const initialMileageEnd = existing?.mileageEnd ?? '';

    openModal(existing ? 'Edit work block' : 'Add work block', `
      <div class="control-grid">
        <div class="field full">
          <label for="blockClient">Client</label>
          <select id="blockClient">${state.clients.map(c => `<option value="${esc(c.id)}" ${c.id === clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field full"><label for="blockDate">Shift start date</label><input id="blockDate" type="date" value="${esc(date)}" /></div>
        <div class="field"><label for="blockStart">Start</label><input id="blockStart" type="time" value="${esc(startDefault)}" /></div>
        <div class="field"><label for="blockEnd">End</label><input id="blockEnd" type="time" value="${esc(endDefault)}" /></div>
        <div class="field full"><div class="field-help overnight-help">If the end time is earlier than the start time, Invox treats it as ending the following day.</div></div>
        <div class="field full">
          <label for="blockService">Service / work type</label>
          <select id="blockService">
            ${services.map(s => `<option value="${esc(s.id)}" ${s.id === selectedService ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            <option value="custom" ${selectedService === 'custom' ? 'selected' : ''}>Custom / unlisted</option>
          </select>
        </div>
        <div class="field full" id="customServiceField" style="display:${selectedService === 'custom' ? 'flex' : 'none'}">
          <label for="customService">Custom service name</label><input id="customService" value="${esc(customName)}" placeholder="Describe the work performed" />
        </div>
        <div class="field">
          <label for="blockBillingType">Billing method</label>
          <select id="blockBillingType"><option value="hourly" ${initialBillingType === 'hourly' ? 'selected' : ''}>Hourly</option><option value="fixed" ${initialBillingType === 'fixed' ? 'selected' : ''}>Fixed price</option></select>
        </div>
        <div class="field"><label for="blockRate" id="blockRateLabel">${initialBillingType === 'fixed' ? 'Fixed amount' : 'Hourly rate'}</label><input id="blockRate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(initialRate)}" placeholder="0.00" /></div>
        <div class="field full mileage-section">
          <label for="mileageMode">Mileage <span class="optional">optional</span></label>
          <select id="mileageMode">
            <option value="none" ${initialMileageMode === 'none' ? 'selected' : ''}>No mileage</option>
            <option value="manual" ${initialMileageMode === 'manual' ? 'selected' : ''}>Enter miles directly</option>
            <option value="odometer" ${initialMileageMode === 'odometer' ? 'selected' : ''}>Starting + ending mileage</option>
          </select>
          <div class="field-help">Track billable travel either by entering the miles yourself or letting Invox calculate them from start/end odometer readings.</div>
        </div>
        <div class="field full mileage-fields" id="mileageManualFields" style="display:${initialMileageMode === 'manual' ? 'grid' : 'none'}">
          <div class="field"><label for="mileageMiles">Miles</label><input id="mileageMiles" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(initialMileageMiles)}" placeholder="0.0" /></div>
          <div class="field"><label for="mileageRateManual">Rate per mile</label><input id="mileageRateManual" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(initialMileageRate)}" placeholder="0.00" /></div>
        </div>
        <div class="field full mileage-fields" id="mileageOdometerFields" style="display:${initialMileageMode === 'odometer' ? 'grid' : 'none'}">
          <div class="field"><label for="mileageStart">Starting mileage</label><input id="mileageStart" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(initialMileageStart)}" placeholder="0.0" /></div>
          <div class="field"><label for="mileageEnd">Ending mileage</label><input id="mileageEnd" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(initialMileageEnd)}" placeholder="0.0" /></div>
          <div class="field full"><label for="mileageRateOdometer">Rate per mile</label><input id="mileageRateOdometer" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(initialMileageRate)}" placeholder="0.00" /></div>
        </div>
        <div class="field full">
          <label for="blockStatus">Billing status</label>
          <select id="blockStatus" ${linkedInvoice ? 'disabled' : ''}>
            <option value="unbilled" ${existingStatus === 'unbilled' ? 'selected' : ''}>Unbilled</option>
            <option value="invoiced" ${existingStatus === 'invoiced' ? 'selected' : ''}>Invoiced</option>
            <option value="paid" ${existingStatus === 'paid' ? 'selected' : ''}>Paid</option>
          </select>
          ${linkedInvoice ? `<div class="field-help">Status is managed by invoice ${esc(linkedInvoice.number)}.</div>` : '<div class="field-help">Use Invoiced/Paid for work billed outside Invox, or leave Unbilled for invoice creation here.</div>'}
        </div>
        <div class="field full"><label for="blockNotes">Block notes</label><textarea id="blockNotes" placeholder="What was done during this block?">${esc(existing?.notes || '')}</textarea></div>
      </div>
      <div class="preview-bar"><span id="blockDuration">—</span><strong id="blockAmount">—</strong></div>
      <div class="mileage-preview" id="mileagePreview" style="display:none"></div>
      <div class="form-error" id="blockError"></div>
      <div class="modal-actions"><button class="btn secondary" id="cancelBlock" type="button">Cancel</button><button class="btn primary" id="saveBlock" type="button">Save block</button></div>
    `);

    const serviceEl = document.getElementById('blockService');
    const rateEl = document.getElementById('blockRate');
    const billingEl = document.getElementById('blockBillingType');
    const customField = document.getElementById('customServiceField');
    const mileageModeEl = document.getElementById('mileageMode');
    const mileageManualFields = document.getElementById('mileageManualFields');
    const mileageOdometerFields = document.getElementById('mileageOdometerFields');
    const updateRateLabel = () => {
      document.getElementById('blockRateLabel').textContent = billingEl.value === 'fixed' ? 'Fixed amount' : 'Hourly rate';
    };
    const readMileageForm = () => {
      const mode = mileageModeEl.value;
      if (mode === 'manual') {
        const miles = Number(document.getElementById('mileageMiles').value || 0);
        const mileageRate = Number(document.getElementById('mileageRateManual').value || 0);
        return { mode, miles: Number.isFinite(miles) ? Math.max(0, miles) : 0, rate: Number.isFinite(mileageRate) ? Math.max(0, mileageRate) : 0 };
      }
      if (mode === 'odometer') {
        const odometerStart = Number(document.getElementById('mileageStart').value);
        const odometerEnd = Number(document.getElementById('mileageEnd').value);
        const mileageRate = Number(document.getElementById('mileageRateOdometer').value || 0);
        const valid = Number.isFinite(odometerStart) && Number.isFinite(odometerEnd) && odometerEnd >= odometerStart;
        return { mode, miles: valid ? odometerEnd - odometerStart : 0, rate: Number.isFinite(mileageRate) ? Math.max(0, mileageRate) : 0, odometerStart, odometerEnd, valid };
      }
      return { mode: 'none', miles: 0, rate: 0 };
    };
    const updateMileageFields = () => {
      mileageManualFields.style.display = mileageModeEl.value === 'manual' ? 'grid' : 'none';
      mileageOdometerFields.style.display = mileageModeEl.value === 'odometer' ? 'grid' : 'none';
      updatePreview();
    };
    const updatePreview = () => {
      const dateValue = document.getElementById('blockDate').value;
      const start = document.getElementById('blockStart').value;
      const end = document.getElementById('blockEnd').value;
      const rate = Number(rateEl.value || 0);
      if (!start || !end) return;
      if (timeToMinutes(end) === timeToMinutes(start)) {
        document.getElementById('blockDuration').textContent = 'Start and end match';
        document.getElementById('blockAmount').textContent = '—';
        return;
      }
      const hrs = durationHours(start, end);
      const serviceAmount = billingEl.value === 'fixed' ? rate : hrs * rate;
      const mileage = readMileageForm();
      const mileageAmount = mileage.miles * mileage.rate;
      const overnightText = isOvernight(start, end) && dateValue ? ` · ends ${shortDate(shiftEndDate(dateValue, start, end))}` : '';
      document.getElementById('blockDuration').textContent = `${hours(hrs)} hrs tracked${overnightText}`;
      document.getElementById('blockAmount').textContent = money(serviceAmount + mileageAmount);
      const mileagePreview = document.getElementById('mileagePreview');
      if (mileage.mode !== 'none') {
        const odoText = mileage.mode === 'odometer' && mileage.valid ? ` · ${hours(mileage.odometerStart)} → ${hours(mileage.odometerEnd)}` : '';
        mileagePreview.style.display = 'flex';
        mileagePreview.innerHTML = `<span>Mileage${odoText}</span><strong>${hours(mileage.miles)} mi × ${money(mileage.rate)} = ${money(mileageAmount)}</strong>`;
      } else {
        mileagePreview.style.display = 'none';
        mileagePreview.innerHTML = '';
      }
    };

    serviceEl.onchange = () => {
      const isCustom = serviceEl.value === 'custom';
      customField.style.display = isCustom ? 'flex' : 'none';
      if (!isCustom) {
        const service = getService(serviceEl.value);
        rateEl.value = service?.rate ?? '';
        billingEl.value = service?.billingType === 'fixed' ? 'fixed' : 'hourly';
        updateRateLabel();
      }
      updatePreview();
    };
    billingEl.onchange = () => { updateRateLabel(); updatePreview(); };
    mileageModeEl.onchange = updateMileageFields;
    ['blockDate','blockStart','blockEnd','blockRate','mileageMiles','mileageRateManual','mileageStart','mileageEnd','mileageRateOdometer'].forEach(key => document.getElementById(key).addEventListener('input', updatePreview));
    updateMileageFields();
    document.getElementById('cancelBlock').onclick = closeModal;

    document.getElementById('saveBlock').onclick = async () => {
      const clientIdValue = document.getElementById('blockClient').value;
      const dateValue = document.getElementById('blockDate').value;
      const start = document.getElementById('blockStart').value;
      const end = document.getElementById('blockEnd').value;
      const serviceIdValue = serviceEl.value === 'custom' ? '' : serviceEl.value;
      const serviceSelectionUnchanged = Boolean(existing && serviceEl.value === initialServiceValue && serviceIdValue === (existing.serviceId || ''));
      const serviceName = serviceSelectionUnchanged
        ? existing.serviceName
        : (serviceIdValue ? getService(serviceIdValue)?.name : document.getElementById('customService').value.trim());
      const billingType = billingEl.value === 'fixed' ? 'fixed' : 'hourly';
      const rateRaw = rateEl.value;
      const rate = Number(rateRaw);
      const mileageMode = mileageModeEl.value;
      const mileage = readMileageForm();
      const mileageRateRaw = mileageMode === 'manual' ? document.getElementById('mileageRateManual').value : mileageMode === 'odometer' ? document.getElementById('mileageRateOdometer').value : '';
      const mileageMilesRaw = mileageMode === 'manual' ? document.getElementById('mileageMiles').value : '';
      const mileageStartRaw = mileageMode === 'odometer' ? document.getElementById('mileageStart').value : '';
      const mileageEndRaw = mileageMode === 'odometer' ? document.getElementById('mileageEnd').value : '';
      const notes = document.getElementById('blockNotes').value.trim();
      const status = linkedInvoice ? existingStatus : document.getElementById('blockStatus').value;
      const error = document.getElementById('blockError');
      error.classList.remove('show');

      if (!clientIdValue || !dateValue || !start || !end || !serviceName || rateRaw === '' || !Number.isFinite(rate) || rate < 0) {
        error.textContent = 'Client, date, start/end time, service, and a valid billing amount are required.';
        error.classList.add('show'); return;
      }
      if (timeToMinutes(end) === timeToMinutes(start)) {
        error.textContent = 'Start and end time cannot be the same. For an overnight shift, choose an end time earlier than the start time.'; error.classList.add('show'); return;
      }
      if (mileageMode === 'manual' && (mileageMilesRaw === '' || mileageRateRaw === '' || !Number.isFinite(Number(mileageMilesRaw)) || Number(mileageMilesRaw) < 0 || !Number.isFinite(Number(mileageRateRaw)) || Number(mileageRateRaw) < 0)) {
        error.textContent = 'Enter valid miles and a valid rate per mile, or choose No mileage.'; error.classList.add('show'); return;
      }
      if (mileageMode === 'odometer' && (mileageStartRaw === '' || mileageEndRaw === '' || mileageRateRaw === '' || !Number.isFinite(Number(mileageStartRaw)) || !Number.isFinite(Number(mileageEndRaw)) || Number(mileageStartRaw) < 0 || Number(mileageEndRaw) < Number(mileageStartRaw) || !Number.isFinite(Number(mileageRateRaw)) || Number(mileageRateRaw) < 0)) {
        error.textContent = 'Starting mileage, ending mileage, and rate per mile must be valid. Ending mileage cannot be lower than starting mileage.'; error.classList.add('show'); return;
      }
      const conflict = state.entries.find(e => e.id !== existing?.id && e.clientId === clientIdValue && overlaps(dateValue, start, end, e.date, e.start, e.end));
      if (conflict) {
        error.textContent = `This overlaps the existing ${shiftTimeLabel(conflict.date, conflict.start, conflict.end, true)} block for this client.`;
        error.classList.add('show'); return;
      }

      const payload = {
        id: existing?.id || id(),
        clientId: clientIdValue,
        date: dateValue,
        start,
        end,
        serviceId: serviceIdValue,
        serviceName,
        billingType,
        rate,
        mileageMode: ['manual','odometer'].includes(mileageMode) ? mileageMode : 'none',
        mileageStart: mileageMode === 'odometer' ? Number(mileageStartRaw) : null,
        mileageEnd: mileageMode === 'odometer' ? Number(mileageEndRaw) : null,
        mileageMiles: mileageMode === 'manual' ? Number(mileageMilesRaw) : 0,
        mileageRate: mileageMode === 'none' ? 0 : Number(mileageRateRaw),
        status: ['unbilled','invoiced','paid'].includes(status) ? status : 'unbilled',
        notes,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (existing) Object.assign(existing, payload); else state.entries.push(payload);
      ui.selectedClientId = clientIdValue;
      ui.selectedDate = dateValue;
      await persist(); closeModal(true); toast(existing ? 'Work block updated' : 'Work block saved'); render();
    };
  }

  function addDaysISO(iso, days) {
    const [y,m,d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return localISO(date);
  }

  function suggestedInvoiceNumber() {
    const prefix = String(state.settings.invoicePrefix || 'INV').trim().toUpperCase() || 'INV';
    return `${prefix}-${String(state.settings.nextInvoiceNumber || 1).padStart(4, '0')}`;
  }

  function openInvoiceModal() {
    const client = ui.exportClientId === 'all' ? null : getClient(ui.exportClientId);
    const list = invoiceCandidateEntries();
    if (!client || !list.length) return;
    if (!String(state.settings.businessName || '').trim()) { openSettingsModal(); return; }
    const baseTotals = totals(list);
    const issueDate = todayISO();
    const dueDate = addDaysISO(issueDate, 14);
    const suggested = suggestedInvoiceNumber();
    const defaultTax = Number(state.settings.defaultTaxRate || 0);

    openModal('Create invoice', `
      <div class="invoice-modal-summary">
        <strong>${esc(client.name)}</strong>
        <span>${list.length} unbilled blocks · ${hours(baseTotals.hours)} hrs${baseTotals.mileageMiles ? ` · ${hours(baseTotals.mileageMiles)} mi` : ''} · ${money(baseTotals.amount)}</span>
      </div>
      <div class="control-grid">
        <div class="field"><label for="invoiceNumber">Invoice number</label><input id="invoiceNumber" value="${esc(suggested)}" /></div>
        <div class="field"><label for="invoiceTax">Tax rate (%)</label><input id="invoiceTax" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(defaultTax)}" /></div>
        <div class="field"><label for="invoiceIssue">Issue date</label><input id="invoiceIssue" type="date" value="${esc(issueDate)}" /></div>
        <div class="field"><label for="invoiceDue">Due date</label><input id="invoiceDue" type="date" value="${esc(dueDate)}" /></div>
        <div class="field full"><label for="invoiceNotes">Invoice notes <span class="optional">optional</span></label><textarea id="invoiceNotes" placeholder="Payment terms, thank-you note, or other invoice note"></textarea></div>
      </div>
      <div class="invoice-calc">
        <div><span>Subtotal</span><strong>${money(baseTotals.amount)}</strong></div>
        <div><span id="invoiceTaxLabel">Tax (${defaultTax}%)</span><strong id="invoiceTaxAmount">${money(baseTotals.amount * defaultTax / 100)}</strong></div>
        <div class="invoice-calc-total"><span>Total</span><strong id="invoiceTotal">${money(baseTotals.amount * (1 + defaultTax / 100))}</strong></div>
      </div>
      <div class="form-error" id="invoiceError"></div>
      <div class="modal-actions"><button class="btn secondary" id="cancelInvoice" type="button">Cancel</button><button class="btn primary" id="saveInvoice" type="button">Create invoice</button></div>
    `);

    const taxEl = document.getElementById('invoiceTax');
    const updateInvoicePreview = () => {
      const taxRate = Math.max(0, Number(taxEl.value || 0));
      const taxAmount = baseTotals.amount * taxRate / 100;
      document.getElementById('invoiceTaxLabel').textContent = `Tax (${taxRate.toFixed(2).replace(/\.00$/, '')}%)`;
      document.getElementById('invoiceTaxAmount').textContent = money(taxAmount);
      document.getElementById('invoiceTotal').textContent = money(baseTotals.amount + taxAmount);
    };
    taxEl.addEventListener('input', updateInvoicePreview);
    document.getElementById('cancelInvoice').onclick = closeModal;
    document.getElementById('saveInvoice').onclick = async () => {
      const number = document.getElementById('invoiceNumber').value.trim();
      const issue = document.getElementById('invoiceIssue').value;
      const due = document.getElementById('invoiceDue').value;
      const taxRaw = document.getElementById('invoiceTax').value;
      const taxRate = Number(taxRaw);
      const notes = document.getElementById('invoiceNotes').value.trim();
      const error = document.getElementById('invoiceError');
      error.classList.remove('show');
      if (!number || !issue || !due || !Number.isFinite(taxRate) || taxRate < 0) {
        error.textContent = 'Invoice number, issue/due dates, and a valid tax rate are required.'; error.classList.add('show'); return;
      }
      if (due < issue) {
        error.textContent = 'Due date cannot be earlier than the issue date.'; error.classList.add('show'); return;
      }
      if (state.invoices.some(inv => String(inv.number).toLowerCase() === number.toLowerCase())) {
        error.textContent = 'That invoice number is already in use.'; error.classList.add('show'); return;
      }

      const freshList = invoiceCandidateEntries();
      if (!freshList.length) {
        error.textContent = 'There is no longer any unbilled work in this period.'; error.classList.add('show'); return;
      }
      const subtotal = totals(freshList).amount;
      const taxAmount = subtotal * taxRate / 100;
      const invoice = {
        id: id(),
        number,
        clientId: client.id,
        clientSnapshot: { name: client.name, email: client.email || '', billingAddress: client.billingAddress || '', details: client.details || '' },
        businessSnapshot: {
          name: state.settings.businessName || '',
          email: state.settings.businessEmail || '',
          phone: state.settings.businessPhone || '',
          address: state.settings.businessAddress || ''
        },
        issueDate: issue,
        dueDate: due,
        taxRate,
        subtotal: Number(subtotal.toFixed(2)),
        taxAmount: Number(taxAmount.toFixed(2)),
        total: Number((subtotal + taxAmount).toFixed(2)),
        currency: currencyCode(),
        notes,
        status: 'issued',
        entryIds: freshList.map(e => e.id),
        lines: freshList.map(e => {
          const x = calcEntry(e);
          return {
            entryId: e.id,
            date: e.date,
            endDate: shiftEndDate(e.date, e.start, e.end),
            start: e.start,
            end: e.end,
            serviceName: e.serviceName || '',
            billingType: e.billingType || 'hourly',
            hours: Number(x.hrs.toFixed(4)),
            rate: Number(e.rate || 0),
            serviceAmount: Number(x.serviceAmount.toFixed(2)),
            mileageMode: x.mileage.mode,
            mileageStart: x.mileage.mode === 'odometer' ? Number(e.mileageStart) : null,
            mileageEnd: x.mileage.mode === 'odometer' ? Number(e.mileageEnd) : null,
            mileageMiles: Number(x.mileage.miles.toFixed(4)),
            mileageRate: Number(x.mileage.rate.toFixed(4)),
            mileageAmount: Number(x.mileage.amount.toFixed(2)),
            amount: Number(x.amount.toFixed(2)),
            notes: e.notes || ''
          };
        }),
        createdAt: new Date().toISOString()
      };
      freshList.forEach(e => { e.status = 'invoiced'; e.updatedAt = new Date().toISOString(); });
      state.invoices.push(invoice);
      state.settings.nextInvoiceNumber = Math.max(1, Number(state.settings.nextInvoiceNumber || 1) + 1);
      await persist();
      closeModal(true);
      toast(`${number} created`);
      renderExport();
    };
  }

  function printInvoice(invoiceId) {
    const inv = state.invoices.find(x => x.id === invoiceId);
    if (!inv) return;
    const client = inv.clientSnapshot || {};
    const business = inv.businessSnapshot || {};
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const win = window.open('', '_blank');
    if (!win) { alert('Invox could not open the invoice preview. Allow pop-ups for this site and try again.'); return; }
    const lineRows = lines.map(line => {
      const inferredEndDate = line.endDate || shiftEndDate(line.date, line.start, line.end);
      const dateText = inferredEndDate !== line.date ? `${line.date} → ${inferredEndDate}` : line.date;
      const time = line.start && line.end ? `${displayTime(line.start)}–${displayTime(line.end)}${inferredEndDate !== line.date ? ' (next day)' : ''}` : '';
      const billing = line.billingType === 'fixed' ? `${moneyIn(line.rate, inv.currency)} fixed` : `${hours(line.hours)} hrs × ${moneyIn(line.rate, inv.currency)}`;
      const mileageMiles = Math.max(0, Number(line.mileageMiles || 0));
      const mileageRate = Math.max(0, Number(line.mileageRate || 0));
      const mileageAmount = Number.isFinite(Number(line.mileageAmount)) ? Number(line.mileageAmount) : mileageMiles * mileageRate;
      const mileage = mileageMiles > 0 ? `<div class="muted mileage-line">Mileage: ${esc(hours(mileageMiles))} mi × ${esc(moneyIn(mileageRate, inv.currency))} = ${esc(moneyIn(mileageAmount, inv.currency))}</div>` : '';
      return `<tr><td>${esc(dateText)}<div class="muted">${esc(time)}</div></td><td><strong>${esc(line.serviceName)}</strong>${line.notes ? `<div class="muted notes">${esc(line.notes)}</div>` : ''}</td><td>${esc(billing)}${mileage}</td><td class="num">${esc(moneyIn(line.amount, inv.currency))}</td></tr>`;
    }).join('');
    const invoiceMileageAmount = lines.reduce((sum, line) => {
      if (Number.isFinite(Number(line.mileageAmount))) return sum + Number(line.mileageAmount);
      return sum + Math.max(0, Number(line.mileageMiles || 0)) * Math.max(0, Number(line.mileageRate || 0));
    }, 0);
    const invoiceServiceAmount = Math.max(0, Number(inv.subtotal || 0) - invoiceMileageAmount);
    const mileageSummary = invoiceMileageAmount > 0 ? `<div class="sum"><span>Services</span><strong>${esc(moneyIn(invoiceServiceAmount, inv.currency))}</strong></div><div class="sum"><span>Mileage</span><strong>${esc(moneyIn(invoiceMileageAmount, inv.currency))}</strong></div>` : '';
    const taxRow = Number(inv.taxAmount || 0) ? `<div class="sum"><span>Tax (${Number(inv.taxRate || 0).toFixed(2).replace(/\.00$/,'')}%)</span><strong>${esc(moneyIn(inv.taxAmount, inv.currency))}</strong></div>` : '';
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)} — Invox</title><style>
      *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#17232e;margin:0;background:#fff} .page{max-width:850px;margin:0 auto;padding:48px} .top{display:flex;justify-content:space-between;gap:30px;border-bottom:3px solid #173a5e;padding-bottom:26px}.brand{font-size:30px;font-weight:800;color:#173a5e}.invoice-title{text-align:right}.invoice-title h1{margin:0;font-size:28px}.muted{color:#687785;font-size:12px;line-height:1.4}.parties{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin:30px 0}.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#687785;font-weight:800;margin-bottom:8px}.party strong{font-size:16px}.pre{white-space:pre-line;margin-top:4px;font-size:13px}.meta{display:grid;grid-template-columns:auto auto;gap:5px 18px;justify-content:end;margin-top:10px;font-size:13px}.meta span:nth-child(odd){color:#687785}table{width:100%;border-collapse:collapse;margin-top:22px;font-size:13px}th{text-align:left;background:#f3f5f7;padding:10px;border-bottom:1px solid #ccd5dd}td{vertical-align:top;padding:12px 10px;border-bottom:1px solid #e1e6ea}.num{text-align:right;white-space:nowrap}.notes{margin-top:4px;max-width:360px}.mileage-line{margin-top:4px;color:#42596b}.totals{width:330px;margin:24px 0 0 auto}.sum{display:flex;justify-content:space-between;padding:7px 0}.sum.total{border-top:2px solid #173a5e;margin-top:5px;padding-top:12px;font-size:18px}.invoice-note{margin-top:34px;padding:16px;background:#f7f9fa;border-radius:8px;white-space:pre-line;font-size:13px}.status{display:inline-block;margin-top:12px;border:1px solid #c8d2da;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;text-transform:uppercase}.footer{margin-top:42px;color:#8a96a0;font-size:11px;text-align:center}@media print{.page{padding:18mm}.no-print{display:none}}@media(max-width:650px){.page{padding:24px}.top,.parties{display:block}.invoice-title{text-align:left;margin-top:24px}.meta{justify-content:start}.parties .party+ .party{margin-top:24px}table{font-size:11px}.totals{width:100%}}
    </style></head><body><div class="page">
      <div class="top"><div><div class="brand">${esc(business.name || 'Invox')}</div><div class="pre muted">${esc(business.address || '')}</div><div class="muted">${esc([business.email,business.phone].filter(Boolean).join(' · '))}</div></div><div class="invoice-title"><h1>Invoice</h1><div class="status">${inv.status === 'paid' ? 'Paid' : 'Issued'}</div><div class="meta"><span>Invoice</span><strong>${esc(inv.number)}</strong><span>Issued</span><strong>${esc(inv.issueDate)}</strong><span>Due</span><strong>${esc(inv.dueDate)}</strong></div></div></div>
      <div class="parties"><div class="party"><div class="label">Bill to</div><strong>${esc(client.name || '')}</strong><div class="pre">${esc(client.billingAddress || '')}</div><div class="muted">${esc(client.email || '')}</div></div><div></div></div>
      <table><thead><tr><th>Date / Time</th><th>Service</th><th>Billing</th><th class="num">Amount</th></tr></thead><tbody>${lineRows}</tbody></table>
      <div class="totals">${mileageSummary}<div class="sum"><span>Subtotal</span><strong>${esc(moneyIn(inv.subtotal, inv.currency))}</strong></div>${taxRow}<div class="sum total"><span>Total</span><strong>${esc(moneyIn(inv.total, inv.currency))}</strong></div></div>
      ${inv.notes ? `<div class="invoice-note"><div class="label">Notes</div>${esc(inv.notes)}</div>` : ''}
      <div class="footer">Created with Invox</div>
    </div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
    win.document.close();
  }

  async function markInvoicePaid(invoiceId) {
    const inv = state.invoices.find(x => x.id === invoiceId);
    if (!inv || inv.status === 'paid') return;
    inv.status = 'paid';
    inv.paidAt = new Date().toISOString();
    (inv.entryIds || []).forEach(entryId => {
      const entry = state.entries.find(e => e.id === entryId);
      if (entry) { entry.status = 'paid'; entry.updatedAt = new Date().toISOString(); }
    });
    await persist();
    toast(`${inv.number} marked paid`);
    renderExport();
  }

  function openSettingsModal() {
    const x = state.settings;
    openModal('Business settings', `
      <div class="control-grid">
        <div class="field full"><label for="businessName">Business / provider name</label><input id="businessName" value="${esc(x.businessName || '')}" placeholder="Your business or professional name" /></div>
        <div class="field"><label for="businessEmail">Email <span class="optional">optional</span></label><input id="businessEmail" type="email" value="${esc(x.businessEmail || '')}" /></div>
        <div class="field"><label for="businessPhone">Phone <span class="optional">optional</span></label><input id="businessPhone" type="tel" value="${esc(x.businessPhone || '')}" /></div>
        <div class="field full"><label for="businessAddress">Business address <span class="optional">optional</span></label><textarea id="businessAddress" placeholder="Address displayed on invoices">${esc(x.businessAddress || '')}</textarea></div>
        <div class="field"><label for="businessCurrency">Currency</label><select id="businessCurrency">${['USD','EUR','GBP','CAD','AUD','CHF','SEK','NOK','DKK'].map(c => `<option value="${c}" ${currencyCode() === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="businessTax">Default tax rate (%)</label><input id="businessTax" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(x.defaultTaxRate ?? 0)}" /></div>
        <div class="field"><label for="businessMileageRate">Default mileage rate / mile</label><input id="businessMileageRate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(x.defaultMileageRate ?? 0)}" /></div>
        <div class="field"><label for="invoicePrefix">Invoice prefix</label><input id="invoicePrefix" maxlength="10" value="${esc(x.invoicePrefix || 'INV')}" /></div>
        <div class="field"><label for="invoiceNext">Next invoice number</label><input id="invoiceNext" type="number" min="1" step="1" inputmode="numeric" value="${esc(x.nextInvoiceNumber || 1)}" /></div>
      </div>
      <div class="warning" style="margin-top:12px">Changing currency changes how existing work logs are displayed; Invox does not perform currency conversion. Saved invoices retain the currency they were created in.</div>
      <div class="form-error" id="settingsError"></div>
      <div class="modal-actions"><button class="btn secondary" id="cancelSettings" type="button">Cancel</button><button class="btn primary" id="saveSettings" type="button">Save settings</button></div>
    `);
    document.getElementById('cancelSettings').onclick = closeModal;
    document.getElementById('saveSettings').onclick = async () => {
      const businessName = document.getElementById('businessName').value.trim();
      const defaultTaxRate = Number(document.getElementById('businessTax').value);
      const defaultMileageRate = Number(document.getElementById('businessMileageRate').value);
      const nextInvoiceNumber = parseInt(document.getElementById('invoiceNext').value, 10);
      const invoicePrefix = document.getElementById('invoicePrefix').value.trim().toUpperCase().replace(/[^A-Z0-9-]/g,'');
      const error = document.getElementById('settingsError');
      if (!businessName || !Number.isFinite(defaultTaxRate) || defaultTaxRate < 0 || !Number.isFinite(defaultMileageRate) || defaultMileageRate < 0 || !Number.isInteger(nextInvoiceNumber) || nextInvoiceNumber < 1 || !invoicePrefix) {
        error.textContent = 'Business name, tax rate, mileage rate, invoice prefix, and next invoice number must be valid.'; error.classList.add('show'); return;
      }
      state.settings = {
        ...state.settings,
        businessName,
        businessEmail: document.getElementById('businessEmail').value.trim(),
        businessPhone: document.getElementById('businessPhone').value.trim(),
        businessAddress: document.getElementById('businessAddress').value.trim(),
        currency: document.getElementById('businessCurrency').value,
        defaultTaxRate,
        defaultMileageRate,
        invoicePrefix,
        nextInvoiceNumber
      };
      await persist(); closeModal(true); toast('Business settings saved'); render();
    };
  }

  function saveBackup() {
    const payload = {
      app: 'Invox',
      backupVersion: 3,
      exportedAt: new Date().toISOString(),
      data: state
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `invox-backup-${todayISO()}.json`);
    toast('Backup created');
  }

  async function restoreBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const data = parsed.data || parsed;
      if (!data || !Array.isArray(data.clients) || !Array.isArray(data.services) || !Array.isArray(data.entries)) throw new Error('Invalid backup');
      if (!confirm(`Restore this backup? It contains ${data.clients.length} clients, ${data.entries.length} work blocks, and ${Array.isArray(data.invoices) ? data.invoices.length : 0} invoices and will replace the data currently on this device.`)) return;
      state = normalizeState(data);
      ui.selectedClientId = state.clients[0]?.id || '';
      ui.clientDetailId = '';
      await persist();
      toast('Backup restored');
      render();
    } catch (err) {
      alert('That file is not a valid Invox backup.');
    } finally {
      event.target.value = '';
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Minimal dependency-free XLSX writer (ZIP Store + SpreadsheetML) ----
  const te = new TextEncoder();

  function xmlEsc(s) {
    return String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
  }

  function colName(index) {
    let n = index + 1, out = '';
    while (n) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out;
  }

  function cellXML(value, r, c) {
    const ref = `${colName(c)}${r + 1}`;
    const style = r === 0 ? ' s="1"' : '';
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style} t="n"><v>${value}</v></c>`;
    const str = xmlEsc(value == null ? '' : value);
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${str}</t></is></c>`;
  }

  function worksheetXML(rows, widths = []) {
    const colXml = widths.length ? `<cols>${widths.map((w,i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const rowXml = rows.map((row, r) => `<row r="${r+1}">${row.map((v,c) => cellXML(v,r,c)).join('')}</row>`).join('');
    const maxCol = colName(Math.max(0, (rows[0]?.length || 1) - 1));
    const maxRow = Math.max(1, rows.length);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${colXml}<sheetData>${rowXml}</sheetData><autoFilter ref="A1:${maxCol}${maxRow}"/></worksheet>`;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function push16(arr, n) { arr.push(n & 255, (n >>> 8) & 255); }
  function push32(arr, n) { arr.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255); }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { dosTime, dosDate };
  }

  function makeZip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const { dosTime, dosDate } = dosDateTime();

    files.forEach(file => {
      const name = te.encode(file.name);
      const data = typeof file.data === 'string' ? te.encode(file.data) : file.data;
      const crc = crc32(data);
      const local = [];
      push32(local, 0x04034b50); push16(local, 20); push16(local, 0x0800); push16(local, 0);
      push16(local, dosTime); push16(local, dosDate); push32(local, crc); push32(local, data.length); push32(local, data.length);
      push16(local, name.length); push16(local, 0);
      const localBytes = new Uint8Array([...local, ...name]);
      chunks.push(localBytes, data);

      const cd = [];
      push32(cd, 0x02014b50); push16(cd, 20); push16(cd, 20); push16(cd, 0x0800); push16(cd, 0);
      push16(cd, dosTime); push16(cd, dosDate); push32(cd, crc); push32(cd, data.length); push32(cd, data.length);
      push16(cd, name.length); push16(cd, 0); push16(cd, 0); push16(cd, 0); push16(cd, 0); push32(cd, 0); push32(cd, offset);
      central.push(new Uint8Array([...cd, ...name]));
      offset += localBytes.length + data.length;
    });

    const centralSize = central.reduce((n, x) => n + x.length, 0);
    const end = [];
    push32(end, 0x06054b50); push16(end, 0); push16(end, 0); push16(end, files.length); push16(end, files.length);
    push32(end, centralSize); push32(end, offset); push16(end, 0);
    return new Blob([...chunks, ...central, new Uint8Array(end)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function buildXLSX(sheets) {
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xmlEsc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="2"><font><sz val="11"/><name val="Aptos"/><family val="2"/></font><font><b/><sz val="11"/><name val="Aptos"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;

    const files = [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
      { name: 'xl/styles.xml', data: styles }
    ];
    sheets.forEach((s,i) => files.push({ name: `xl/worksheets/sheet${i+1}.xml`, data: worksheetXML(s.rows, s.widths) }));
    return makeZip(files);
  }

  function exportXLSX() {
    const list = exportEntries();
    if (!list.length) return;
    const invoiceForEntry = entryId => state.invoices.find(inv => Array.isArray(inv.entryIds) && inv.entryIds.includes(entryId));
    const detailRows = [['Client','Client Notes','Client Email','Start Date','End Date','Start','End','Service','Billing Method','Hours','Rate / Fixed Amount','Service Amount','Mileage Method','Starting Mileage','Ending Mileage','Miles','Rate / Mile','Mileage Amount','Total Amount','Status','Invoice','Block Notes']];
    list.forEach(e => {
      const c = getClient(e.clientId);
      const x = calcEntry(e);
      const inv = invoiceForEntry(e.id);
      detailRows.push([
        c?.name || '', c?.details || '', c?.email || '', e.date, shiftEndDate(e.date, e.start, e.end), displayTime(e.start), displayTime(e.end), e.serviceName || '',
        (e.billingType || 'hourly') === 'fixed' ? 'Fixed' : 'Hourly', Number(x.hrs.toFixed(4)), Number(e.rate), Number(x.serviceAmount.toFixed(2)),
        x.mileage.mode === 'odometer' ? 'Odometer' : x.mileage.mode === 'manual' ? 'Direct miles' : '',
        x.mileage.mode === 'odometer' ? Number(e.mileageStart) : '', x.mileage.mode === 'odometer' ? Number(e.mileageEnd) : '',
        x.mileage.miles ? Number(x.mileage.miles.toFixed(4)) : '', x.mileage.miles ? Number(x.mileage.rate.toFixed(4)) : '', x.mileage.miles ? Number(x.mileage.amount.toFixed(2)) : '',
        Number(x.amount.toFixed(2)), statusLabel(e.status), inv?.number || '', e.notes || ''
      ]);
    });

    const dailyMap = new Map();
    list.forEach(e => {
      const c = getClient(e.clientId);
      const key = `${e.clientId}|${e.date}`;
      const x = calcEntry(e);
      const cur = dailyMap.get(key) || { client: c?.name || '', date: e.date, hours: 0, serviceAmount: 0, mileageMiles: 0, mileageAmount: 0, amount: 0 };
      cur.hours += x.hrs; cur.serviceAmount += x.serviceAmount; cur.mileageMiles += x.mileage.miles; cur.mileageAmount += x.mileage.amount; cur.amount += x.amount; dailyMap.set(key, cur);
    });
    const dailyRows = [['Client','Date','Hours','Service Amount','Miles','Mileage Amount','Total Amount'], ...[...dailyMap.values()].sort((a,b)=>`${a.client}|${a.date}`.localeCompare(`${b.client}|${b.date}`)).map(x => [x.client, x.date, Number(x.hours.toFixed(4)), Number(x.serviceAmount.toFixed(2)), Number(x.mileageMiles.toFixed(4)), Number(x.mileageAmount.toFixed(2)), Number(x.amount.toFixed(2))])];

    const summaryMap = new Map();
    list.forEach(e => {
      const c = getClient(e.clientId);
      const key = `${e.clientId}|${e.serviceName}|${e.billingType || 'hourly'}`;
      const x = calcEntry(e);
      const cur = summaryMap.get(key) || { client: c?.name || '', service: e.serviceName || '', billingType: e.billingType || 'hourly', hours: 0, serviceAmount: 0, mileageMiles: 0, mileageAmount: 0, amount: 0 };
      cur.hours += x.hrs; cur.serviceAmount += x.serviceAmount; cur.mileageMiles += x.mileage.miles; cur.mileageAmount += x.mileage.amount; cur.amount += x.amount; summaryMap.set(key, cur);
    });
    const summaryRows = [['Client','Service','Billing Method','Hours','Service Amount','Miles','Mileage Amount','Total Amount'], ...[...summaryMap.values()].sort((a,b)=>`${a.client}|${a.service}`.localeCompare(`${b.client}|${b.service}`)).map(x => [x.client, x.service, x.billingType === 'fixed' ? 'Fixed' : 'Hourly', Number(x.hours.toFixed(4)), Number(x.serviceAmount.toFixed(2)), Number(x.mileageMiles.toFixed(4)), Number(x.mileageAmount.toFixed(2)), Number(x.amount.toFixed(2))])];

    const invoiceList = state.invoices.filter(inv => {
      const clientMatch = ui.exportClientId === 'all' || inv.clientId === ui.exportClientId;
      return clientMatch && (inv.issueDate || '') >= ui.exportStart && (inv.issueDate || '') <= ui.exportEnd;
    }).sort((a,b) => (a.issueDate || '').localeCompare(b.issueDate || ''));
    const invoiceRows = [['Invoice','Client','Issue Date','Due Date','Status','Currency','Service Amount','Miles','Mileage Amount','Subtotal','Tax Rate %','Tax','Total','Notes'], ...invoiceList.map(inv => {
      const lineList = Array.isArray(inv.lines) ? inv.lines : [];
      const serviceAmount = lineList.reduce((sum, line) => {
        if (Number.isFinite(Number(line.serviceAmount))) return sum + Number(line.serviceAmount);
        const mileageAmount = Number.isFinite(Number(line.mileageAmount)) ? Number(line.mileageAmount) : Number(line.mileageMiles || 0) * Number(line.mileageRate || 0);
        return sum + Math.max(0, Number(line.amount || 0) - mileageAmount);
      }, 0);
      const mileageMiles = lineList.reduce((sum, line) => sum + Math.max(0, Number(line.mileageMiles || 0)), 0);
      const mileageAmount = lineList.reduce((sum, line) => sum + (Number.isFinite(Number(line.mileageAmount)) ? Number(line.mileageAmount) : Math.max(0, Number(line.mileageMiles || 0)) * Math.max(0, Number(line.mileageRate || 0))), 0);
      return [
        inv.number || '', getClient(inv.clientId)?.name || inv.clientSnapshot?.name || '', inv.issueDate || '', inv.dueDate || '', inv.status === 'paid' ? 'Paid' : 'Issued', inv.currency || currencyCode(),
        Number(serviceAmount.toFixed(2)), Number(mileageMiles.toFixed(4)), Number(mileageAmount.toFixed(2)), Number(inv.subtotal || 0), Number(inv.taxRate || 0), Number(inv.taxAmount || 0), Number(inv.total || 0), inv.notes || ''
      ];
    })];

    const blob = buildXLSX([
      { name: 'Invox Work Log', rows: detailRows, widths: [20,32,26,13,13,12,12,24,16,10,18,16,16,16,16,10,14,16,16,12,16,48] },
      { name: 'Invox Daily Totals', rows: dailyRows, widths: [20,13,12,16,10,16,16] },
      { name: 'Invox Summary', rows: summaryRows, widths: [20,24,16,12,16,10,16,16] },
      { name: 'Invox Invoices', rows: invoiceRows, widths: [16,20,13,13,12,10,16,10,16,14,12,14,14,42] }
    ]);
    const clientPart = ui.exportClientId === 'all' ? 'all-clients' : (getClient(ui.exportClientId)?.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    downloadBlob(blob, `invox-${clientPart}-${ui.exportStart}-to-${ui.exportEnd}.xlsx`);
    toast('Excel file created');
  }

  headerAction.addEventListener('click', () => {
    if (ui.view === 'time') openBlockModal();
    else if (ui.view === 'clients') openClientModal();
    else if (ui.view === 'rates') openServiceModal();
  });

  navButtons.forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

  async function ensurePersistentStorage() {
    try {
      if (!navigator.storage?.persisted) return;
      let granted = await navigator.storage.persisted();
      if (!granted && navigator.storage.persist) granted = await navigator.storage.persist();
      ui.storagePersistent = Boolean(granted);
    } catch (_) {
      ui.storagePersistent = false;
    }
  }

  async function init() {
    try {
      db = await openDB();
      const saved = await dbGet(STATE_KEY);
      if (saved && Array.isArray(saved.clients) && Array.isArray(saved.services) && Array.isArray(saved.entries)) state = normalizeState(saved);
      else state = normalizeState(state);
      ui.selectedClientId = state.clients[0]?.id || '';
      await ensurePersistentStorage();
      render();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
    } catch (err) {
      appEl.innerHTML = `<div class="card pad"><div class="warning"><strong>Storage unavailable.</strong> This browser is not allowing the local database needed to save records.</div></div>`;
      console.error(err);
    }
  }

  init();
})();
