// OS data lives in catalog/os/<id>.json: official release metadata, reviewed and pinned by hand (sha256/size/url), not a live download-page scrape.
// Checked 2026-10-20 for Alpine. Add an OS: drop its JSON there and list it below; the build writes dist/<id>.html from site/os.html.
import alpineJson from '../../catalog/os/alpine.json' with { type: 'json' };

/** @typedef {{ id: string, arch: string, format: string, url: string, sha256: string, size: number, usb: boolean }} OsImage */
/** @typedef {{ id: string, name: string, description: string, usbNote: string, images: OsImage[] }} OsEdition */
/** @typedef {{ label: string, href: string }} OsLink */
/** @typedef {{ description: string, eyebrow: string, intro: string, logo: { src: string, alt: string, width: number, height: number }, pros: string[], cons: string[], links: OsLink[], previewNote: string, shot: { src: string, alt: string, width: number, height: number, bar: string, caption: string }, status: string, footer: OsLink[], checked: string, credits: string[] }} OsPage */
/** @typedef {{ id: string, name: string, shortName: string, defaultEdition: string, version: string, releaseDate: string, kernel?: { version: string, line: string, updates?: string, checked: string, source: string }, source: string, page: OsPage, editions: OsEdition[] }} Os */

/** Every OS page. @type {Os[]} */
export const OSES = [/** @type {Os} */ (alpineJson)];

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
