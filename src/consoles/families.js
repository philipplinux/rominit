// Console family hubs. A hub is a signpost: name, one line and the family's consoles.
// `page` marks a console with a ROMinit research page; everything else is listed as "no page yet".
// A page link gets a deliberately generic line; specifics must live on the page itself.
const research = 'Research page: firmware, homebrew and limits';
export const FAMILIES = [
  {
    id: 'playstation',
    name: 'PlayStation',
    summary: 'Sony\'s home consoles and handhelds, from PlayStation 2 to PS5 and Vita.',
    consoles: [
      { name: 'PlayStation 2', year: 2000, page: 'ps2', status: research },
      { name: 'PlayStation Portable', year: 2004, page: 'psp', status: research },
      { name: 'PlayStation 3', year: 2006, page: 'ps3', status: research },
      { name: 'PlayStation Vita', year: 2011, page: 'vita', status: research },
      { name: 'PlayStation 4', year: 2013, page: 'ps4', status: research },
      { name: 'PlayStation 5', page: 'ps5', status: 'Jailbreak routes, Linux and emulation research' }
    ]
  },
  {
    id: 'nintendo',
    name: 'Nintendo',
    summary: 'Nintendo\'s home consoles and handhelds, from DS and Wii to Switch.',
    consoles: [
      { name: 'Nintendo DS', year: 2004, page: 'ds', status: research },
      { name: 'Wii', year: 2006, page: 'wii', status: research },
      { name: 'Nintendo 3DS', year: 2011, page: '3ds', status: research },
      { name: 'Wii U', year: 2012, page: 'wii-u', status: research },
      { name: 'Nintendo Switch', page: 'switch', status: 'Entry point depends on the hardware revision' },
      { name: 'Nintendo Switch 2' }
    ]
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    summary: 'Microsoft\'s Xbox generations, from the original Xbox to Series X|S.',
    consoles: [
      { name: 'Xbox', year: 2001, page: 'xbox', status: research },
      { name: 'Xbox 360', year: 2005, page: 'xbox360', status: research },
      { name: 'Xbox One', year: 2013, page: 'xboxone', status: research },
      { name: 'Xbox Series X|S', year: 2020, page: 'xboxseries', status: research }
    ]
  },
  {
    id: 'sega',
    name: 'Sega',
    summary: 'Sega\'s last home console, the Dreamcast.',
    consoles: [
      { name: 'Dreamcast', year: 1998, page: 'dreamcast', status: research }
    ]
  },
  {
    id: 'anbernic',
    name: 'Anbernic',
    summary: 'Anbernic\'s retro handhelds, where the operating system lives on an SD card.',
    consoles: [
      { name: 'RG35XX family (incl. RG35XX H)', page: 'rg35xx', status: 'Linux-based custom firmware on the SD card' },
      { name: 'RG405', page: 'rg405', status: research },
      { name: 'RG505', page: 'rg505', status: research },
      { name: 'RG556', page: 'rg556', status: research }
    ]
  },
  {
    id: 'asus-rog-ally',
    name: 'ASUS ROG Ally',
    summary: 'ASUS\'s Windows handhelds: ROG Ally, Ally X and Xbox Ally.',
    consoles: [
      { name: 'ROG Ally and Ally X', year: 2023, page: 'rog-ally', status: 'Windows handhelds; SteamOS and Bazzite alternatives' },
      { name: 'Xbox Ally' }
    ]
  },
  {
    id: 'ayn',
    name: 'AYN',
    summary: 'AYN\'s Android-based handhelds; no verified Linux custom firmware yet.',
    consoles: [
      { name: 'Odin 2', page: 'odin-2', status: 'Android handheld; no community Linux OS found (checked 2026-10-28)' },
      { name: 'Thor', page: 'thor', status: 'Android handheld; no community Linux OS found (checked 2026-10-28)' }
    ]
  },
  {
    id: 'goretroid',
    name: 'GoRetroid',
    summary: 'GoRetroid\'s Android handhelds with KNULLI dual-boot support.',
    consoles: [
      { name: 'Retroid Pocket 5', page: 'retroid-pocket-5', status: 'Snapdragon 865; KNULLI dual-boot from SD card (early release)' },
      { name: 'Retroid Pocket Mini', page: 'retroid-pocket-mini', status: 'Snapdragon 865; KNULLI dual-boot from SD card (early release)' }
    ]
  },
  {
    id: 'miyoo',
    name: 'Miyoo',
    summary: 'Miyoo\'s handhelds; spruceOS frontend and KNULLI SD-card support.',
    consoles: [
      { name: 'A30', page: 'a30', status: 'spruceOS supported (checked 2026-10-28)' },
      { name: 'Flip', page: 'flip', status: 'RK3566; KNULLI needs a GammaLoader patch of the stock firmware first (per KNULLI)' },
      { name: 'Mini v1–4', page: 'mini', status: 'spruceOS supported (checked 2026-10-28)' },
      { name: 'Mini Flip', page: 'mini-flip', status: 'spruceOS supported (checked 2026-10-28)' }
    ]
  },
  {
    id: 'powkiddy',
    name: 'Powkiddy',
    summary: 'Powkiddy\'s RK3566/A133 handhelds; KNULLI and ROCKNIX SD-card support.',
    consoles: [
      { name: 'RGB30', page: 'rgb30', status: 'RK3566; 4" square display; KNULLI/ROCKNIX on SD card' },
      { name: 'X55', page: 'x55', status: 'RK3566; 5.5" display; KNULLI/ROCKNIX on SD card' }
    ]
  },
  {
    id: 'trimui',
    name: 'TriMUI',
    summary: 'TriMUI\'s A133 handhelds; KNULLI and spruceOS support.',
    consoles: [
      { name: 'Brick', page: 'brick', status: 'Allwinner A133P; KNULLI/spruceOS' },
      { name: 'Smart Pro', page: 'smart-pro', status: 'Allwinner A133P; KNULLI/spruceOS' }
    ]
  }
];

/** The hub whose list links a console page; the family list is the only place that mapping lives.
 * @param {string} consoleId */
export const familyOf = consoleId => FAMILIES.find(family => family.consoles.some(item => item.page === consoleId));
