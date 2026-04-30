import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { ChartTooltip } from '../ui/ChartTooltip';
import { INDUSTRY_COLORS } from '../ui/constants';
import { SkeletonChart } from '../ui/Skeleton';
import type { IndustryMetrics } from '../../types';

interface Props {
  industryMetrics: IndustryMetrics[];
  loading: boolean;
}

export default function IndustriesTab({ industryMetrics: rawIndustryMetrics, loading }: Props) {
  const industryMetrics = rawIndustryMetrics || [];
  if (loading && industryMetrics.length === 0) {
    return (
      <div className="tab-content">
        <SkeletonChart height={300} />
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div className="industry-grid">
        {industryMetrics.map(ind => (
          <div key={ind.industry} className="industry-card">
            <div className="industry-header">
              <div className="industry-dot" style={{ background: INDUSTRY_COLORS[ind.industry] || '#6366f1' }} />
              <h3>{ind.industry}</h3>
            </div>

            <div className="ind-funnel">
              <div className="funnel-track">
                <div className="funnel-segment funnel-delivered" style={{ width: '100%' }} />
                <div className="funnel-segment funnel-opened" style={{ width: `${ind.openRate}%` }} />
                <div className="funnel-segment funnel-replied" style={{ width: `${ind.replyRate}%` }} />
              </div>
            </div>

            <div className="industry-stats">
              <div className="ind-stat"><span>Sent</span><strong>{ind.sent}</strong></div>
              <div className="ind-stat"><span>Bounced</span><strong style={{ color: '#f87171' }}>{ind.bounced}</strong></div>
              <div className="ind-stat"><span>Opened</span><strong style={{ color: '#a78bfa' }}>{ind.opened}</strong></div>
              <div className="ind-stat"><span>Replied</span><strong style={{ color: '#34d399' }}>{ind.replied}</strong></div>
            </div>
            <div className="ind-rates">
              <div className="rate-bar">
                <span>Open</span>
                <div className="rate-track">
                  <div className="rate-fill" style={{ width: `${ind.openRate}%`, background: '#a78bfa' }} />
                </div>
                <span>{ind.openRate}%</span>
              </div>
              <div className="rate-bar">
                <span>Reply</span>
                <div className="rate-track">
                  <div className="rate-fill" style={{ width: `${ind.replyRate}%`, background: '#34d399' }} />
                </div>
                <span>{ind.replyRate}%</span>
              </div>
            </div>
          </div>
        ))}
        {industryMetrics.length === 0 && (
          <div style={{ padding: '48px 24px', textAlign: 'center', gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🏭</div>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>No industry data yet</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Send some emails and industry breakdowns will appear here</div>
          </div>
        )}
      </div>

      {industryMetrics.length > 0 && (
        <div className="chart-card full" style={{ marginTop: 8 }}>
          <h2>Industry Performance</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={industryMetrics} margin={{ top: 10, right: 16, left: -8, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="industry" tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} tickMargin={8} />
              <YAxis unit="%" domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: "'DM Mono', monospace" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} iconType="circle" iconSize={8}
                formatter={(value: string) => <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}>{value}</span>} />
              <Bar dataKey="openRate" name="Open Rate %" fill="#a78bfa" radius={[6, 6, 2, 2]} fillOpacity={0.8} />
              <Bar dataKey="replyRate" name="Reply Rate %" fill="#34d399" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
              <Bar dataKey="bounceRate" name="Bounce Rate %" fill="#f87171" radius={[6, 6, 2, 2]} fillOpacity={0.6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
