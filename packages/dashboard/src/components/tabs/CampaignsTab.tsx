import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { ChartTooltip } from '../ui/ChartTooltip';
import { SkeletonTable, SkeletonChart } from '../ui/Skeleton';
import type { Contact } from '../../types';
import type { Campaign } from '../../hooks/useApi';

interface Props {
  contacts: Contact[];
  campaignList: Campaign[];
  loading: boolean;
}

export default function CampaignsTab({ contacts, campaignList, loading }: Props) {
  const campaignPerformance = useMemo(() => {
    if (!campaignList.length || !contacts.length) return [];
    const contactByEmail = new Map(contacts.map(c => [c.email.toLowerCase(), c]));
    return campaignList
      .filter(c => c.status === 'done' || c.status === 'running')
      .map(c => {
        const emails = c.sentEmails || [];
        const matched = emails.map(e => contactByEmail.get(e.toLowerCase())).filter(Boolean);
        const sent = matched.length;
        const opened = matched.filter(m => m!.openCount > 0 || m!.status === 'opened' || m!.status === 'replied').length;
        const replied = matched.filter(m => m!.status === 'replied').length;
        const bounced = matched.filter(m => m!.status === 'bounced').length;
        return {
          ...c,
          perf: {
            sent,
            opened,
            replied,
            bounced,
            openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
            replyRate: sent > 0 ? Math.round((replied / sent) * 100) : 0,
            bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
          },
        };
      });
  }, [campaignList, contacts]);

  if (loading && campaignList.length === 0) {
    return (
      <div className="tab-content">
        <SkeletonTable rows={4} />
        <SkeletonChart height={300} />
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div className="chart-card full">
        <h2>Campaign Performance</h2>
        {campaignPerformance.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>No campaigns tracked yet</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Launch a campaign and its performance will appear here</div>
          </div>
        ) : (
          <table className="leaderboard" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Date</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Opened</th>
                <th>Replied</th>
                <th>Bounced</th>
                <th>Open %</th>
                <th>Reply %</th>
                <th>Bounce %</th>
              </tr>
            </thead>
            <tbody>
              {campaignPerformance.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name || c.sheetTab}</td>
                  <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--text-secondary)' }}>
                    {c.startedAt ? new Date(c.startedAt).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td>
                    <span className={`badge ${c.status === 'done' ? 'badge-green' : c.status === 'error' ? 'badge-red' : 'badge-yellow'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td style={{ fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{c.perf.sent}</td>
                  <td style={{ fontFamily: "'DM Mono', monospace" }}>{c.perf.opened}</td>
                  <td style={{ fontFamily: "'DM Mono', monospace" }}>{c.perf.replied}</td>
                  <td style={{ fontFamily: "'DM Mono', monospace" }}>{c.perf.bounced}</td>
                  <td><span className={`badge ${c.perf.openRate > 25 ? 'badge-green' : 'badge-yellow'}`}>{c.perf.openRate}%</span></td>
                  <td><span className={`badge ${c.perf.replyRate > 5 ? 'badge-green' : 'badge-yellow'}`}>{c.perf.replyRate}%</span></td>
                  <td><span className={`badge ${c.perf.bounceRate > 5 ? 'badge-red' : 'badge-green'}`}>{c.perf.bounceRate}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {campaignPerformance.length > 1 && (
        <div className="chart-card full">
          <h2>Campaign Comparison</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={campaignPerformance.map(c => ({
              name: c.name || c.sheetTab,
              'Open %': c.perf.openRate,
              'Reply %': c.perf.replyRate,
              'Bounce %': c.perf.bounceRate,
              sent: c.perf.sent,
            }))} margin={{ top: 12, right: 20, left: -4, bottom: 0 }} barCategoryGap="32%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} tickMargin={8} />
              <YAxis unit="%" tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: "'DM Mono', monospace" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} iconType="circle" iconSize={8}
                formatter={(value: string) => <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}>{value}</span>} />
              <Bar dataKey="Open %" fill="#6366f1" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
              <Bar dataKey="Reply %" fill="#22c55e" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
              <Bar dataKey="Bounce %" fill="#ef4444" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
