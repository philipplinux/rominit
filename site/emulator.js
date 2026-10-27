import { progressRail } from './progress-rail.js';
import { EMULATORS } from '../src/emulators/index.js';
import { CONSOLES } from '../src/consoles/index.js';
import { h } from './dom.js';
import { officialSupportText } from '../src/catalog.js';
import './header-tuck.js';
import { mountAccount } from './account.js';
import { reportBox } from './report.js';

const info = EMULATORS.find(entry => entry.id === document.documentElement.dataset.emulator) ?? EMULATORS[0];
const byId = id => /** @type {HTMLElement} */ (document.getElementById(id));
const external = (href, label) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: `${label} ↗` });
const items = list => list.map(text => h('li', { textContent: text }));

document.title = `${info.name} · Emulators · ROMinit`;
byId('emu-name').textContent = info.name;
byId('emu-summary').textContent = info.summary;
// Each console it plays links back to that console's research page.
byId('emu-plays').replaceChildren(...info.plays.flatMap((id, i) => [i ? ', ' : '', h('a', { href: `./${id}`, textContent: CONSOLES.find(c => c.id === id)?.name ?? id })]));
byId('emu-meta').replaceChildren(...[`${info.version} · ${info.releaseDate}`, info.license, ...info.hosts].map(text => h('span', { className: 'architecture-tag', textContent: text })),
  h('a', { className: 'architecture-tag', href: info.officialSupport.source, target: '_blank', rel: 'noopener noreferrer', textContent: officialSupportText(info.officialSupport, 'Project') }));
byId('emu-steps').replaceChildren(...items(info.how));
byId('emu-requirements').replaceChildren(...items(info.requirements));
byId('emu-warnings').replaceChildren(...info.warnings.map(text => h('p', { className: 'console-project-warning', textContent: text })));
byId('emu-links').replaceChildren(...info.links.map(link => external(link.url, link.label)));
byId('emu-checked').textContent = `Sources checked ${info.checkedDate}`;

byId('console-report').append(reportBox());
byId('submit-request').dataset.railLabel = 'T · Report';
document.body.append(progressRail([...document.querySelectorAll('[data-rail-label]')].map(element => /** @type {HTMLElement} */ (element))));
void mountAccount();
