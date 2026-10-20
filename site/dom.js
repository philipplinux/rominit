/** Tiny DOM builder: catalog data only ever lands in text nodes, never in innerHTML.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag @param {Record<string, any>} props @param {any[]} children @returns {HTMLElementTagNameMap[K]} */
export function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(c => c !== null && c !== undefined && c !== false && c !== ''));
  return node;
}
