// Console family hubs. A hub is a signpost: name, one line and the family's consoles.
// `page` marks a console with a ROMinit research page; everything else is listed as "no page yet".
export const FAMILIES = [
  {
    id: 'playstation',
    name: 'PlayStation',
    summary: 'Sony’s home consoles and handhelds, from PlayStation 2 to PS5 and Vita.',
    consoles: [
      { name: 'PlayStation 2', year: 2000 },
      { name: 'PlayStation Portable', year: 2004 },
      { name: 'PlayStation 3', year: 2006 },
      { name: 'PlayStation Vita', year: 2011 },
      { name: 'PlayStation 4', year: 2013 },
      { name: 'PlayStation 5', page: 'ps5', status: 'Jailbreak routes, Linux and emulation research' }
    ]
  },
  {
    id: 'nintendo',
    name: 'Nintendo',
    summary: 'Nintendo’s home consoles and handhelds, from DS and Wii to Switch.',
    consoles: [
      { name: 'Nintendo DS', year: 2004 },
      { name: 'Wii', year: 2006 },
      { name: 'Nintendo 3DS', year: 2011 },
      { name: 'Wii U', year: 2012 },
      { name: 'Nintendo Switch', page: 'switch', status: 'Entry point depends on the hardware revision' },
      { name: 'Nintendo Switch 2' }
    ]
  },
  {
    id: 'anbernic',
    name: 'Anbernic',
    summary: 'Anbernic’s retro handhelds, where the operating system lives on an SD card.',
    consoles: [
      { name: 'RG35XX family', page: 'rg35xx', status: 'Linux-based custom firmware on the SD card' },
      { name: 'RG35XX H' },
      { name: 'RG405' },
      { name: 'RG505' },
      { name: 'RG556' }
    ]
  },
  {
    id: 'asus-rog-ally',
    name: 'ASUS ROG Ally',
    summary: 'ASUS’s Windows handhelds: ROG Ally, Ally X and Xbox Ally.',
    consoles: [
      { name: 'ROG Ally', year: 2023, page: 'rog-ally', status: 'Windows handheld; SteamOS and Bazzite alternatives' },
      { name: 'ROG Ally X', year: 2024, page: 'rog-ally', status: 'Covered on the ROG Ally research page' },
      { name: 'Xbox Ally' }
    ]
  }
];

/** The hub whose list links a console page; the family list is the only place that mapping lives.
 * @param {string} consoleId */
export const familyOf = consoleId => FAMILIES.find(family => family.consoles.some(item => item.page === consoleId));
