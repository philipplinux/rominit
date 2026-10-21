import { h } from './dom.js';

/** @param {string} kind @param {string} title @param {string} rom */
export function requestButton(kind, title, rom = '') {
  const button = h('button', { type: 'button', className: 'button button-secondary', textContent: title, onclick() {
    const text = h('textarea', { className: 'confirmation-input', required: true, maxLength: 2000, rows: 4,
      placeholder: kind === 'update' ? 'New version and current version (for example: 2.5 replaces 2.3).' : kind === 'mirror' ? 'Which files should we mirror, and why?' : 'ROM name and/or device model, and what you would like added.' });
    const url = h('input', { className: 'confirmation-input', type: 'url', required: kind !== 'mirror', maxLength: 2000, placeholder: 'https://…' });
    const status = h('p', { role: 'status', className: 'field-help' });
    const send = h('button', { type: 'submit', className: 'button button-primary', textContent: 'Send request' });
    const dialog = h('dialog', { className: 'host-confirm', ariaLabel: title }, h('form', { async onsubmit(event) {
      event.preventDefault(); send.disabled = true; status.textContent = 'Sending…';
      const response = await fetch('./api/requests', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, rom: rom || null, page: location.pathname + location.search, text: text.value, url: url.value || null }) }).catch(() => null);
      const reply = await response?.json().catch(() => ({}));
      status.textContent = response?.ok ? 'Thanks, request sent for review.' : `Could not send: ${reply?.error ?? 'network error'}.`;
      send.disabled = !!response?.ok;
    } }, h('h2', { textContent: title }), rom && h('p', { textContent: rom }),
      h('label', { className: 'field-help' }, 'Details', text), h('label', { className: 'field-help' }, kind === 'mirror' ? 'Source URL (optional)' : 'ROM or device source URL', url),
      send, h('button', { type: 'button', className: 'button button-secondary', textContent: 'Close', onclick: () => dialog.close() }), status));
    dialog.addEventListener('close', () => { dialog.remove(); button.focus(); });
    document.body.append(dialog); dialog.showModal();
  } });
  return button;
}

/** "Something wrong on this page?" form; falls back to a GitHub issue link. */
export function reportBox() {
  const page = location.pathname + location.search;
  const text = h('textarea', { className: 'confirmation-input', placeholder: 'What is wrong or missing? (wrong file, broken step, outdated info…)', maxLength: 2000, rows: 3 });
  const where = h('select', { className: 'report-section' }, h('option', { value: '', textContent: 'Whole page' }));
  const send = h('button', { type: 'button', className: 'button button-secondary', textContent: 'Send ticket' }), status = h('small', {});
  const issue = `https://github.com/philipplinux/rominit/issues/new?title=${encodeURIComponent(`Problem on ${page}`)}`;
  send.addEventListener('click', async () => {
    status.textContent = 'Sending…';
    const response = await fetch('./api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: location.pathname + location.search, text: text.value, section: where.value }) }).catch(() => null);
    const reply = await response?.json().catch(() => ({}));
    status.textContent = response?.ok ? 'Thanks, ticket sent.' : `Could not send: ${reply?.error ?? 'network error'}. Use the GitHub link instead.`;
    if (response?.ok) text.value = '';
  });
  const box = h('details', { id: 'submit-request', className: 'page-section report', ontoggle() {
    if (where.isConnected) return; // built on first open, from this page's own sections
    for (const s of document.querySelectorAll('details.page-section:not(.report) > summary > span, .console-page h2, .console-page details.console-section > summary')) where.append(h('option', { textContent: s.textContent }));
    text.before(h('label', { className: 'field-help' }, 'About: ', where));
  } }, h('summary', {}, h('span', { textContent: 'T · Submit ticket / Request' }), h('small', { textContent: 'report a problem or request a new ROM / device' })),
    h('p', {}, requestButton('new', 'Request new ROM / device')),
    h('div', { className: 'comment-box' }, text, send, status, h('small', {}, 'Or ', h('a', { href: issue, target: '_blank', rel: 'noopener noreferrer', textContent: 'open a GitHub issue' }), '.')));
  return box;
}
