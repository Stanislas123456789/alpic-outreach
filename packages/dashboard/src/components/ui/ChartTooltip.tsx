export function ChartTooltip({ active, payload, label, labelFormatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--card-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '14px 16px',
      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.04)',
      minWidth: 160,
      backdropFilter: 'blur(12px)',
    }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: 'var(--text)',
        marginBottom: 10, paddingBottom: 8,
        borderBottom: '1px solid var(--border-subtle)',
        letterSpacing: '-0.01em',
      }}>
        {labelFormatter ? labelFormatter(label) : label}
      </div>
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, padding: '3px 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{entry.name}</span>
          </div>
          <span style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text)',
            fontVariantNumeric: 'tabular-nums', fontFamily: "'DM Mono', monospace",
          }}>
            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}
