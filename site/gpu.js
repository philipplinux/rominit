import { progressRail } from './progress-rail.js';
import { GPUS, gpuFreshness } from '../src/gpus/index.js';
import { h } from './dom.js';
import { officialSupportText } from '../src/catalog.js';
import './header-tuck.js';
import { mountAccount } from './account.js';
import { reportBox } from './report.js';

const info = GPUS.find(entry => entry.id === document.documentElement.dataset.gpu) ?? GPUS[0];
const byId = id => /** @type {HTMLElement} */ (document.getElementById(id));
const external = (href, label) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: `${label} ↗` });
const FRESHNESS = { active: 'Active', slow: 'Slow', quiet: 'Quiet 2+ years', finished: 'Finished one-off' };

document.title = `${info.name} · GPUs · ROMinit`;
byId('gpu-name').textContent = info.name;
byId('gpu-path').textContent = [info.vendor, info.line, info.series].join(' › ');
byId('gpu-summary').textContent = info.summary;
byId('gpu-meta').replaceChildren(...[`Released ${info.releaseYear}`, info.die].map(text => h('span', { className: 'architecture-tag', textContent: text })),
  h('a', { className: 'architecture-tag', href: info.officialSupport.source, target: '_blank', rel: 'noopener noreferrer', textContent: officialSupportText(info.officialSupport, 'NVIDIA driver') }));
byId('gpu-specs').replaceChildren(...info.specs.map(([label, value]) => h('div', {}, h('dt', { textContent: label }), h('dd', { textContent: value }))));
byId('gpu-specs-hint').textContent = info.specs.filter(([label]) => /^(Memory|Graphics card power)$/.test(label)).map(([, value]) => value).join(' · ');
byId('gpu-models').textContent = info.models;
byId('gpu-spec-source').append(external(info.specSource, 'Specs from NVIDIA'));

// One section per group (AI first, as the catalog orders projects); each card says how recent the project is.
const groups = [...new Set(info.projects.map(project => project.group))];
byId('gpu-groups').replaceChildren(...groups.map((group, i) => h('section', { id: `gpu-${group}`, className: 'flash-card console-section', ariaLabel: info.groups[group] },
  h('h2', { textContent: info.groups[group] }),
  h('div', { className: 'console-homebrew' }, ...info.projects.filter(project => project.group === group).map(project => {
    const fresh = gpuFreshness(project, info.checkedDate);
    return h('article', { className: 'console-project' },
      h('div', { className: 'console-project-heading' }, h('h3', { textContent: project.name }),
        fresh && h('span', { className: `gpu-fresh gpu-fresh-${fresh}`, textContent: FRESHNESS[fresh] })),
      h('p', { textContent: project.pitch }),
      h('ul', {}, h('li', {}, h('strong', { textContent: 'Suits: ' }), project.suits), h('li', {}, h('strong', { textContent: 'Effort / risk: ' }), project.risk),
        h('li', {}, h('strong', { textContent: 'Last update: ' }), project.updateNote)),
      project.tested && h('p', { className: 'gpu-tested', textContent: project.tested }),
      external(project.source, 'Project page'));
  })))));
groups.forEach((group, i) => { byId(`gpu-${group}`).dataset.railLabel = `${i + 2} · ${info.groups[group]}`; });
byId('gpu-warnings').replaceChildren(...info.warnings.map(text => h('p', { className: 'console-warning', textContent: text })));
byId('gpu-sources').replaceChildren(...info.sources.map(source => h('li', {}, external(source.url, source.label))));
byId('gpu-checked').textContent = `Last update = newest release or commit on the project's own page, checked ${info.checkedDate}. Active means within 3 months; local-AI projects move fast.`;

byId('console-report').append(reportBox());
byId('submit-request').dataset.railLabel = 'T · Report';
document.body.append(progressRail([...document.querySelectorAll('[data-rail-label]')].map(element => /** @type {HTMLElement} */ (element))));
void mountAccount();
