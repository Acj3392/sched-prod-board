import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4
const SEVERITIES = new Set(['sev1', 'sev2', 'sev3', 'sev4']);

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');

// R5: viewer's local zone and the locale's own day/month order (en-GB, de, fr: day first).
const fmt = new Intl.DateTimeFormat(navigator.languages?.[0] || navigator.language, {
  dateStyle: 'short',
  timeStyle: 'short',
});

const acked = new Map(); // id -> ackedAt, kept across refreshes
const rows = new Map(); // id -> <li>, so a refresh never replaces a row under a click

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function makeRow(i) {
  const li = document.createElement('li');
  li.dataset.testid = 'incident-row';
  li.dataset.id = i.id;
  li.className = `row ${SEVERITIES.has(i.severity) ? i.severity : "sev-unknown"}`;
  li.innerHTML = `<span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(fmt.format(new Date(i.openedAt)))}</time>
    <span class="act"></span>`;
  setAction(li, i.id);
  return li;
}

function updateRow(li, i) {
  const t = li.querySelector('time');
  if (t.getAttribute('datetime') !== i.openedAt) {
    t.setAttribute('datetime', i.openedAt);
    t.title = i.openedAt;
    t.textContent = fmt.format(new Date(i.openedAt));
  }
  li.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
}

function setAction(li, id) {
  const slot = li.querySelector('.act');
  if (acked.has(id)) {
    slot.innerHTML = `<span data-testid="acked" class="acked">Acked</span>`;
    li.classList.add('is-acked');
    return;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.testid = 'ack';
  btn.textContent = 'Ack';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Acking…';
    try {
      const reply = await ack(id); // R2: the row's own id, never its position
      acked.set(id, reply.ackedAt);
      setAction(li, id);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = 'Retry ack';
    }
  });
  slot.replaceChildren(btn);
}

// Product's decision (after SCHED-4511): the list holds still while it is on screen. New incidents wait
// behind a "N new" bar and come in only when on-call clicks it. Rows are never removed or moved by a refresh.
const pending = new Map(); // id -> incident, arrived but not shown yet
const bar = document.querySelector('[data-testid="new-bar"]');
let first = true;

const newestFirst = (a, b) => b.openedAt.localeCompare(a.openedAt);

function insertAtTop(incidents) {
  const fresh = [...incidents].sort(newestFirst).map((i) => {
    const li = makeRow(i);
    rows.set(i.id, li);
    return li;
  });
  list.prepend(...fresh);
}

function showBar() {
  const n = pending.size;
  bar.hidden = n === 0;
  bar.textContent = n === 1 ? '1 new incident' : `${n} new incidents`;
}

function render(incidents) {
  if (first || rows.size === 0) {
    insertAtTop(incidents); // R1: newest first on open; an empty board has nothing to move
    first = false;
  } else {
    for (const i of incidents) {
      const li = rows.get(i.id);
      if (li) updateRow(li, i); // same node, same place
      else pending.set(i.id, i); // waits behind the bar
    }
  }
  showBar();
  loader.hidden = true; // R3
  empty.hidden = rows.size > 0;
  list.hidden = rows.size === 0;
}

bar.addEventListener('click', () => {
  insertAtTop([...pending.values()]);
  pending.clear();
  showBar();
  empty.hidden = rows.size > 0;
  list.hidden = rows.size === 0;
});

async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
  } catch (err) {
    console.error(err);
  } finally {
    setTimeout(refresh, REFRESH_MS); // R4
  }
}

refresh();
