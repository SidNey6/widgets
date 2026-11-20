import { h, iconEl, countLabel, safeUrl, normalize, newId } from './common.js';

/* ------------------------------------------------------------------ *
 * Konfiguration & Zustand
 * ------------------------------------------------------------------ */
const CFG_KEY = 'widgets.github';
const DRAFT_KEY = 'widgets.draft';

const state = {
  data: null,        // { title, children: [...] }
  sha: null,         // SHA der data.json auf GitHub (für Updates nötig)
  savedJson: '',     // zuletzt geladener/gespeicherter Stand, um "dirty" zu erkennen
  selectedId: 'root',
  expanded: new Set(['root']),
  busy: false,
};

function defaultConfig() {
  // Auf <owner>.github.io/<repo>/ lassen sich Besitzer und Repo aus der URL ableiten.
  let owner = 'SidNey6', repo = 'widgets';
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    owner = host.split('.')[0];
    const first = location.pathname.split('/').filter(Boolean)[0];
    repo = first && !first.endsWith('.html') ? first : host;
  }
  return { owner, repo, branch: 'main', path: 'data.json', token: '' };
}

function loadConfig() {
  try { return { ...defaultConfig(), ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch { return defaultConfig(); }
}
function storeConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
let config = loadConfig();

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const treeEl = $('tree');
const editorEl = $('editor');
const editorHead = $('editor-head');
const statusEl = $('status');
const statusText = $('status-text');
const saveBtn = $('btn-save');

/* ------------------------------------------------------------------ *
 * Hilfen
 * ------------------------------------------------------------------ */
function toast(msg, isError = false, ms = 3500) {
  const el = h('div', { class: 'toast' + (isError ? ' error' : ''), role: 'status' }, msg);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

const serialize = (data) => JSON.stringify(data, null, 2) + '\n';
const isDirty = () => state.data && serialize(state.data) !== state.savedJson;

/** Liefert {node, parent, index, ancestors} für eine ID. */
function find(id, node = state.data, ancestors = []) {
  if (id === 'root') return { node: state.data, parent: null, index: -1, ancestors: [] };
  const kids = node.children || [];
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c.id === id) return { node: c, parent: node, index: i, ancestors };
    if (c.type === 'widget') {
      const r = find(id, c, [...ancestors, node]);
      if (r) return r;
    }
  }
  return null;
}

function countDescendants(node) {
  let n = 0;
  for (const c of node.children || []) n += 1 + countDescendants(c);
  return n;
}

function allWidgets(node = state.data, depth = 0, out = []) {
  for (const c of node.children || []) {
    if (c.type === 'widget') { out.push({ node: c, depth }); allWidgets(c, depth + 1, out); }
  }
  return out;
}

function isDescendant(ancestor, id) {
  for (const c of ancestor.children || []) {
    if (c.id === id || (c.type === 'widget' && isDescendant(c, id))) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * GitHub API
 * ------------------------------------------------------------------ */
function apiUrl() {
  const { owner, repo, path } = config;
  const p = path.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${p}`;
}
function apiHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
async function apiError(res) {
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* ignore */ }
  if (res.status === 401) return 'Token ungültig oder abgelaufen.';
  if (res.status === 403) return 'Keine Berechtigung. Hat der Token „Contents: Read and write“ für dieses Repo?';
  if (res.status === 404) return `Repo, Branch oder Datei nicht gefunden (${config.owner}/${config.repo}@${config.branch}).`;
  return `GitHub-Fehler ${res.status}${msg ? ': ' + msg : ''}`;
}

/** Holt data.json von GitHub. Gibt {json, sha} zurück oder null, wenn die Datei noch nicht existiert. */
async function ghGet() {
  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(config.branch)}&t=${Date.now()}`, {
    headers: apiHeaders(), cache: 'no-store',
  });
  if (res.status === 404) {
    // Unterscheiden: fehlt nur die Datei oder das ganze Repo/der Branch?
    const repoRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/branches/${encodeURIComponent(config.branch)}`, { headers: apiHeaders() });
    if (repoRes.ok) return null;
    throw new Error(await apiError(res));
  }
  if (!res.ok) throw new Error(await apiError(res));
  const body = await res.json();
  if (body.content == null || (body.content === '' && body.size > 0)) {
    // Dateien > 1 MB liefert die Contents-API nicht inline.
    const raw = await fetch(body.download_url, { cache: 'no-store' });
    return { json: await raw.text(), sha: body.sha };
  }
  return { json: b64decode(body.content), sha: body.sha };
}

async function ghPut(content, sha) {
  const res = await fetch(apiUrl(), {
    method: 'PUT',
    headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Widgets aktualisiert',
      content: b64encode(content),
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) {
    const err = new Error('conflict');
    err.conflict = true;
    err.detail = await apiError(res);
    throw err;
  }
  if (!res.ok) throw new Error(await apiError(res));
  return (await res.json()).content.sha;
}

/* ------------------------------------------------------------------ *
 * Laden & Speichern
 * ------------------------------------------------------------------ */
async function load({ askDraft = true } = {}) {
  setBusy(true, 'Lädt…');
  let json, sha = null;
  try {
    if (config.token) {
      const r = await ghGet();
      if (r) ({ json, sha } = r);
      else json = serialize({ title: 'Meine Widgets', children: [] });
    } else {
      const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`data.json: HTTP ${res.status}`);
      json = await res.text();
    }
  } catch (err) {
    setBusy(false);
    toast(String(err.message || err), true, 6000);
    if (!state.data) {
      state.data = normalize({});
      state.savedJson = serialize(state.data);
    }
    renderAll();
    return;
  }

  state.data = normalize(JSON.parse(json));
  state.sha = sha;
  state.savedJson = serialize(state.data);

  if (askDraft) restoreDraftIfAny();
  if (!find(state.selectedId)) state.selectedId = 'root';
  setBusy(false);
  renderAll();
}

function restoreDraftIfAny() {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { /* ignore */ }
  if (!draft || !draft.data) return;
  const draftJson = serialize(normalize(draft.data));
  if (draftJson === state.savedJson) { clearDraft(); return; }
  const when = draft.at ? new Date(draft.at).toLocaleString('de-DE') : 'unbekannt';
  if (confirm(`Es gibt ungespeicherte Änderungen vom ${when}.\n\nWiederherstellen?`)) {
    state.data = normalize(draft.data);
  } else {
    clearDraft();
  }
}

function saveDraft() {
  try {
    if (isDirty()) localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), data: state.data }));
    else clearDraft();
  } catch { /* ignore */ }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

async function save() {
  if (!config.token) {
    toast('Zum Speichern bitte zuerst einen GitHub-Token hinterlegen.');
    openSettings();
    return;
  }
  const content = serialize(state.data);
  setBusy(true, 'Speichert…');
  try {
    let sha = state.sha;
    if (!sha) {
      const remote = await ghGet();
      sha = remote ? remote.sha : null;
      if (remote && serialize(normalize(JSON.parse(remote.json))) !== state.savedJson &&
          !confirm('Die Datei auf GitHub weicht vom geladenen Stand ab.\n\nTrotzdem mit deinem Stand überschreiben?')) {
        setBusy(false); updateStatus(); return;
      }
    }
    try {
      state.sha = await ghPut(content, sha);
    } catch (err) {
      if (!err.conflict) throw err;
      if (!confirm('Die Datei wurde inzwischen auf GitHub geändert (z. B. in einem anderen Tab).\n\nMit deinem Stand überschreiben?')) {
        setBusy(false); updateStatus(); return;
      }
      const remote = await ghGet();
      state.sha = await ghPut(content, remote ? remote.sha : null);
    }
    state.savedJson = content;
    clearDraft();
    toast('Gespeichert ✓  Die Startseite zeigt die Änderung in ca. 1 Minute.');
  } catch (err) {
    toast(String(err.message || err), true, 7000);
  }
  setBusy(false);
  updateStatus();
}

/* ------------------------------------------------------------------ *
 * Änderungen
 * ------------------------------------------------------------------ */
function changed({ tree = true, editor = false } = {}) {
  if (tree) renderTree();
  if (editor) renderEditor();
  updateStatus();
  saveDraft();
}

function select(id, { focusTitle = false } = {}) {
  state.selectedId = id;
  const r = find(id);
  if (r) r.ancestors.forEach(a => state.expanded.add(a === state.data ? 'root' : a.id));
  history.replaceState(null, '', id === 'root' ? location.pathname : `#${encodeURIComponent(id)}`);
  renderTree();
  renderEditor();
  if (focusTitle) {
    const input = editorEl.querySelector('#f-title');
    if (input) { input.focus(); input.select(); }
  }
  treeEl.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' });
}

function addChild(parentId, type) {
  const { node: parent } = find(parentId);
  const child = type === 'link'
    ? { id: newId('l'), type: 'link', title: 'Neuer Link', url: 'https://', icon: '', description: '' }
    : { id: newId('w'), type: 'widget', title: 'Neues Widget', icon: '📁', description: '', children: [] };
  parent.children.push(child);
  state.expanded.add(parentId);
  changed({ tree: false });
  select(child.id, { focusTitle: true });
}

function move(id, delta) {
  const r = find(id);
  if (!r || !r.parent) return;
  const kids = r.parent.children;
  const j = r.index + delta;
  if (j < 0 || j >= kids.length) return;
  [kids[r.index], kids[j]] = [kids[j], kids[r.index]];
  changed({ editor: true });
}

function moveTo(id, targetId) {
  const r = find(id);
  const t = find(targetId);
  if (!r || !t || r.parent === t.node) return;
  if (r.node.type === 'widget' && (r.node.id === targetId || isDescendant(r.node, targetId))) return;
  r.parent.children.splice(r.index, 1);
  t.node.children.push(r.node);
  state.expanded.add(targetId);
  changed({ tree: false });
  select(id);
  toast(`Verschoben nach „${t.node === state.data ? 'Startseite' : t.node.title}“`);
}

function remove(id) {
  const r = find(id);
  if (!r || !r.parent) return;
  const n = countDescendants(r.node);
  const what = r.node.type === 'link' ? 'den Link' : 'das Widget';
  const extra = n ? `\n\nDamit werden auch ${n} enthaltene Einträge gelöscht.` : '';
  if (!confirm(`${what[0].toUpperCase() + what.slice(1)} „${r.node.title || 'Ohne Titel'}“ löschen?${extra}`)) return;
  r.parent.children.splice(r.index, 1);
  const parentId = r.parent === state.data ? 'root' : r.parent.id;
  changed({ tree: false });
  if (state.selectedId === id || !find(state.selectedId)) select(parentId);
  else { renderTree(); renderEditor(); }
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */
function renderAll() { renderTree(); renderEditor(); updateStatus(); }

function updateStatus() {
  const dirty = isDirty();
  statusEl.className = 'status ' + (dirty ? 'dirty' : 'ok');
  if (state.busy) return;
  if (dirty) statusText.textContent = 'Ungespeicherte Änderungen';
  else statusText.textContent = config.token ? `Gespeichert · ${config.owner}/${config.repo}` : 'Nur lesen (kein Token)';
  saveBtn.disabled = !dirty;
}

function setBusy(busy, text) {
  state.busy = busy;
  saveBtn.disabled = busy;
  $('btn-reload').disabled = busy;
  if (busy) { statusEl.className = 'status'; statusText.textContent = text; }
}

function renderTree() {
  const rootRow = treeRow(state.data, 'root', 0);
  const li = h('li', { role: 'treeitem' }, rootRow);
  if (state.expanded.has('root')) li.append(treeChildren(state.data, 1));
  treeEl.replaceChildren(li);
}

function treeChildren(node, depth) {
  return h('ul', { role: 'group' }, (node.children || []).map(c => {
    const li = h('li', { role: 'treeitem' }, treeRow(c, c.id, depth));
    if (c.type === 'widget' && state.expanded.has(c.id) && c.children.length) li.append(treeChildren(c, depth + 1));
    return li;
  }));
}

function treeRow(node, id, depth) {
  const isRoot = id === 'root';
  const hasKids = (isRoot || node.type === 'widget') && (node.children || []).length > 0;
  const open = state.expanded.has(id);
  const caret = h('button', {
    class: 'caret' + (hasKids ? (open ? ' open' : '') : ' none'),
    type: 'button', tabindex: '-1', 'aria-label': open ? 'Zuklappen' : 'Aufklappen',
    onclick: (e) => {
      e.stopPropagation();
      open ? state.expanded.delete(id) : state.expanded.add(id);
      renderTree();
    },
  }, '▶');
  const icon = isRoot ? '🏠' : (node.icon || (node.type === 'link' ? '🔗' : '📁'));
  return h('div', {
    class: 'tree-row' + (state.selectedId === id ? ' selected' : ''),
    tabindex: '0', 'aria-selected': String(state.selectedId === id),
    onclick: () => select(id),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); }
      if (e.key === 'ArrowRight' && hasKids) { state.expanded.add(id); renderTree(); }
      if (e.key === 'ArrowLeft') { state.expanded.delete(id); renderTree(); }
    },
  },
    caret,
    h('span', { class: 't-icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 't-title' }, isRoot ? (node.title || 'Startseite') : (node.title || 'Ohne Titel')),
    !isRoot && node.type === 'link' ? h('span', { class: 't-kind' }, 'Link') : null,
  );
}

function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

function textInput(id, value, oninput, attrs = {}) {
  return h('input', { id, value: value ?? '', autocomplete: 'off', ...attrs, oninput });
}

function renderEditor() {
  const r = find(state.selectedId);
  if (!r) { select('root'); return; }
  const { node, parent, index } = r;
  const isRoot = node === state.data;
  const isLink = node.type === 'link';
  const id = isRoot ? 'root' : node.id;

  const viewHref = isRoot ? 'index.html'
    : isLink ? safeUrl(node.url)
    : `index.html#/${pathIds(r).map(encodeURIComponent).join('/')}`;
  editorHead.replaceChildren(
    h('span', {}, isRoot ? 'Startseite' : isLink ? 'Link bearbeiten' : 'Widget bearbeiten'),
    ...(viewHref ? [h('a', { class: 'btn small', href: viewHref, target: '_blank', rel: 'noopener noreferrer' }, isLink ? 'Öffnen ↗' : 'Ansehen ↗')] : []),
  );

  const parts = [];

  // --- Felder
  parts.push(field(isRoot ? 'Titel der Seite' : 'Titel',
    textInput('f-title', node.title, (e) => { node.title = e.target.value; changed(); }, { placeholder: isRoot ? 'Meine Widgets' : 'Titel' })));

  if (isLink) {
    const urlHint = h('span', { class: 'hint' });
    const checkUrl = () => {
      const ok = safeUrl(node.url);
      urlHint.textContent = !node.url || node.url === 'https://' ? 'z. B. https://example.com'
        : ok ? `Öffnet: ${ok}` : '⚠️ Ungültige URL';
      urlHint.style.color = ok || !node.url ? '' : 'var(--danger)';
    };
    const urlInput = textInput('f-url', node.url, (e) => { node.url = e.target.value.trim(); checkUrl(); changed(); },
      { type: 'url', inputmode: 'url', placeholder: 'https://…' });
    // "youtube.com" -> "https://youtube.com/" beim Verlassen des Feldes
    urlInput.addEventListener('change', () => {
      const ok = safeUrl(node.url);
      if (ok && ok !== node.url) { node.url = ok; urlInput.value = ok; checkUrl(); changed(); }
    });
    checkUrl();
    parts.push(h('div', { class: 'field' }, h('label', { for: 'f-url' }, 'URL'), urlInput, urlHint));
  }

  if (!isRoot) {
    parts.push(h('div', { class: 'field-row' },
      field('Icon', textInput('f-icon', node.icon, (e) => { node.icon = e.target.value; changed(); }, { placeholder: isLink ? '🔗' : '📁', maxlength: '8' })),
      field('Beschreibung', h('textarea', { id: 'f-desc', rows: '2', placeholder: 'optional', oninput: (e) => { node.description = e.target.value; changed(); } }, node.description || '')),
    ));
    parts.push(h('p', { class: 'hint', style: 'margin:-8px 0 14px;font-size:12px;color:var(--muted)' },
      'Icon: ein Emoji (Windows: Win + .   Mac: Ctrl + Cmd + Leertaste). Leer = Anfangsbuchstabe.'));
  }

  // --- Inhalt (für Startseite & Widgets)
  if (!isLink) {
    parts.push(h('hr', { class: 'divider' }));
    parts.push(h('div', { class: 'section-label', style: 'margin-top:0' }, `Inhalt · ${countLabel(node)}`));
    if (node.children.length) {
      parts.push(h('ul', { class: 'children-list' }, node.children.map((c, i) =>
        h('li', {},
          iconEl(c),
          h('span', { class: 'c-title', onclick: () => select(c.id), title: 'Bearbeiten' },
            c.title || 'Ohne Titel',
            h('span', { style: 'color:var(--muted);font-size:12px' }, c.type === 'link' ? '  · Link' : `  · ${countLabel(c)}`)),
          h('button', { class: 'icon-btn', type: 'button', title: 'Nach oben', 'aria-label': 'Nach oben', disabled: i === 0, onclick: () => move(c.id, -1) }, '↑'),
          h('button', { class: 'icon-btn', type: 'button', title: 'Nach unten', 'aria-label': 'Nach unten', disabled: i === node.children.length - 1, onclick: () => move(c.id, 1) }, '↓'),
          h('button', { class: 'icon-btn danger', type: 'button', title: 'Löschen', 'aria-label': 'Löschen', onclick: () => remove(c.id) }, '✕'),
        ))));
    } else {
      parts.push(h('div', { class: 'empty', style: 'padding:20px' }, 'Noch leer.'));
    }
    parts.push(h('div', { class: 'actions', style: 'margin-top:12px' },
      h('button', { class: 'btn', type: 'button', onclick: () => addChild(id, 'widget') }, '＋ Widget'),
      h('button', { class: 'btn', type: 'button', onclick: () => addChild(id, 'link') }, '＋ Link'),
    ));
  }

  // --- Position, Verschieben, Löschen
  if (!isRoot) {
    parts.push(h('hr', { class: 'divider' }));
    const targets = [{ id: 'root', label: '🏠 Startseite' }];
    for (const { node: w, depth } of allWidgets()) {
      if (w === node || (node.type === 'widget' && isDescendant(node, w.id))) continue;
      targets.push({ id: w.id, label: `${'   '.repeat(depth + 1)}${w.icon || '📁'} ${w.title || 'Ohne Titel'}` });
    }
    const currentParentId = parent === state.data ? 'root' : parent.id;
    const sel = h('select', { id: 'f-move', onchange: (e) => moveTo(node.id, e.target.value) },
      targets.map(t => {
        const o = h('option', { value: t.id }, t.label);
        if (t.id === currentParentId) o.selected = true;
        return o;
      }));
    parts.push(field('Liegt in', sel));
    parts.push(h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', disabled: index === 0, onclick: () => move(node.id, -1) }, '↑ Nach oben'),
      h('button', { class: 'btn', type: 'button', disabled: index === parent.children.length - 1, onclick: () => move(node.id, 1) }, '↓ Nach unten'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn danger', type: 'button', onclick: () => remove(node.id) }, '🗑 Löschen'),
    ));
  }

  editorEl.replaceChildren(...parts);
}

function pathIds(r) {
  return [...r.ancestors.filter(a => a !== state.data).map(a => a.id), r.node.id];
}

/* ------------------------------------------------------------------ *
 * Einstellungen, Import/Export
 * ------------------------------------------------------------------ */
const dlg = $('settings');
function openSettings() {
  $('s-owner').value = config.owner;
  $('s-repo').value = config.repo;
  $('s-branch').value = config.branch;
  $('s-path').value = config.path;
  $('s-token').value = config.token;
  dlg.showModal();
}
dlg.addEventListener('close', async () => {
  const action = dlg.returnValue;
  if (action === 'save') {
    const next = {
      owner: $('s-owner').value.trim(), repo: $('s-repo').value.trim(),
      branch: $('s-branch').value.trim() || 'main', path: $('s-path').value.trim() || 'data.json',
      token: $('s-token').value.trim(),
    };
    const repoChanged = ['owner', 'repo', 'branch', 'path'].some(k => next[k] !== config[k]);
    const tokenAdded = next.token && !config.token;
    config = next;
    storeConfig(config);
    state.sha = null;
    if (repoChanged || tokenAdded) {
      if (isDirty()) {
        // Lokale Änderungen behalten, nur SHA/Stand vom Server holen.
        try {
          const r = await ghGet();
          state.sha = r ? r.sha : null;
          toast('Verbunden ✓ Deine Änderungen sind noch da – jetzt speichern.');
        } catch (err) { toast(String(err.message || err), true, 6000); }
        updateStatus();
      } else {
        await load({ askDraft: false });
        if (config.token) toast('Verbunden ✓');
      }
    } else updateStatus();
  } else if (action === 'forget') {
    config.token = '';
    storeConfig(config);
    state.sha = null;
    toast('Token aus diesem Browser entfernt.');
    updateStatus();
  }
});

function exportJson() {
  const blob = new Blob([serialize(state.data)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'data.json' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

async function importJson(file) {
  try {
    const data = normalize(JSON.parse(await file.text()));
    if (!confirm(`„${file.name}“ importieren?\n\nDie aktuelle Struktur wird ersetzt (erst beim Speichern auf GitHub übernommen).`)) return;
    state.data = data;
    state.selectedId = 'root';
    changed({ editor: true });
    toast('Importiert. Zum Übernehmen „Speichern“ klicken.');
  } catch (err) {
    toast('Ungültige JSON-Datei: ' + (err.message || err), true, 6000);
  }
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */
$('btn-settings').addEventListener('click', openSettings);
saveBtn.addEventListener('click', save);
$('btn-reload').addEventListener('click', () => {
  if (isDirty() && !confirm('Ungespeicherte Änderungen verwerfen und neu laden?')) return;
  clearDraft();
  load({ askDraft: false });
});
$('btn-expand').addEventListener('click', () => {
  state.expanded.add('root');
  allWidgets().forEach(({ node }) => state.expanded.add(node.id));
  renderTree();
});
$('btn-collapse').addEventListener('click', () => { state.expanded = new Set(['root']); renderTree(); });
$('btn-export').addEventListener('click', exportJson);
$('file-import').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) importJson(f);
  e.target.value = '';
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (isDirty() && !state.busy) save();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// Start: optional direkt ein Widget auswählen (admin.html#<id>)
const initial = decodeURIComponent(location.hash.slice(1));
if (initial) state.selectedId = initial;
await load();
if (state.selectedId !== 'root') select(state.selectedId);
