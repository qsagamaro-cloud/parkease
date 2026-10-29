const ADMIN_PASSCODE = 'Admin';
const SESSION_KEY = 'parkease_admin';

let unlocked = sessionStorage.getItem(SESSION_KEY) === '1';

/* ---------- Inject CSS Styles ---------- */
const style = document.createElement('style');
style.textContent = `
.pe-overlay{position:fixed;inset:0;background:rgba(23,36,30,.55);display:none;align-items:center;justify-content:center;z-index:100;padding:20px}
.pe-overlay.show{display:flex}
.pe-modal{background:var(--paper);border-radius:8px;padding:28px 26px;width:100%;max-width:360px;text-align:center;border-top:4px solid var(--gold);box-shadow:0 12px 40px rgba(0,0,0,.25)}
.pe-modal h2{font-family:'Fraunces',serif;font-weight:500;font-size:22px;margin:0 0 6px}
.pe-modal p{color:var(--muted);font-size:13.5px;margin:0 0 18px}
.pe-modal input{width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:4px;font-size:14px;margin-bottom:12px;font-family:'IBM Plex Mono',monospace}
.pe-row{display:flex;gap:10px}
.pe-modal button{flex:1;padding:11px 14px;border-radius:4px;font-weight:600;font-size:14px;cursor:pointer;border:1px solid var(--green-deep)}
.pe-go{background:var(--green-deep);color:#fff}
.pe-cancel{background:transparent;color:var(--green-deep)}
.pe-err{color:var(--occupied);font-size:12.5px;margin-top:10px;min-height:1em}
.pe-logout{background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:4px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;margin-top:8px}
.pe-logout:hover{border-color:var(--green-deep);color:var(--green-deep)}
`;
document.head.appendChild(style);

/* ---------- Wait for DOM to load safely ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const radioLive = document.getElementById('tab-live');
  const radioAdmin = document.getElementById('tab-admin');

  /* ---------- Live clock + date ---------- */
  const clockEl = document.getElementById('clock');
  const dateEl  = document.getElementById('date');

  function updateClock() {
    const now = new Date();
    if (clockEl) clockEl.textContent = now.toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (dateEl)  dateEl.textContent  = now.toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ---------- Login popup ---------- */
  const overlay = document.createElement('div');
  overlay.className = 'pe-overlay';
  overlay.innerHTML = `
  <div class="pe-modal" role="dialog" aria-modal="true" aria-labelledby="peTitle">
    <h2 id="peTitle">Admin sign-in</h2>
    <p>For security personnel and campus administration.</p>
    <input type="password" id="pePass" placeholder="Passcode" autocomplete="current-password">
    <div class="pe-row">
      <button type="button" class="pe-cancel" id="peCancel">Cancel</button>
      <button type="button" class="pe-go" id="peGo">Sign in</button>
    </div>
    <div class="pe-err" id="peErr" role="alert"></div>
  </div>`;
  document.body.appendChild(overlay);

  const passEl = document.getElementById('pePass');
  const errEl = document.getElementById('peErr');

  function openLogin() {
    errEl.textContent = '';
    passEl.value = '';
    overlay.classList.add('show');
    setTimeout(() => passEl.focus(), 0);
  }

  function closeLogin() {
    overlay.classList.remove('show');
  }

  function tryUnlock() {
    if (passEl.value === ADMIN_PASSCODE) {
      unlocked = true;
      sessionStorage.setItem(SESSION_KEY, '1');
      closeLogin();
      if (radioAdmin) radioAdmin.checked = true;
    } else {
      errEl.textContent = 'Incorrect passcode. Try again.';
    }
  }

  function lock() {
    unlocked = false;
    sessionStorage.removeItem(SESSION_KEY);
    if (radioLive) radioLive.checked = true;
  }

  document.getElementById('peGo').addEventListener('click', tryUnlock);
  document.getElementById('peCancel').addEventListener('click', closeLogin);
  passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLogin(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLogin(); });

  /* ---------- Guard the Admin tab ---------- */
  const adminLabel = document.querySelector('label[for="tab-admin"]');
  if (adminLabel) {
    adminLabel.addEventListener('click', (e) => {
      if (!unlocked) {
        e.preventDefault();
        openLogin();
      }
    });
  }

  if (radioAdmin) {
    radioAdmin.addEventListener('change', () => {
      if (radioAdmin.checked && !unlocked) {
        if (radioLive) radioLive.checked = true;
        openLogin();
      }
    });
  }

  /* ---------- Sign-out button inside the admin view ---------- */
  const synced = document.querySelector('#view-admin .synced');
  if (synced) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pe-logout';
    btn.textContent = 'Sign out';
    btn.addEventListener('click', lock);
    synced.appendChild(document.createElement('br'));
    synced.appendChild(btn);
  }

  /* ---------- Start on the public dashboard ---------- */
  if (!unlocked && radioLive) radioLive.checked = true;

  /* =========================================================
     DATABASE CONNECTION
     The page asks the server (GET /api/slots) for the data that is
     stored in parkease.db and redraws the screen every 3 seconds.
     ========================================================= */
  const POLL_MS = 1000;
  const OFFLINE_AFTER_MS = 15000;   // no sensor update for 15s = "Sensor Offline"
  const TOTAL_BAYS = 10;
  const LIVE_SLOTS = [1];           // bays that really have a sensor installed

  const logBody    = document.getElementById('logBody');
  const liveGrid   = document.getElementById('liveSlots');
  const adminGrid  = document.getElementById('adminSlots');
  const connDot    = document.getElementById('connDot');
  const connText   = document.getElementById('connText');
  const syncedLive = document.getElementById('syncedAgo');
  const syncedAdm  = document.getElementById('syncedAgoAdmin');
  const statAvail  = document.getElementById('statAvailable');
  const statOcc    = document.getElementById('statOccupied');
  const statNA     = document.getElementById('statNotAvailable');

  function esc(t) {
    const d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  // Work out what to show for one bay: 'available' | 'occupied' | 'offline'
  function bayState(id, data) {
    if (!LIVE_SLOTS.includes(id) || !data) return 'offline';
    const age = data.serverTime - data.lastUpdate;
    if (!data.lastUpdate || age > OFFLINE_AFTER_MS) return 'offline';
    return data.status;
  }

  const LABEL = { available: 'Available', occupied: 'Occupied', offline: 'Sensor Offline' };

  let currentLog = [];   // latest rows shown in the table (used by Print / Download)

  function render(slots, log, serverTime) {
    currentLog = log || [];
    let nAvail = 0, nOcc = 0;
    let liveHtml = '', adminHtml = '';

    for (let id = 1; id <= TOTAL_BAYS; id++) {
      const raw = slots && slots[id] ? Object.assign({ serverTime }, slots[id]) : null;
      const state = bayState(id, raw);
      if (state === 'available') nAvail++;
      if (state === 'occupied') nOcc++;

      let readout = 'Sensor Offline';
      if (state !== 'offline') {
        const secs = Math.max(0, Math.round((serverTime - raw.lastUpdate) / 1000));
        readout = `Sensor Online · ${raw.distance_cm != null ? raw.distance_cm + ' cm' : '—'} · ${secs}s ago`;
      }

      const num = String(id).padStart(2, '0');
      liveHtml += `
        <div class="slot-sign ${state === 'available' ? '' : state}">
          <div class="band"></div>
          <div class="body">
            <div class="slot-num">BAY ${num} · GATE 2</div>
            <div class="slot-letter">${id}</div>
            <div class="slot-status">${LABEL[state]}</div>
            <div class="readout"><span>${readout}</span></div>
          </div>
        </div>`;

      adminHtml += `<div class="mini-slot ${state === 'available' ? '' : state}"><span class="name">Bay ${id}</span><span class="tag">${state === 'offline' ? 'Not Available' : LABEL[state]}</span></div>`;
    }

    if (liveGrid) liveGrid.innerHTML = liveHtml;
    if (adminGrid) adminGrid.innerHTML = adminHtml;
    if (statAvail) statAvail.textContent = nAvail;
    if (statOcc) statOcc.textContent = nOcc;
    if (statNA) statNA.textContent = TOTAL_BAYS - nAvail - nOcc;

    // Activity log (newest first, comes from the "logs" table)
    if (logBody) {
      if (!log || log.length === 0) {
        logBody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);font-style:italic;">No activity yet.</td></tr>';
      } else {
        logBody.innerHTML = log.map(e => `
          <tr>
            <td>${new Date(e.timestamp).toLocaleTimeString('en-PH', { hour12: false })}</td>
            <td>Bay ${esc(e.slot)}</td>
            <td class="event-${esc(e.status)}">${esc(e.status)}</td>
            <td>${e.plate_number ? `<span class="plate-tag">${esc(e.plate_number)}</span>` : ''}</td>
          </tr>`).join('');
      }
    }
  }

  function setConnection(ok) {
    if (connDot) connDot.classList.toggle('on', ok);
    if (connText) connText.textContent = ok ? 'server connected' : 'server not connected';
    const t = ok ? 'just now' : 'unreachable';
    if (syncedLive) syncedLive.textContent = t;
    if (syncedAdm) syncedAdm.textContent = t;
  }

  async function loadData() {
    try {
      const res = await fetch('/api/slots', { cache: 'no-store' });
      if (!res.ok) throw new Error('Server returned ' + res.status);
      const data = await res.json();
      setConnection(true);
      render(data.slots, data.log, data.serverTime);
    } catch (err) {
      setConnection(false);
      render(null, null, Date.now());   // server unreachable: show every bay as offline
    }
  }

  loadData();
  setInterval(loadData, POLL_MS);

  /* ---------- Log Vehicle Entry (Plate Number) -> saved in the database ---------- */
  const logBtn = document.getElementById('logBtn');
  const plateInput = document.getElementById('plateInput');
  const baySelect = document.getElementById('baySelect');

  if (logBtn && plateInput && baySelect) {
    logBtn.addEventListener('click', async () => {
      const plate = plateInput.value.trim();
      const slot = parseInt(baySelect.value.replace(/\D/g, ''), 10);

      if (!plate) {
        alert('Please enter a plate number.');
        return;
      }

      try {
        const res = await fetch('/api/log-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot, plate_number: plate })
        });
        if (!res.ok) throw new Error('Server returned ' + res.status);
        plateInput.value = '';
        loadData();                       // reload so the new row comes from the database
      } catch (err) {
        alert('Could not save the entry. Is the server running?');
      }
    });

    plateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') logBtn.click();
    });
  }
  /* ---------- Print / Download the activity log (read-only: does not touch the database) ---------- */
  const printLogBtn = document.getElementById('printLogBtn');
  const downloadLogBtn = document.getElementById('downloadLogBtn');
  const printedAt = document.getElementById('printedAt');

  function stampPrintTime() {
    if (printedAt) printedAt.textContent = new Date().toLocaleString('en-PH');
  }
  window.addEventListener('beforeprint', stampPrintTime);

  if (printLogBtn) {
    printLogBtn.addEventListener('click', () => {
      if (!currentLog.length) { alert('There is no activity to print yet.'); return; }
      stampPrintTime();
      window.print();
    });
  }

  function csvCell(v) {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(t)) t = "'" + t;          // stop spreadsheet formula injection
    return '"' + t.replace(/"/g, '""') + '"';
  }

  if (downloadLogBtn) {
    downloadLogBtn.addEventListener('click', () => {
      if (!currentLog.length) { alert('There is no activity to download yet.'); return; }
      const rows = [['Date', 'Time', 'Slot', 'Event', 'Plate Number']];
      currentLog.forEach(e => {
        const d = new Date(e.timestamp);
        rows.push([
          d.toLocaleDateString('en-CA'),
          d.toLocaleTimeString('en-PH', { hour12: false }),
          'Bay ' + e.slot,
          e.status,
          e.plate_number || ''
        ]);
      });
      const csv = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'parkease-activity-log-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    });
  }
});
