import { progressRail } from './progress-rail.js';
import { CONSOLES, consoleCompatibility } from '../src/consoles/index.js';
import { h } from './dom.js';
import { mountAccount } from './account.js';
import { reportBox } from './report.js';

const info = CONSOLES.find(console => console.id === document.documentElement.dataset.console);
const byId = id => /** @type {HTMLElement} */ (document.getElementById(id));
const external = (href, label) => {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' ? h('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer', textContent: label }) : null;
  } catch { return null; }
};
const factRows = (object, labels) => Object.entries(object ?? {}).filter(([, value]) => value).map(([key, value]) => h('div', {},
  h('dt', { textContent: labels[key] ?? key }), h('dd', { textContent: value })));
const projectId = project => `project-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const facts = { cpu: 'CPU', gpu: 'GPU', memory: 'Memory', storage: 'Storage', media: 'Media', dimensions: 'Dimensions' };

if (!info) {
  byId('console-status').textContent = 'This console research page is not in the current catalog.';
} else {
  document.title = `${info.name} · Console research · ROMinit`;
  byId('console-name').textContent = info.name;
  byId('console-summary').textContent = info.summary;
  for (const [id, media] of Object.entries({ 'console-logo': info.media.logo, 'console-photo': info.media.photo })) {
    Object.assign(byId(id), { src: `./${media.src}`, alt: media.alt, width: media.width, height: media.height });
  }
  byId('console-photo-credit').append(external(info.media.photo.page, `Photo: ${info.media.photo.artist} · CC0`));
  byId('console-image-credits').replaceChildren(...[info.media.logo, info.media.photo].map(media => h('p', {}, external(media.page, `${media.artist} · ${media.license}`))));
  byId('console-latest').replaceChildren(...info.highlights.map(highlight => h('article', { className: 'flash-card console-highlight' },
    h('p', { className: 'eyebrow', textContent: highlight.title }), h('h2', { textContent: highlight.name }),
    h('p', { className: 'console-highlight-firmware', textContent: highlight.firmware }), h('p', { textContent: highlight.summary }),
    h('div', { className: 'console-project-links' }, h('a', { href: `#${highlight.target}`, textContent: 'See options & requirements ↓' }), external(highlight.source, 'Upstream ↗')),
    h('small', { className: 'field-help', textContent: `Sources checked ${highlight.checkedDate}` }))));
  byId('console-meta').replaceChildren(
    h('span', { className: 'architecture-tag', textContent: info.manufacturer }),
    h('span', { className: 'architecture-tag', textContent: `Released ${info.releaseYear}` }));
  byId('console-specs').replaceChildren(...factRows(info.specs, facts));

  const firmware = info.firmware;
  byId('console-firmware').textContent = firmware.version ?? 'Current version not verified';
  byId('console-firmware-checked').textContent = firmware.checkedDate ? `Checked ${firmware.checkedDate}. Firmware changes over time.` : 'Firmware information needs a dated check.';
  const firmwareSource = external(firmware.source, 'Firmware source ↗');
  if (firmwareSource) byId('console-firmware-source').append(firmwareSource);

  byId('console-variants').replaceChildren(...(info.variants ?? []).map(variant => h('article', { className: 'console-variant' },
    h('h3', { textContent: variant.model }),
    h('dl', { className: 'console-facts' }, ...factRows({ region: variant.region, releaseYear: variant.releaseYear, storage: variant.storage, notes: variant.notes }, { region: 'Region', releaseYear: 'Release year', storage: 'Storage', notes: 'Notes' }),
      ...factRows(variant.specs, facts).map(row => { row.classList.add('console-variant-spec'); return row; })))));

  const modelSelect = /** @type {HTMLSelectElement} */ (byId('console-model'));
  modelSelect.append(...info.models.map(model => h('option', { value: model.id, textContent: model.name })));
  const firmwareSelect = /** @type {HTMLSelectElement} */ (byId('console-installed-firmware'));
  const versions = [...new Set([firmware.shortVersion, ...info.firmwareOptions,
    ...info.homebrew.flatMap(project => project.compatibility.flatMap(rule => rule.supportedFirmware))])].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  firmwareSelect.append(...versions.map(version => h('option', { value: version, textContent: version })), h('option', { value: 'unlisted', textContent: 'Other / unlisted firmware' }));
  const params = new URLSearchParams(location.search);
  if (info.models.some(model => model.id === params.get('model'))) modelSelect.value = params.get('model');
  if (params.has('firmware')) firmwareSelect.value = versions.includes(params.get('firmware')) ? params.get('firmware') : 'unlisted';
  const modelName = id => info.models.find(model => model.id === id)?.name ?? id;
  const renderProjects = () => {
    const model = modelSelect.value, firmware = firmwareSelect.value;
    const projects = info.homebrew.map(project => ({ project, state: consoleCompatibility(project, model, firmware) }));
    projects.sort((a, b) => Number(b.state.startsWith('Documented')) - Number(a.state.startsWith('Documented')));
    for (const [id, kinds] of [['console-emulation', ['emulation']], ['console-emulation-research', ['emulation-research']], ['console-entrypoints', ['entrypoint']], ['console-kernel', ['kernel', 'research']], ['console-linux', ['linux']], ['console-homebrew', ['payload/app']], ['console-rollback', ['rollback']], ['console-recovery', ['recovery']], ['console-tools', ['tool', 'usb-tool']]]) {
      byId(String(id)).replaceChildren(...projects.filter(({ project }) => kinds.includes(project.kind)).map(({ project, state }) => h('article', { id: projectId(project), className: 'console-project', tabIndex: -1 },
        h('div', { className: 'console-project-heading' }, h('h3', { textContent: project.name })),
        'availability' in project ? h('p', { className: 'console-project-availability', textContent: project.availability }) : null,
        h('p', { textContent: project.summary }),
        h('p', { className: 'field-help', textContent: `Models: ${project.models.map(modelName).join(', ')} · Firmware: ${project.firmware}` }),
        'runtime' in project ? h('p', { className: 'field-help', textContent: `Runs via: ${project.runtime}${'systems' in project ? ` · Systems: ${project.systems}` : ''}` }) : null,
        h('details', { className: 'console-project-details' }, h('summary', { textContent: 'Compatibility & setup' }),
          ...project.compatibility.map(rule => h('p', { className: 'field-help', textContent: `${rule.models.map(modelName).join(', ')}: ${rule.supportedFirmware.length ? rule.supportedFirmware.join(', ') : 'No exact firmware list published'}. ${rule.note ?? ''}` })),
          project.requirements.length ? h('div', {}, h('strong', { textContent: 'Requires' }), h('ul', {}, ...project.requirements.map(text => h('li', { textContent: text })))) : null),
        ...project.warnings.map(text => h('p', { className: 'console-project-warning', textContent: text })),
        h('div', { className: 'console-project-links' }, external(project.source, 'Project guide ↗'), ...project.links.filter(link => link.url !== project.source).map(link => external(link.url, `${link.label} ↗`))),
        h('p', { className: 'field-help', textContent: `Sources checked ${project.checkedDate}` }))));
    }
    const matches = projects.filter(({ project, state }) => project.kind === 'entrypoint' && state.startsWith('Documented'));
    byId('console-match-status').replaceChildren(
      h('strong', { textContent: !model || !firmware ? 'Choose both a model and firmware to find your starting point.' : matches.length ? `Starting points for ${modelName(model)} · ${firmware}` : 'No starting point lists this combination yet.' }),
      ...(!model || !firmware ? [] : matches.map(({ project }) => h('a', { className: 'console-match-link', href: `#${projectId(project)}`, textContent: `${project.name} — show this project ↓`, onclick() {
        const card = byId(projectId(project));
        card.focus({ preventScroll: true });
        card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      } }))),
      h('p', { className: 'field-help', textContent: 'These are first steps, not a complete jailbreak setup. Read the project’s requirements before starting. All projects remain listed below.' }));
    const url = new URL(location.href);
    for (const [key, value] of [['model', model], ['firmware', firmware]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    history.replaceState(null, '', url);
  };
  const changeSelection = () => {
    if (location.hash.startsWith('#project-')) history.replaceState(null, '', location.pathname + location.search);
    renderProjects();
  };
  modelSelect.addEventListener('change', changeSelection);
  firmwareSelect.addEventListener('change', changeSelection);
  renderProjects();

  byId('console-sources').replaceChildren(...(info.sources ?? []).map(source => {
    const anchor = external(source.url, source.label);
    return anchor ? h('li', {}, anchor) : null;
  }).filter(Boolean));
  if (!info.sources?.length) byId('console-sources').replaceChildren(h('li', { textContent: 'Sources are listed with each firmware and homebrew record.' }));
  byId('console-communities').replaceChildren(...info.communities.map(community => h('article', { className: 'console-project' }, h('h3', {}, external(community.url, community.name)), h('p', { textContent: community.description }), h('p', { className: 'field-help' }, external(community.source, 'Published by / source ↗'), ` · checked ${community.checkedDate}`))));
}

byId('console-report').append(reportBox());
byId('submit-request').dataset.railLabel = 'T · Report';
document.body.append(progressRail([...document.querySelectorAll('[data-rail-label]')].map(element => /** @type {HTMLElement} */ (element))));
for (const link of document.querySelectorAll('a[href="#submit-request"]')) link.addEventListener('click', () => { byId('submit-request').setAttribute('open', ''); });
void mountAccount();
