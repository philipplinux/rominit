import { progressRail } from './progress-rail.js';
import { CONSOLES, consoleCompatibility } from '../src/consoles/index.js';
import { CONSOLE_SECTIONS, consoleCopy } from '../src/consoles/labels.js';
import { familyOf } from '../src/consoles/families.js';
import { h } from './dom.js';
import { officialSupportText } from '../src/catalog.js';
import './header-tuck.js';
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
  const copy = consoleCopy(info);
  // Copy fills any [data-copy] hook from the catalog; an unknown hook is left alone rather than printing "undefined".
  for (const element of document.querySelectorAll('[data-copy]')) {
    const value = copy[/** @type {HTMLElement} */ (element).dataset.copy];
    if (value != null) element.textContent = value;
  }
  // The rail repeats the on-page jump wording, so a retitled section keeps its number and reads the same everywhere.
  for (const [name, key] of Object.entries({ entrypoints: 'entrypoints.finder', kernel: 'kernel.finder', linux: 'linux.finder', os: 'os.finder', apps: 'apps.finder', emulation: 'emulation.finder', pc: 'pc.finder', rollback: 'rollback.finder', recovery: 'recovery.finder', tools: 'tools.finder' })) {
    const element = byId(`console-${name}-section`);
    element.dataset.railLabel = `${element.dataset.railLabel.split(' · ')[0]} · ${copy[key]}`;
  }
  const media = info.media ?? {};
  for (const [id, item] of Object.entries({ 'console-logo': media.logo, 'console-photo': media.photo })) {
    const image = byId(id);
    if (item) Object.assign(image, { src: `./${item.src}`, alt: item.alt, width: item.width, height: item.height });
    else if (id === 'console-photo') image.closest('figure')?.remove();
    else image.remove();
  }
  if (media.photo) byId('console-photo-credit').append(external(media.photo.page, `Photo: ${media.photo.artist} · ${/^CC0/.test(media.photo.license) ? 'CC0' : media.photo.license}`));
  byId('console-image-credits').replaceChildren(...Object.values(media).map(item => h('p', {}, external(item.page, `${item.artist} · ${item.license}`))));
  byId('console-latest').replaceChildren(...(info.highlights ?? []).map(highlight => h('article', { className: 'flash-card console-highlight' },
    h('p', { className: 'eyebrow', textContent: highlight.title }), h('h2', { textContent: highlight.name }),
    h('p', { className: 'console-highlight-firmware', textContent: highlight.firmware }), h('p', { textContent: highlight.summary }),
    h('div', { className: 'console-project-links' }, document.getElementById(highlight.target) ? h('a', { href: `#${highlight.target}`, textContent: 'See options & requirements ↓' }) : null, external(highlight.source, 'Upstream ↗')),
    h('small', { className: 'field-help', textContent: `Sources checked ${highlight.checkedDate}` }))));
  byId('console-meta').replaceChildren(...[
    h('span', { className: 'architecture-tag', textContent: info.manufacturer }),
    info.releaseYear && h('span', { className: 'architecture-tag', textContent: `Released ${info.releaseYear}` }),
    info.officialSupport && h('a', { className: 'architecture-tag', href: info.officialSupport.source, target: '_blank', rel: 'noopener noreferrer', textContent: officialSupportText(info.officialSupport, `${info.manufacturer} firmware:`) })
  ].filter(Boolean));
  const family = familyOf(info.id);
  if (family) byId('console-meta').append(h('a', { className: 'architecture-tag', href: `./${family.id}.html`, textContent: `${family.name} family` }));
  if (!info.highlights?.length) byId('console-latest').hidden = true;
  if (!info.communities?.length) byId('console-community-section').hidden = true;
  const firmware = info.firmware;
  byId('console-firmware').textContent = firmware.version ?? 'not verified';
  byId('console-firmware-checked').textContent = firmware.checkedDate ? `checked ${firmware.checkedDate}` : 'needs a dated check';
  const firmwareSource = external(firmware.source, 'source ↗');
  if (firmwareSource) byId('console-firmware-source').append(firmwareSource);

  // How open each model is, per layer, derived from the projects' documented firmware lists, never typed by hand.
  const layers = [['Unofficial code', project => project.kind === 'entrypoint'], ['Kernel', project => project.kind === 'kernel'],
    ['Hypervisor', project => project.access === 'hypervisor'], ['Linux', project => project.kind === 'linux']];
  const byVersion = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  byId('console-models').replaceChildren(...info.models.map(model => {
    const variant = info.variants?.find(v => v.model === model.name);
    const versionsFor = test => [...new Set(info.homebrew.filter(test).flatMap(project => project.compatibility
      .filter(rule => rule.status === 'documented' && rule.models.includes(model.id)).flatMap(rule => rule.supportedFirmware)))].sort(byVersion);
    const entry = versionsFor(layers[0][1]);
    const verdict = entry.includes(firmware.shortVersion) ? ['yes', `Open on current firmware ${firmware.shortVersion}`] : entry.length ? ['older', `Older firmware only · not ${firmware.shortVersion}`] : ['none', 'No documented entry point'];
    return h('article', { className: 'console-variant' },
      h('h3', { textContent: `${model.name}${variant?.releaseYear ? ` · ${variant?.releaseYear}` : ''}` }),
      h('p', { className: `console-jb-verdict console-jb-${verdict[0]}`, textContent: verdict[1] }),
      h('div', {}, ...layers.map(([label, test]) => { const list = versionsFor(test);
        // A deeper layer only counts where this model also has a documented entry point on that firmware.
        const stranded = list.length && test !== layers[0][1] && !list.some(version => entry.includes(version));
        return h('span', { className: `console-jb-layer${!list.length ? ' console-jb-none' : stranded ? ' console-jb-older' : ''}`, title: stranded ? `Documented for ${list.join(', ')}, but no entry point is documented for this model on those versions` : '',
          textContent: `${label} ${!list.length ? '–' : stranded ? 'no entry point yet' : list.length < 3 ? list.join(', ') : `up to ${list.at(-1)}`}` }); })),
      h('details', { className: 'console-project-details' }, h('summary', { textContent: 'Hardware specs' }),
        h('dl', { className: 'console-facts' }, ...factRows({ storage: variant?.storage, ...variant?.specs }, { storage: 'Storage', ...facts }))),
      variant?.notes ? h('details', { className: 'console-project-details' }, h('summary', { textContent: 'Model numbers & notes' }), h('p', { textContent: `${variant?.region ? `${variant?.region}. ` : ''}${variant?.notes}` })) : null);
  }));

  const modelSelect = /** @type {HTMLSelectElement} */ (byId('console-model'));
  modelSelect.append(...info.models.map(model => h('option', { value: model.id, textContent: model.name })));
  const firmwareSelect = /** @type {HTMLSelectElement} */ (byId('console-installed-firmware'));
  const versions = [...new Set([firmware.shortVersion, ...(info.firmwareOptions ?? []),
    ...info.homebrew.flatMap(project => project.compatibility.flatMap(rule => rule.supportedFirmware))])].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  firmwareSelect.append(...versions.map(version => h('option', { value: version, textContent: version })), h('option', { value: 'unlisted', textContent: 'Other / unlisted firmware' }));
  const params = new URLSearchParams(location.search);
  if (info.models.some(model => model.id === params.get('model'))) modelSelect.value = params.get('model');
  if (params.has('firmware')) firmwareSelect.value = versions.includes(params.get('firmware')) ? params.get('firmware') : 'unlisted';
  const modelName = id => info.models.find(model => model.id === id)?.name ?? id;
  /** Page section id, project kinds shown there, label in the route finder. */
  const sections = CONSOLE_SECTIONS.map(([name, kinds]) => [`console-${name === 'apps' ? 'homebrew' : name === 'research' ? 'emulation-research' : name}`, kinds, copy[`${name}.finder`]]);
  const renderProjects = () => {
    const model = modelSelect.value, firmware = firmwareSelect.value;
    const projects = info.homebrew.map(project => ({ project, state: consoleCompatibility(project, model, firmware) }));
    projects.sort((a, b) => Number(b.state.startsWith('Documented')) - Number(a.state.startsWith('Documented')));
    for (const [id, kinds] of sections) {
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
        h('div', { className: 'console-project-links' }, project.page ? h('a', { href: `./${project.page}`, textContent: 'ROMinit page →' }) : null, external(project.source, 'Project guide ↗'), ...project.links.filter(link => link.url !== project.source).map(link => external(link.url, `${link.label} ↗`))),
        h('p', { className: 'field-help', textContent: `Sources checked ${project.checkedDate}` }))));
    }
    const listsModel = project => project.compatibility.some(rule => rule.models.includes(model));
    const fw = firmware && firmware !== 'unlisted' ? ` · ${firmware}` : '';
    const groups = [{ title: `Documented for ${modelName(model)}${fw}`, items: projects.filter(({ state }) => state.startsWith('Documented')) },
      { title: copy['finder.unconfirmed'].replace('{model}', modelName(model)), items: projects.filter(({ project, state }) => state === 'Unverified' && listsModel(project)) }].filter(({ items }) => items.length);
    const link = project => h('a', { className: 'console-match-link', href: `#${projectId(project)}`, textContent: project.name, onclick() {
      const card = byId(projectId(project));
      for (let fold = card.closest('details'); fold; fold = fold.parentElement?.closest('details') ?? null) fold.open = true;
      card.focus({ preventScroll: true });
      card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } });
    byId('console-match-status').replaceChildren(
      h('strong', { textContent: !model ? 'Choose your model to see the projects that list it.' : groups.length ? `Projects for ${modelName(model)}${fw}` : 'No project lists this combination yet.' }),
      ...(!model ? [] : groups.flatMap(({ title, items }) => [h('h3', { className: 'console-match-group', textContent: `${title} (${items.length})` }),
        ...sections.flatMap(([, kinds, label]) => {
          const inSection = items.filter(({ project }) => kinds.includes(project.kind));
          return inSection.length ? [h('div', { className: 'console-match-row' }, h('span', { className: 'console-match-section', textContent: label }), ...inSection.map(({ project }) => link(project)))] : [];
        })])),
      h('p', { className: 'field-help', textContent: copy['finder.note'] }));
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
  // Sections with nothing to show (a console without Linux, say) step out of the page and the jump nav.
  for (const section of document.querySelectorAll('[data-section]')) {
    if ([...section.querySelectorAll('.console-homebrew')].some(container => container.children.length)) continue;
    /** @type {HTMLElement} */ (section).hidden = true;
    document.querySelector(`[data-jump="${/** @type {HTMLElement} */ (section).dataset.section}"]`)?.setAttribute('hidden', '');
  }
  // Renumber the visible milestones so a hidden section leaves no gap; the PS5 shows them all and keeps 0–13.
  [...document.querySelectorAll('[data-rail-label]')].filter(element => !(/** @type {HTMLElement} */ (element).hidden)).forEach((element, index) => {
    const [number, label] = /** @type {HTMLElement} */ (element).dataset.railLabel.split(' · ');
    if (/^\d+$/.test(number)) /** @type {HTMLElement} */ (element).dataset.railLabel = `${index} · ${label}`;
  });

  byId('console-sources').replaceChildren(...(info.sources ?? []).map(source => {
    const anchor = external(source.url, source.label);
    return anchor ? h('li', {}, anchor) : null;
  }).filter(Boolean));
  if (!info.sources?.length) byId('console-sources').replaceChildren(h('li', { textContent: 'Sources are listed with each firmware and homebrew record.' }));
  byId('console-communities').replaceChildren(...(info.communities ?? []).map(community => h('article', { className: 'console-project' }, h('h3', {}, external(community.url, community.name)), h('p', { textContent: community.description }), h('p', { className: 'field-help' }, external(community.source, 'Published by / source ↗'), ` · checked ${community.checkedDate}`))));
}

byId('console-report').append(reportBox());
byId('submit-request').dataset.railLabel = 'T · Report';
document.body.append(progressRail([...document.querySelectorAll('[data-rail-label]')].filter(element => !(/** @type {HTMLElement} */ (element).hidden)).map(element => /** @type {HTMLElement} */ (element))));
for (const link of document.querySelectorAll('a[href="#submit-request"]')) link.addEventListener('click', () => { byId('submit-request').setAttribute('open', ''); });
void mountAccount();
