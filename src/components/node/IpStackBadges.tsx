// 仅按有无展示 V4/V6 标识，不渲染 IP 本身
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
