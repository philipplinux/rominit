// OS data lives in catalog/os/<pc|mobile|network>/<id>.json: official release metadata, reviewed and pinned by hand (sha256/size/url), not a live download-page scrape.
// Add an OS: write its JSON in catalog/os/<pc|mobile|network>/, import it below and add it to OSES (test/os-catalog.test.js fails on a JSON missing here; the browser and Workers bundles cannot read the folder); the build writes dist/<id>.html from site/os.html.
import alpineJson from '../../catalog/os/pc/alpine.json' with { type: 'json' };
import slitazJson from '../../catalog/os/pc/slitaz.json' with { type: 'json' };
import q4osJson from '../../catalog/os/pc/q4os.json' with { type: 'json' };
import pclinuxosJson from '../../catalog/os/pc/pclinuxos.json' with { type: 'json' };
import blissOsJson from '../../catalog/os/pc/bliss-os.json' with { type: 'json' };
import xcpNgJson from '../../catalog/os/pc/xcp-ng.json' with { type: 'json' };
import harvesterJson from '../../catalog/os/pc/harvester.json' with { type: 'json' };
import flatcarContainerLinuxJson from '../../catalog/os/pc/flatcar-container-linux.json' with { type: 'json' };
import serenityosJson from '../../catalog/os/pc/serenityos.json' with { type: 'json' };
import puppyLinuxJson from '../../catalog/os/pc/puppy-linux.json' with { type: 'json' };
import pearosJson from '../../catalog/os/pc/pearos.json' with { type: 'json' };
import rockstorJson from '../../catalog/os/pc/rockstor.json' with { type: 'json' };
import pureosJson from '../../catalog/os/pc/pureos.json' with { type: 'json' };
import sparkylinuxJson from '../../catalog/os/pc/sparkylinux.json' with { type: 'json' };
import xigmanasJson from '../../catalog/os/pc/xigmanas.json' with { type: 'json' };
import universalBlueJson from '../../catalog/os/pc/universal-blue.json' with { type: 'json' };
import gpartedLiveJson from '../../catalog/os/pc/gparted-live.json' with { type: 'json' };
import biglinuxJson from '../../catalog/os/pc/biglinux.json' with { type: 'json' };
import elementaryOsJson from '../../catalog/os/pc/elementary-os.json' with { type: 'json' };
import endlessOsJson from '../../catalog/os/pc/endless-os.json' with { type: 'json' };
import chimeraosJson from '../../catalog/os/pc/chimeraos.json' with { type: 'json' };
import bazziteJson from '../../catalog/os/pc/bazzite.json' with { type: 'json' };
import chromeosFlexJson from '../../catalog/os/pc/chromeos-flex.json' with { type: 'json' };
import adalieLinuxJson from '../../catalog/os/pc/adalie-linux.json' with { type: 'json' };
import ventoyJson from '../../catalog/os/pc/ventoy.json' with { type: 'json' };
import rescuezillaJson from '../../catalog/os/pc/rescuezilla.json' with { type: 'json' };
import ultramarineLinuxJson from '../../catalog/os/pc/ultramarine-linux.json' with { type: 'json' };
import ipfireJson from '../../catalog/os/pc/ipfire.json' with { type: 'json' };
import trisquelJson from '../../catalog/os/pc/trisquel.json' with { type: 'json' };
import guixSystemJson from '../../catalog/os/pc/guix-system.json' with { type: 'json' };
import dragonflyBsdJson from '../../catalog/os/pc/dragonfly-bsd.json' with { type: 'json' };
import parrotOsJson from '../../catalog/os/pc/parrot-os.json' with { type: 'json' };
import omniosJson from '../../catalog/os/pc/omnios.json' with { type: 'json' };
import midnightbsdJson from '../../catalog/os/pc/midnightbsd.json' with { type: 'json' };
import openeulerJson from '../../catalog/os/pc/openeuler.json' with { type: 'json' };
import nomadbsdJson from '../../catalog/os/pc/nomadbsd.json' with { type: 'json' };
import lakkaJson from '../../catalog/os/pc/lakka.json' with { type: 'json' };
import proxmoxVeJson from '../../catalog/os/pc/proxmox-ve.json' with { type: 'json' };
import redoxJson from '../../catalog/os/pc/redox.json' with { type: 'json' };
import unraidJson from '../../catalog/os/pc/unraid.json' with { type: 'json' };
import talosLinuxJson from '../../catalog/os/pc/talos-linux.json' with { type: 'json' };
import truenasJson from '../../catalog/os/pc/truenas.json' with { type: 'json' };
import reactosJson from '../../catalog/os/pc/reactos.json' with { type: 'json' };
import opnsenseJson from '../../catalog/os/pc/opnsense.json' with { type: 'json' };
import pfsenseJson from '../../catalog/os/pc/pfsense.json' with { type: 'json' };
import slackwareJson from '../../catalog/os/pc/slackware.json' with { type: 'json' };
import openmediavaultJson from '../../catalog/os/pc/openmediavault.json' with { type: 'json' };
import endeavourosJson from '../../catalog/os/pc/endeavouros.json' with { type: 'json' };
import vanillaOsJson from '../../catalog/os/pc/vanilla-os.json' with { type: 'json' };
import fydeosJson from '../../catalog/os/pc/fydeos.json' with { type: 'json' };
import whonixJson from '../../catalog/os/pc/whonix.json' with { type: 'json' };
import systemrescueJson from '../../catalog/os/pc/systemrescue.json' with { type: 'json' };
import libreelecJson from '../../catalog/os/pc/libreelec.json' with { type: 'json' };
import windowsJson from '../../catalog/os/pc/windows.json' with { type: 'json' };
import vyosJson from '../../catalog/os/pc/vyos.json' with { type: 'json' };
import kaosJson from '../../catalog/os/pc/kaos.json' with { type: 'json' };
import openwrtJson from '../../catalog/os/pc/openwrt.json' with { type: 'json' };
import freedosJson from '../../catalog/os/pc/freedos.json' with { type: 'json' };
import androidX86Json from '../../catalog/os/pc/android-x86.json' with { type: 'json' };
import batoceraJson from '../../catalog/os/pc/batocera.json' with { type: 'json' };
import omarchyJson from '../../catalog/os/pc/omarchy.json' with { type: 'json' };
import almalinuxJson from '../../catalog/os/pc/almalinux.json' with { type: 'json' };
import antiXJson from '../../catalog/os/pc/anti-x.json' with { type: 'json' };
import archLinuxJson from '../../catalog/os/pc/arch-linux.json' with { type: 'json' };
import bodhiLinuxJson from '../../catalog/os/pc/bodhi-linux.json' with { type: 'json' };
import cachyosJson from '../../catalog/os/pc/cachyos.json' with { type: 'json' };
import armbianJson from '../../catalog/os/pc/armbian.json' with { type: 'json' };
import artixJson from '../../catalog/os/pc/artix.json' with { type: 'json' };
import calculateLinuxJson from '../../catalog/os/pc/calculate-linux.json' with { type: 'json' };
import centosStreamJson from '../../catalog/os/pc/centos-stream.json' with { type: 'json' };
import clonezillaJson from '../../catalog/os/pc/clonezilla.json' with { type: 'json' };
import debianJson from '../../catalog/os/pc/debian.json' with { type: 'json' };
import deepinJson from '../../catalog/os/pc/deepin.json' with { type: 'json' };
import devuanJson from '../../catalog/os/pc/devuan.json' with { type: 'json' };
import dietpiJson from '../../catalog/os/pc/dietpi.json' with { type: 'json' };
import fedoraJson from '../../catalog/os/pc/fedora.json' with { type: 'json' };
import freebsdJson from '../../catalog/os/pc/freebsd.json' with { type: 'json' };
import garudaLinuxJson from '../../catalog/os/pc/garuda-linux.json' with { type: 'json' };
import gentooJson from '../../catalog/os/pc/gentoo.json' with { type: 'json' };
import ghostbsdJson from '../../catalog/os/pc/ghostbsd.json' with { type: 'json' };
import haikuJson from '../../catalog/os/pc/haiku.json' with { type: 'json' };
import kaliLinuxJson from '../../catalog/os/pc/kali-linux.json' with { type: 'json' };
import linuxLiteJson from '../../catalog/os/pc/linux-lite.json' with { type: 'json' };
import linuxMintJson from '../../catalog/os/pc/linux-mint.json' with { type: 'json' };
import mageiaJson from '../../catalog/os/pc/mageia.json' with { type: 'json' };
import macosJson from '../../catalog/os/pc/macos.json' with { type: 'json' };
import manjaroJson from '../../catalog/os/pc/manjaro.json' with { type: 'json' };
import mxLinuxJson from '../../catalog/os/pc/mx-linux.json' with { type: 'json' };
import nobaraJson from '../../catalog/os/pc/nobara.json' with { type: 'json' };
import openbsdJson from '../../catalog/os/pc/openbsd.json' with { type: 'json' };
import openindianaJson from '../../catalog/os/pc/openindiana.json' with { type: 'json' };
import netbsdJson from '../../catalog/os/pc/netbsd.json' with { type: 'json' };
import nixosJson from '../../catalog/os/pc/nixos.json' with { type: 'json' };
import oracleLinuxJson from '../../catalog/os/pc/oracle-linux.json' with { type: 'json' };
import peppermintOsJson from '../../catalog/os/pc/peppermint-os.json' with { type: 'json' };
import popOsJson from '../../catalog/os/pc/pop-os.json' with { type: 'json' };
import rhelJson from '../../catalog/os/pc/rhel.json' with { type: 'json' };
import raspberryPiOsJson from '../../catalog/os/pc/raspberry-pi-os.json' with { type: 'json' };
import retropieJson from '../../catalog/os/pc/retropie.json' with { type: 'json' };
import qubesOsJson from '../../catalog/os/pc/qubes-os.json' with { type: 'json' };
import rockyLinuxJson from '../../catalog/os/pc/rocky-linux.json' with { type: 'json' };
import slesJson from '../../catalog/os/pc/sles.json' with { type: 'json' };
import solusJson from '../../catalog/os/pc/solus.json' with { type: 'json' };
import steamosJson from '../../catalog/os/pc/steamos.json' with { type: 'json' };
import tailsJson from '../../catalog/os/pc/tails.json' with { type: 'json' };
import ubuntuJson from '../../catalog/os/pc/ubuntu.json' with { type: 'json' };
import opensuseJson from '../../catalog/os/pc/opensuse.json' with { type: 'json' };
import voidLinuxJson from '../../catalog/os/pc/void-linux.json' with { type: 'json' };
import zorinOsJson from '../../catalog/os/pc/zorin-os.json' with { type: 'json' };
import mikrotikRouterosJson from '../../catalog/os/pc/mikrotik-routeros.json' with { type: 'json' };

/** Image formats the CLI writes to a USB disk directly; compressed ones are unpacked while writing. */
export const USB_FORMATS = ['iso', 'img.gz', 'img.bz2', 'img.xz'];

/** @typedef {{ id: string, arch: string, format: string, url: string, sha256?: string, sha256Url?: string, sha256Computed?: string, sha512?: string, sha512Url?: string, size: number, usb: boolean }} OsImage */
/** @typedef {{ id: string, name: string, description: string, usbNote: string, images: OsImage[] }} OsEdition */
/** @typedef {{ label: string, href: string }} OsLink */
/** @typedef {{ page: string, license: string, artist: string }} OsShotPhoto */
/** @typedef {{ description: string, eyebrow: string, intro: string, logo: { src: string, alt: string, width: number, height: number }, pros: string[], cons: string[], links: OsLink[], previewNote: string, shot?: { src: string, alt: string, width: number, height: number, bar: string, caption: string, photo?: OsShotPhoto }, status: string, footer: OsLink[], checked: string, credits: string[] }} OsPage */
/** @typedef {{ id: string, name: string, shortName: string, defaultEdition: string, version: string, releaseDate: string, requirements?: { summary: string, note?: string, source: string, checked: string }, kernel?: { version: string, line: string, updates?: string, checked: string, source: string }, source: string, officialSupport: { status: string, until?: string, source: string }, page: OsPage, editions: OsEdition[], infoOnly?: boolean }} Os */

/** Every OS page, in the order the site lists them. @type {Os[]} */
export const OSES = [/** @type {Os} */ (alpineJson), /** @type {Os} */ (omarchyJson), /** @type {Os} */ (almalinuxJson), /** @type {Os} */ (antiXJson), /** @type {Os} */ (archLinuxJson), /** @type {Os} */ (bodhiLinuxJson), /** @type {Os} */ (cachyosJson), /** @type {Os} */ (armbianJson), /** @type {Os} */ (artixJson), /** @type {Os} */ (calculateLinuxJson), /** @type {Os} */ (centosStreamJson), /** @type {Os} */ (clonezillaJson), /** @type {Os} */ (debianJson), /** @type {Os} */ (deepinJson), /** @type {Os} */ (devuanJson), /** @type {Os} */ (dietpiJson), /** @type {Os} */ (fedoraJson), /** @type {Os} */ (freebsdJson), /** @type {Os} */ (garudaLinuxJson), /** @type {Os} */ (gentooJson), /** @type {Os} */ (ghostbsdJson), /** @type {Os} */ (haikuJson), /** @type {Os} */ (kaliLinuxJson), /** @type {Os} */ (linuxLiteJson), /** @type {Os} */ (linuxMintJson), /** @type {Os} */ (mageiaJson), /** @type {Os} */ (macosJson), /** @type {Os} */ (manjaroJson), /** @type {Os} */ (mxLinuxJson), /** @type {Os} */ (nobaraJson), /** @type {Os} */ (openbsdJson), /** @type {Os} */ (openindianaJson), /** @type {Os} */ (netbsdJson), /** @type {Os} */ (nixosJson), /** @type {Os} */ (oracleLinuxJson), /** @type {Os} */ (peppermintOsJson), /** @type {Os} */ (popOsJson), /** @type {Os} */ (rhelJson), /** @type {Os} */ (raspberryPiOsJson), /** @type {Os} */ (retropieJson), /** @type {Os} */ (qubesOsJson), /** @type {Os} */ (rockyLinuxJson), /** @type {Os} */ (slesJson), /** @type {Os} */ (solusJson), /** @type {Os} */ (steamosJson), /** @type {Os} */ (tailsJson), /** @type {Os} */ (ubuntuJson), /** @type {Os} */ (opensuseJson), /** @type {Os} */ (voidLinuxJson), /** @type {Os} */ (zorinOsJson), /** @type {Os} */ (batoceraJson), /** @type {Os} */ (androidX86Json), /** @type {Os} */ (freedosJson), /** @type {Os} */ (openwrtJson), /** @type {Os} */ (kaosJson), /** @type {Os} */ (vyosJson), /** @type {Os} */ (windowsJson), /** @type {Os} */ (libreelecJson), /** @type {Os} */ (systemrescueJson), /** @type {Os} */ (whonixJson), /** @type {Os} */ (fydeosJson), /** @type {Os} */ (vanillaOsJson), /** @type {Os} */ (endeavourosJson), /** @type {Os} */ (openmediavaultJson), /** @type {Os} */ (slackwareJson), /** @type {Os} */ (pfsenseJson), /** @type {Os} */ (opnsenseJson), /** @type {Os} */ (reactosJson), /** @type {Os} */ (truenasJson), /** @type {Os} */ (talosLinuxJson), /** @type {Os} */ (unraidJson), /** @type {Os} */ (redoxJson), /** @type {Os} */ (proxmoxVeJson), /** @type {Os} */ (lakkaJson), /** @type {Os} */ (nomadbsdJson), /** @type {Os} */ (openeulerJson), /** @type {Os} */ (midnightbsdJson), /** @type {Os} */ (omniosJson), /** @type {Os} */ (parrotOsJson), /** @type {Os} */ (dragonflyBsdJson), /** @type {Os} */ (guixSystemJson), /** @type {Os} */ (trisquelJson), /** @type {Os} */ (ipfireJson), /** @type {Os} */ (ultramarineLinuxJson), /** @type {Os} */ (rescuezillaJson), /** @type {Os} */ (ventoyJson), /** @type {Os} */ (adalieLinuxJson), /** @type {Os} */ (chromeosFlexJson), /** @type {Os} */ (bazziteJson), /** @type {Os} */ (chimeraosJson), /** @type {Os} */ (endlessOsJson), /** @type {Os} */ (elementaryOsJson), /** @type {Os} */ (biglinuxJson), /** @type {Os} */ (gpartedLiveJson), /** @type {Os} */ (universalBlueJson), /** @type {Os} */ (xigmanasJson), /** @type {Os} */ (sparkylinuxJson), /** @type {Os} */ (pureosJson), /** @type {Os} */ (rockstorJson), /** @type {Os} */ (pearosJson), /** @type {Os} */ (puppyLinuxJson), /** @type {Os} */ (serenityosJson), /** @type {Os} */ (flatcarContainerLinuxJson), /** @type {Os} */ (harvesterJson), /** @type {Os} */ (xcpNgJson), /** @type {Os} */ (blissOsJson), /** @type {Os} */ (pclinuxosJson), /** @type {Os} */ (q4osJson), /** @type {Os} */ (slitazJson), /** @type {Os} */ (mikrotikRouterosJson)];

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

/** Publishers that ship no SHA-256 still need a verifiable pin: sha512 is the fallback, and both may be present. */
const DIGEST = { sha256: /^[a-f0-9]{64}$/, sha512: /^[a-f0-9]{128}$/ };
/** What is wrong with one image's pin; empty means usable. @param {any} image @returns {string[]} */
export const osImagePinProblems = image => {
  const out = [];
  if (!image?.sha256 && !image?.sha512) out.push(`${image?.id}: needs a sha256 or sha512 pin`);
  for (const algorithm of /** @type {const} */ (['sha256', 'sha512'])) {
    const digest = image?.[algorithm], url = image?.[`${algorithm}Url`];
    if (digest !== undefined && !DIGEST[algorithm].test(digest)) out.push(`${image?.id}: ${algorithm} must be ${algorithm === 'sha512' ? 128 : 64} lowercase hex`);
    if (url !== undefined && (digest === undefined || !/^https:\/\//.test(url))) out.push(`${image?.id}: ${algorithm}Url needs an https url and a ${algorithm} pin`);
  }
  // A hash ROMinit computed itself has no publisher file to link, and says when it was computed.
  if (image?.sha256Computed !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(image.sha256Computed)) out.push(`${image?.id}: sha256Computed must be an ISO date`);
    else if (Number.isNaN(Date.parse(image.sha256Computed))) out.push(`${image?.id}: sha256Computed is not a real date`);
    if (image.sha256 === undefined) out.push(`${image?.id}: sha256Computed needs a sha256 pin`);
    if (image.sha256Url !== undefined) out.push(`${image?.id}: a computed sha256 has no publisher checksum url`);
  }
  return out;
};
/** A screenshot is credited under a free licence, or — second choice — as the publisher's own screenshot with the terms the site states. */
export const OS_PHOTO_LICENCE = /^(CC0|CC BY(-SA)? [\d.]+|(?:GPL|LGPL|MPL|FDL)(?: [\d.]+)?|Publisher screenshot(?: \([^)]*\)|, .+)?)$/;
/** A photo page may be Commons or the project's own site; both must be https, with artist and licence stated. @param {any} photo @returns {string[]} */
export const osPhotoProblems = photo => [
  ...(photo?.page && /^https:\/\//.test(photo.page) ? [] : ['photo needs an https source page']),
  ...(photo?.artist ? [] : ['photo needs an artist']),
  ...(OS_PHOTO_LICENCE.test(photo?.license ?? '') ? [] : ['photo needs a free licence or a publisher-screenshot credit']),
];
/** Structural problems with one OS record. The site resolves ids separately, so this stays pure. @param {any} os @returns {string[]} */
export const osRecordProblems = os => {
  const out = [];
  if (!/^[a-z0-9-]+$/.test(os?.id ?? '')) out.push('id must be lowercase kebab-case');
  // An info-only product page has no release to date; everything else needs a version and date.
  const named = os?.name && os?.shortName && os?.source;
  if (!named || (os?.infoOnly !== true && !(os?.version && os?.releaseDate))) out.push(`${os?.id}: name, shortName, source and (unless info-only) version and releaseDate are required`);
  else if (new URL(os.source).protocol !== 'https:') out.push(`${os.id}: source must be https`);
  const page = os?.page ?? {};
  const images = (os?.editions ?? []).flatMap((/** @type {any} */ edition) => edition.images ?? []);
  if (os?.infoOnly === true) {
    // Description-only page: no media, no default edition, but links and a status so it is still useful.
    if (os.editions?.length) out.push(`${os.id}: an info-only record carries no editions`);
    if (os.defaultEdition !== undefined) out.push(`${os.id}: an info-only record has no defaultEdition`);
    if (!page.links?.length) out.push(`${os.id}: an info-only record needs links`);
  } else {
    if (!os?.editions?.length) out.push(`${os?.id}: needs editions`);
    else if (!os.editions.some((/** @type {any} */ e) => e.id === os.defaultEdition)) out.push(`${os.id}: default edition does not exist`);
  }
  if (!(page.description && page.eyebrow && page.intro && page.status && page.checked)) out.push(`${os?.id}: page needs description, eyebrow, intro, status and checked`);
  if (!page.pros?.length || !page.cons?.length) out.push(`${os?.id}: page needs pros and cons`);
  if (!page.links?.length || !page.footer?.length || !page.credits?.length) out.push(`${os?.id}: page needs links, footer and credits`);
  if (!page.logo?.src) out.push(`${os?.id}: a logo is required`);
  if (page.shot && !(page.shot.src && page.shot.alt)) out.push(`${os?.id}: a shot needs src and alt`);
  if (new Set(images.map((/** @type {any} */ i) => i.id)).size !== images.length) out.push(`${os?.id}: image ids are not unique`);
  for (const image of images) {
    if (!String(image.id).startsWith(`${os.id}-`)) out.push(`${image.id}: not namespaced by OS`);
    try { if (new URL(image.url).protocol !== 'https:' || new URL(image.url).username) out.push(`${image.id}: url must be https without credentials`); }
    catch { out.push(`${image.id}: url is not a URL`); }
    out.push(...osImagePinProblems(image));
    if (!Number.isSafeInteger(image.size) || image.size <= 0) out.push(`${image.id}: needs a byte size`);
    // only USB_FORMATS write to USB; the rest are download-and-checksum only
    if (!/^(iso|iso\.(bz2|xz|zst)|img\.(gz|bz2|xz|zst)|tar\.gz|zip|ova)$/.test(image.format ?? '')) out.push(`${image.id}: format must be iso, iso.bz2, iso.xz, iso.zst, img.gz, img.bz2, img.xz, img.zst, tar.gz, zip or ova`);
    if (typeof image.usb !== 'boolean') out.push(`${image.id}: usb must be a boolean`);
  }
  return out;
};
