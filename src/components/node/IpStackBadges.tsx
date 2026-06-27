// V4/V6 双栈标识：后端仅在登录态下发真实 ipv4/ipv6，前端只读"有没有"来亮对应标签，
// 不渲染 IP 本身。两种卡片共用，样式由 .ip-stack-badge 提供（仅字样）。
export function IpStackBadges({
  ipv4,
  ipv6,
}: {
  ipv4?: string | null;
  ipv6?: string | null;
}) {
  if (!ipv4 && !ipv6) return null;
  return (
    <>
      {ipv4 ? <span className="ip-stack-badge" data-tag="green">V4</span> : null}
      {ipv6 ? <span className="ip-stack-badge" data-tag="green">V6</span> : null}
    </>
  );
}
