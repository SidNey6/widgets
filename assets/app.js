import { h, iconEl, countLabel, safeUrl, hostOf, normalize } from './common.js';

const main = document.getElementById('main');
const searchInput = document.getElementById('search');
const brand = document.getElementById('brand');

let data = null;

async function load() {
  try {
    // Cache umgehen, damit Änderungen aus dem Editor schnell sichtbar sind.
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = normalize(await res.json());
  } catch (err) {
    main.replaceChildren(
      h('div', { class: 'empty', style: 'margin-top:24px' },
        'Die Daten (data.json) konnten nicht geladen werden: ', String(err.message || err))
    );
    return;
  }
  brand.textContent = data.title;
  render();
}

function currentPath() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

function hashFor(ids) {
  return '#/' + ids.map(encodeURIComponent).join('/');
}

/** Folgt dem Pfad aus der URL so weit, wie er gültig ist. */
function resolve(path) {
  let node = data;
  const trail = [];
  for (const id of path) {
    const next = (node.children || []).find(c => c.id === id && c.type === 'widget');
    if (!next) break;
    trail.push(next);
    node = next;
  }
  return { node, trail };
}

function render() {
  if (!data) return;
  const q = searchInput.value.trim();
  if (q) return renderSearch(q);

  const { node, trail } = resolve(currentPath());
  const ids = trail.map(n => n.id);
  document.title = trail.length ? `${node.title} · ${data.title}` : data.title;

  const parts = [];

  // Breadcrumb
  if (trail.length) {
    const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Pfad' },
      h('a', { href: '#/' }, '🏠 Start'));
    trail.forEach((n, i) => {
      crumbs.append(h('span', { class: 'sep' }, '›'));
      if (i === trail.length - 1) crumbs.append(h('span', { class: 'current', 'aria-current': 'page' }, n.title || 'Ohne Titel'));
      else crumbs.append(h('a', { href: hashFor(ids.slice(0, i + 1)) }, n.title || 'Ohne Titel'));
    });
    parts.push(crumbs);
    parts.push(h('div', { class: 'page-title' }, iconEl(node, 'big'), h('h1', {}, node.title || 'Ohne Titel')));
    parts.push(h('p', { class: 'page-desc' }, node.description || ''));
  } else {
    parts.push(h('div', { style: 'height:24px' }));
  }

  const kids = node.children || [];
  const widgets = kids.filter(c => c.type === 'widget');
  const links = kids.filter(c => c.type === 'link');

  if (!kids.length) {
    parts.push(h('div', { class: 'empty' }, 'Hier ist noch nichts.'));
  }

  if (widgets.length) {
    if (links.length) parts.push(h('div', { class: 'section-label' }, 'Widgets'));
    parts.push(h('div', { class: 'grid' }, widgets.map(w => widgetCard(w, [...ids, w.id]))));
  }
  if (links.length) {
    if (widgets.length) parts.push(h('div', { class: 'section-label' }, 'Links'));
    parts.push(h('div', { class: 'grid' }, links.map(l => linkCard(l))));
  }

  main.replaceChildren(...parts);
}

function widgetCard(w, pathIds) {
  return h('a', { class: 'card widget', href: hashFor(pathIds) },
    h('div', { class: 'head' }, iconEl(w), h('div', { class: 'title' }, w.title || 'Ohne Titel')),
    w.description ? h('div', { class: 'desc' }, w.description) : null,
    h('div', { class: 'meta' }, h('span', {}, countLabel(w)), h('span', { 'aria-hidden': 'true' }, '→'))
  );
}

function linkCard(l, pathText) {
  const url = safeUrl(l.url);
  const attrs = url
    ? { class: 'card link', href: url, target: '_blank', rel: 'noopener noreferrer' }
    : { class: 'card link', title: 'Ungültige URL' };
  return h(url ? 'a' : 'div', attrs,
    h('div', { class: 'head' }, iconEl(l), h('div', { class: 'title' }, l.title || hostOf(url) || 'Link')),
    l.description ? h('div', { class: 'desc' }, l.description) : null,
    pathText ? h('div', { class: 'result-path' }, pathText) : null,
    h('div', { class: 'meta' }, h('span', { class: 'host' }, hostOf(url) || 'ungültige URL'), h('span', { 'aria-hidden': 'true' }, '↗'))
  );
}

function renderSearch(q) {
  const needle = q.toLowerCase();
  const results = [];
  const walk = (node, ids, titles) => {
    for (const c of node.children || []) {
      const hay = `${c.title} ${c.description} ${c.url || ''}`.toLowerCase();
      if (hay.includes(needle)) results.push({ node: c, ids: [...ids, c.id], titles });
      if (c.type === 'widget') walk(c, [...ids, c.id], [...titles, c.title]);
    }
  };
  walk(data, [], []);

  const parts = [h('div', { class: 'crumbs' }, h('span', { class: 'current' }, `${results.length} Treffer für „${q}“`))];
  if (!results.length) parts.push(h('div', { class: 'empty' }, 'Nichts gefunden.'));
  else {
    parts.push(h('div', { class: 'grid' }, results.map(r => {
      const pathText = r.titles.length ? r.titles.join(' › ') : 'Start';
      if (r.node.type === 'link') return linkCard(r.node, pathText);
      const card = widgetCard(r.node, r.ids);
      card.addEventListener('click', () => { searchInput.value = ''; });
      card.insertBefore(h('div', { class: 'result-path' }, pathText), card.querySelector('.meta'));
      return card;
    })));
  }
  main.replaceChildren(...parts);
}

window.addEventListener('hashchange', () => { searchInput.value = ''; render(); window.scrollTo(0, 0); });
searchInput.addEventListener('input', render);
searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') { searchInput.value = ''; render(); } });

load();
