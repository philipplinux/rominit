// Generic console-page wording, overridable per catalog entry with a `copy` object keyed by section.
// {manufacturer} keeps vendor-specific sentences honest without hard-coding one console's name in the site.
/** Page sections in display order, with the project kinds each one holds. Every kind a catalog uses must appear here. */
export const CONSOLE_SECTIONS = [
  ['entrypoints', ['entrypoint']],
  ['kernel', ['kernel', 'research', 'hardmod']],
  ['linux', ['linux']],
  ['os', ['os']],
  ['apps', ['payload/app']],
  ['emulation', ['emulation']],
  ['research', ['emulation-research']],
  ['pc', ['pc-port']],
  ['rollback', ['rollback']],
  ['kernel', ['kernel', 'research', 'hardmod']],
  ['recovery', ['recovery']],
  ['tools', ['tool', 'usb-tool']]
];

export const DEFAULT_COPY = {
  entrypoints: {
    title: 'Jailbreak: where to start',
    nav: 'Jailbreak routes',
    finder: 'Jailbreak routes',
    note: 'An entry point is the first way to run community-made code on your console. Different routes use different apps, discs or browser features, and work only on certain models, hardware revisions or firmware versions.'
  },
  kernel: {
    title: 'Deeper access: kernel & hypervisor',
    finder: 'Deeper access',
    note: 'These projects unlock more of the console after the first entry point. That extra access can let homebrew use features {manufacturer} normally locks away. They are steps in a larger setup, rather than apps you simply install.'
  },
  linux: {
    title: 'Linux or Android',
    nav: 'Linux',
    finder: 'Linux',
    note: 'Linux and Android images run the console as a computer or tablet instead of its stock system. You need a supported entry route and usually a separate SD card or USB drive.'
  },
  models: {
    note: 'Chips show what each layer is documented for by the projects below. A route can depend on the model, a hardware revision or the firmware; lists have gaps, so check your exact console in the route finder. Updating past a documented version can close a route.',
    firmwareLabel: 'Current official firmware'
  },
  finder: {
    help: 'Pick your model, plus the firmware where the projects depend on it. The box below links to every project that lists your model, documented ones first. Open each project’s setup notes for the apps or equipment you need.',
    note: 'Documented means the project names this console (model, hardware revision or firmware) explicitly. Projects listed as "exact support not confirmed" name your model without an exact firmware list: check their notes first. These are first steps, not a complete setup. All projects remain listed below.',
    unconfirmed: 'Lists {model}, exact support not confirmed'
  },
  os: {
    title: 'Operating systems',
    nav: 'OS',
    finder: 'OS',
    note: 'A handheld or computer-like console can boot its stock system, a Linux distribution or a console-style OS. The installs, drivers and trade-offs for each model are listed on the entries below.'
  },
  apps: {
    title: 'Homebrew apps & launchers',
    finder: 'Homebrew apps',
    note: 'Once you have a working entry point, these tools help load, manage or run community-made apps. Check the setup notes to see which loader each one needs.'
  },
  emulation: {
    title: 'Emulation',
    nav: 'Emulation',
    finder: 'Emulation',
    note: 'Emulators let your console play games made for other systems. Some run as native homebrew; others need Linux installed first. The systems and setup needed are listed on each card. Performance varies by game.'
  },
  research: {
    title: 'Source-only emulation research',
    finder: 'Emulation research'
  },
  pc: {
    title: 'Play your games on other devices',
    nav: 'Games elsewhere',
    finder: 'Games elsewhere',
    link: 'Play your games on other devices ↓',
    note: 'The reverse of the section above: instead of other systems on your console, your console’s games on a computer. These tools convert games you dumped from your own console. Nothing is installed on the console, but dumping a game needs a jailbroken console first.'
  },
  rollback: {
    title: 'Firmware rollback & research',
    nav: 'Rollback',
    finder: 'Rollback',
    note: 'Rollback means going back to older system software, often to reach a jailbreak-compatible version. An old update file alone does not make that possible. Recovery reinstalls software; a backup may only work on the console it came from.'
  },
  recovery: {
    title: 'Restore the official system software',
    nav: 'Recovery',
    finder: 'Recovery',
    note: 'Use these links when the console needs {manufacturer}’s system software repaired or reinstalled. A full reinstall erases console data. Older files in an archive do not bypass {manufacturer}’s update restrictions.'
  },
  tools: {
    title: 'Desktop, USB & development tools',
    nav: 'USB & desktop tools',
    finder: 'Tools',
    note: 'A USB image writer prepares a drive; a payload sender uses an existing loader. Neither is automatically a firmware flasher.'
  }
};

/** Section copy for one console, flattened to `section.field` and with `{manufacturer}` filled in.
 * @param {{manufacturer?: string, copy?: Record<string, Record<string, string>>}} entry */
export const consoleCopy = entry => Object.fromEntries(Object.entries(DEFAULT_COPY).flatMap(([section, fields]) =>
  Object.entries({ ...fields, ...entry.copy?.[section] })
    .map(([field, text]) => [`${section}.${field}`, text.replaceAll('{manufacturer}', entry.manufacturer ?? 'the maker')])));
