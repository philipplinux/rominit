// OS data lives in catalog/os/<pc|mobile|network>/<id>.json: official release metadata, reviewed and pinned by hand (sha256/size/url), not a live download-page scrape.
// Add an OS: write its JSON in catalog/os/<pc|mobile|network>/, import it below and add it to OSES (test/os-catalog.test.js fails on a JSON missing here; the browser and Workers bundles cannot read the folder); the build writes dist/<id>.html from site/os.html.
import alpineJson from '../../catalog/os/pc/alpine.json' with { type: 'json' };
import omarchyJson from '../../catalog/os/pc/omarchy.json' with { type: 'json' };
import ubuntuJson from '../../catalog/os/pc/ubuntu.json' with { type: 'json' };
import fedoraJson from '../../catalog/os/pc/fedora.json' with { type: 'json' };
import debianJson from '../../catalog/os/pc/debian.json' with { type: 'json' };
import linuxMintJson from '../../catalog/os/pc/linux-mint.json' with { type: 'json' };

/** Image formats the CLI writes to a USB disk directly; compressed ones are unpacked while writing. */
export const USB_FORMATS = ['iso', 'img.gz', 'img.bz2', 'img.xz'];

/** @typedef {{ id: string, arch: string, format: string, url: string, sha256: string, size: number, usb: boolean }} OsImage */
/** @typedef {{ id: string, name: string, description: string, usbNote: string, images: OsImage[] }} OsEdition */
/** @typedef {{ label: string, href: string }} OsLink */
/** @typedef {{ page: string, license: string, artist: string }} OsShotPhoto */
/** @typedef {{ description: string, eyebrow: string, intro: string, logo: { src: string, alt: string, width: number, height: number }, pros: string[], cons: string[], links: OsLink[], previewNote: string, shot: { src: string, alt: string, width: number, height: number, bar: string, caption: string, photo?: OsShotPhoto }, status: string, footer: OsLink[], checked: string, credits: string[] }} OsPage */
/** @typedef {{ id: string, name: string, shortName: string, defaultEdition: string, version: string, releaseDate: string, requirements?: { summary: string, note?: string, source: string, checked: string }, kernel?: { version: string, line: string, updates?: string, checked: string, source: string }, source: string, officialSupport: { status: string, until?: string, source: string }, page: OsPage, editions: OsEdition[] }} Os */

/** Every OS page, in the order the site lists them. @type {Os[]} */
export const OSES = [/** @type {Os} */ (alpineJson), /** @type {Os} */ (omarchyJson), /** @type {Os} */ (ubuntuJson), /** @type {Os} */ (fedoraJson), /** @type {Os} */ (debianJson), /** @type {Os} */ (linuxMintJson)];

/** CPU architecture to family label. */
export const ARCH_FAMILY = { x86: "x86", x86_64: "x86", aarch64: "ARM", armv7: "ARM", armhf: "ARM", loongarch64: "LoongArch", ppc64le: "PowerPC", riscv64: "RISC-V", s390x: "IBM Z" };

/** CPU architectures present in an OS's official media. @param {Os} os */
export const osArchitectures = os => [...new Set(os.editions.flatMap(edition => edition.images.map(image => image.arch)))];

/** Resolve only a bundled artifact (with its OS and edition), never a caller-supplied URL. @param {string} id */
export const osImageEntry = id => {
  for (const os of OSES) for (const edition of os.editions) {
    const image = edition.images.find(entry => entry.id === id);
    if (image) return { os, edition, image };
  }
};

/** @param {string} id */
export const osImage = id => osImageEntry(id)?.image;
