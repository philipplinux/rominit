import { h } from './dom.js';

// Once the header scrolls off, a ☰ button top-left pins it back on demand (sticky, so the page doesn't jump).
const bar = document.querySelector('.topbar');
if (bar) {
  const mark = h('div', { ariaHidden: 'true' });
  bar.after(mark);
  const button = h('button', { type: 'button', className: 'header-tuck', title: 'Show header', ariaLabel: 'Show site header', ariaExpanded: 'false', textContent: '☰', onclick() {
    const pinned = bar.classList.toggle('pinned');
    button.ariaExpanded = String(pinned);
    button.textContent = pinned ? '×' : '☰';
  } });
  document.body.append(button);
  new IntersectionObserver(([entry]) => {
    document.body.classList.toggle('header-off', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    if (entry.isIntersecting) { bar.classList.remove('pinned'); button.ariaExpanded = 'false'; button.textContent = '☰'; }
  }).observe(mark);
}
