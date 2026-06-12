export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className="inline-block animate-spin rounded-full border-2 border-[var(--border-subtle)] border-t-[var(--accent-500)]"
      style={{ width: size, height: size }}
    />
  );
}
