// Shared, non-visual bits between NodeCard and CompactNodeCard. The two cards
// deliberately use different class names / layout, so their markup is NOT shared
// — only logic and copy that would otherwise drift if edited in one place.

/** Title + aria-label for the "view instance details" link in a node card header. */
export function nodeDetailLinkLabels(name: string, osName: string) {
  return {
    title: `${osName} · 查看详情`,
    ariaLabel: `查看 ${name} 详情，系统 ${osName}`,
  };
}
