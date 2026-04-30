import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { ChartTooltip } from '../ui/ChartTooltip';
import { SkeletonTable, SkeletonChart } from '../ui/Skeleton';
import type { RepMetrics } from '../../types';

function ScoreBadge({ rate }: { rate: number }) {
  const stars = rate >= 20 ? 5 : rate >= 15 ? 4 : rate >= 10 ? 3 : rate >= 5 ? 2 : 1;
  return <span className="score-badge">{'⭐'.repeat(stars)}</span>;
}

interface Props {
  repMetrics: RepMetrics[];
  loading: boolean;
}

export default function RepsTab({ repMetrics: rawRepMetrics, loading }: Props) {
  const repMetrics = rawRepMetrics || [];
  if (loading && repMetrics.length === 0) {
    return (
      <div className="tab-content">
        <SkeletonTable rows={5} />
        <SkeletonChart height={280} />
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div className="chart-card full">
        <h2>Rep Leaderboard</h2>
        <table className="leaderboard">
          <thead>
            <tr>
              <th>#</th>
              <th>Rep</th>
              <th>Sent</th>
              <th>Bounce %</th>
              <th>Open %</th>
              <th>Reply %</th>
              <th>Replies</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {repMetrics.map((rep, i) => (
              <tr key={rep.repEmail} className={i === 0 ? 'top-rep' : ''}>
                <td className="rank">{i + 1}</td>
                <td className="rep-name">
                  <div className="rep-avatar">{rep.repName[0].toUpperCase()}</div>
                  {rep.repName}
                </td>
                <td>{rep.sent}</td>
                <td>
                  <span className={`badge ${rep.bounceRate > 5 ? 'badge-red' : 'badge-green'}`}>
                    {rep.bounceRate}%
                  </span>
                </td>
                <td>
                  <span className={`badge ${rep.openRate > 25 ? 'badge-green' : 'badge-yellow'}`}>
                    {rep.openRate}%
                  </span>
                </td>
                <td>
                  <span className={`badge ${rep.replyRate > 10 ? 'badge-green' : 'badge-yellow'}`}>
                    {rep.replyRate}%
                  </span>
                </td>
                <td>{rep.replied}</td>
                <td><ScoreBadge rate={rep.replyRate} /></td>
              </tr>
            ))}
            {repMetrics.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '48px 24px' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>👥</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>No rep data yet</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Send some emails and rep metrics will appear here</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {repMetrics.length > 0 && (
        <div className="chart-card full">
          <h2>Rep Performance Comparison</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={repMetrics} margin={{ top: 10, right: 16, left: -8, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="repName" tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} tickMargin={8} />
              <YAxis unit="%" tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: "'DM Mono', monospace" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} iconType="circle" iconSize={8}
                formatter={(value: string) => <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}>{value}</span>} />
              <Bar dataKey="openRate" name="Open Rate" fill="#6366f1" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
              <Bar dataKey="replyRate" name="Reply Rate" fill="#22c55e" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
              <Bar dataKey="bounceRate" name="Bounce Rate" fill="#ef4444" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
