import './Skeleton.css';

export function SkeletonBlock({ width, height, radius }: {
  width?: string | number;
  height?: string | number;
  radius?: number;
}) {
  return (
    <div
      className="skeleton-pulse"
      style={{
        width: width || '100%',
        height: height || 16,
        borderRadius: radius ?? 6,
        background: 'var(--border-subtle)',
      }}
    />
  );
}

export function SkeletonKpiStrip() {
  return (
    <div className="kpi-strip">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SkeletonBlock width={80} height={10} />
          <SkeletonBlock width={60} height={28} radius={4} />
          <SkeletonBlock width={100} height={10} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ height }: { height?: number }) {
  return (
    <div className="chart-card full">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SkeletonBlock width={180} height={14} />
        <SkeletonBlock height={height || 260} radius={8} />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows }: { rows?: number }) {
  return (
    <div className="chart-card full" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px' }}>
        <SkeletonBlock width={200} height={14} />
      </div>
      <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: rows || 8 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <SkeletonBlock width={28} height={28} radius={14} />
            <SkeletonBlock width="30%" height={12} />
            <SkeletonBlock width="15%" height={12} />
            <SkeletonBlock width="10%" height={12} />
            <SkeletonBlock width="10%" height={12} />
            <SkeletonBlock width="10%" height={12} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonTabContent() {
  return (
    <div className="tab-content">
      <SkeletonChart height={260} />
      <div className="charts-row">
        <SkeletonChart height={240} />
        <SkeletonChart height={240} />
      </div>
    </div>
  );
}
