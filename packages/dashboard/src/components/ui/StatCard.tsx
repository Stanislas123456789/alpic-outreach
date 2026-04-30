export function StatCard({ label, value, sub, color, trend }: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  trend?: { value: number; label: string };
}) {
  const c = color || 'var(--accent)';
  return (
    <div className="stat-card" style={{ '--stat-color': c } as React.CSSProperties}>
      <div style={{
        position: 'absolute', top: '20%', left: 0, bottom: '20%', width: '2px',
        background: c, borderRadius: '0 2px 2px 0', opacity: 0.5,
      }} />
      <div className="stat-label">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div className="stat-value" style={{ color: c }}>{value}</div>
        {trend && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: trend.value > 0 ? 'var(--green)' : trend.value < 0 ? 'var(--red)' : 'var(--text-muted)',
            display: 'inline-flex', alignItems: 'center', gap: 2,
            fontFamily: "'DM Mono', monospace",
          }}>
            {trend.value > 0 ? '↑' : trend.value < 0 ? '↓' : '→'}{Math.abs(trend.value)}%
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", marginLeft: 2 }}>
              {trend.label}
            </span>
          </span>
        )}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
