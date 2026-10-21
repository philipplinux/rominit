import { h } from './dom.js';

/** Left rail like a scrollbar: the rail is the whole page, milestones 0–4, R, T sit at their section's place (so long sections
 * get long stretches), the thumb is what the window shows. Green when a section is done, amber ring on the next one to do,
 * +/- opens or closes the section. @param {HTMLElement[]} sections */
export function progressRail(sections) {
  const marks = sections.map(sec => {
    const details = sec instanceof HTMLDetailsElement ? sec : null;
    const [num, label] = (sec.dataset.railLabel ?? sec.querySelector(':scope > summary > span')?.textContent ?? '').split(' · ');
    const fold = details ? h('button', { type: 'button', className: 'rail-fold', onclick() { details.open = !details.open; } }) : null;
    if (details && fold) {
      const sync = () => { fold.textContent = details.open ? '−' : '+'; fold.title = `${details.open ? 'Close' : 'Open'} ${label}`; };
      details.addEventListener('toggle', sync); sync();
    }
    const mark = h('div', { className: 'rail-mark' }, fold, h('a', { href: sec.id ? `#${sec.id}` : '#', title: label, ariaLabel: label, onclick(/** @type {Event} */ e) {
      e.preventDefault(); if (details) details.open = true; sec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); } }, h('b', { textContent: num }), h('small', { textContent: label })));
    mark.dataset.num = num; // R and T take their section's colours
    return mark;
  });
  const fill = h('i', { className: 'rail-fill' }), thumb = h('i', { className: 'rail-thumb' });
  let current = -1;
  const place = () => {
    current = 0;
    sections.forEach((sec, i) => { if (sec.getBoundingClientRect().top <= 140) current = i; });
    if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) current = sections.length - 1;
    paint();
    const page = Math.max(1, document.documentElement.scrollHeight);
    // Two sections closer than a two-line label still get that much room; pushed up from the bottom if needed.
    const gap = Math.min(44, rail.clientHeight / sections.length) / Math.max(1, rail.clientHeight); // short window: squeeze evenly
    const tops = sections.map(sec => (sec.getBoundingClientRect().top + scrollY) / page);
    for (let i = 1; i < tops.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + gap);
    for (let i = tops.length - 1; i >= 0; i--) tops[i] = Math.min(tops[i], i === tops.length - 1 ? 1 : tops[i + 1] - gap);
    tops.forEach((top, i) => { marks[i].style.top = `${100 * top}%`; });
    fill.style.height = thumb.style.top = `${100 * scrollY / page}%`;
    thumb.style.height = `${100 * innerHeight / page}%`;
  };
  const paint = () => {
    const next = sections.findIndex(sec => !sec.classList.contains('done') && sec.classList.contains('required'));
    marks.forEach((mark, i) => { const c = sections[i].classList; mark.className = `rail-mark${c.contains('done') ? ' done' : c.contains('skipped') ? ' done skipped' : i === next ? ' next' : ''}${i === current ? ' current' : ''}`;
      const link = mark.querySelector('a');
      if (i === current) link?.setAttribute('aria-current', 'location'); else link?.removeAttribute('aria-current'); });
  };
  // Sections flip their own done / required classes; opening or closing one moves the rest, so re-place on resize too.
  const watch = new MutationObserver(paint);
  for (const sec of sections) watch.observe(sec, { attributes: true, attributeFilter: ['class'] });
  let frame = 0;
  const soon = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
  addEventListener('scroll', soon, { passive: true });
  new ResizeObserver(soon).observe(document.body);
  const rail = h('nav', { className: 'progress-rail', ariaLabel: 'Progress through this page' }, fill, thumb, ...marks);
  paint(); soon();
  return rail;
}
