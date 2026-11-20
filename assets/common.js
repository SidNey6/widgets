// Gemeinsame Hilfsfunktionen für Startseite und Editor.

/** Erlaubt nur sichere Link-Schemata (kein javascript: etc.). */
export function safeUrl(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try {
    const parsed = new URL(u);
    return ['http:', 'https:', 'mailto:', 'tel:', 'ftp:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Kleiner DOM-Helfer: h('div', {class: 'x'}, child1, 'text', ...) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Icon: Emoji falls gesetzt, sonst Anfangsbuchstabe. */
export function iconEl(node, extraClass = '') {
  const icon = (node.icon || '').trim();
  if (icon) return h('span', { class: `icon ${extraClass}`, 'aria-hidden': 'true' }, icon);
  const letter = (node.title || '?').trim().charAt(0).toUpperCase() || '?';
  return h('span', { class: `icon letter ${extraClass}`, 'aria-hidden': 'true' }, letter);
}

export function countChildren(node) {
  const kids = node.children || [];
  return {
    widgets: kids.filter(c => c.type === 'widget').length,
    links: kids.filter(c => c.type === 'link').length,
  };
}

export function countLabel(node) {
  const { widgets, links } = countChildren(node);
  const parts = [];
  if (widgets) parts.push(`${widgets} ${widgets === 1 ? 'Widget' : 'Widgets'}`);
  if (links) parts.push(`${links} ${links === 1 ? 'Link' : 'Links'}`);
  return parts.length ? parts.join(' · ') : 'leer';
}

/** Stellt sicher, dass die Datenstruktur gültig ist. */
export function normalize(data) {
  const root = data && typeof data === 'object' ? data : {};
  const fix = (node) => {
    if (!node.id) node.id = newId(node.type === 'link' ? 'l' : 'w');
    node.title = node.title ?? '';
    node.icon = node.icon ?? '';
    node.description = node.description ?? '';
    if (node.type === 'link') {
      node.url = node.url ?? '';
      delete node.children;
    } else {
      node.type = 'widget';
      node.children = Array.isArray(node.children) ? node.children : [];
      node.children.forEach(fix);
    }
    return node;
  };
  return {
    title: root.title || 'Meine Widgets',
    children: (Array.isArray(root.children) ? root.children : []).map(fix),
  };
}

export function newId(prefix = 'w') {
  const rnd = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).replace(/-/g, '');
  return `${prefix}-${rnd.slice(0, 10)}`;
}
