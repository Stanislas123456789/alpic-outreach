import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Line, Legend,
  AreaChart, Area, ReferenceLine,
} from 'recharts';
import { ChartTooltip } from '../ui/ChartTooltip';
import { INDUSTRY_COLORS, STATUS_COLORS } from '../ui/constants';
import { SkeletonChart } from '../ui/Skeleton';
import type { Contact, IndustryMetrics } from '../../types';
import type { FollowUpTouchMetrics } from '../../hooks/useSheets';
import type { GlobalStats } from '../../hooks/useGlobalStats';

type DateRange = '7d' | '30d' | '90d' | 'all';

interface Props {
  contacts: Contact[];
  industryMetrics: IndustryMetrics[];
  funnel: { stage: string; value: number; color: string }[];
  followUpMetrics: { touch1: FollowUpTouchMetrics; touch2: FollowUpTouchMetrics; touch3: FollowUpTouchMetrics };
  loading: boolean;
  onAddSource: () => void;
  globalStats?: GlobalStats | null;
}

function EmptyState({ onAddSource }: { onAddSource: () => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 400, gap: 24, textAlign: 'center', padding: '48px 24px',
    }}>
      <div style={{ fontSize: 48 }}>📋</div>
      <div>
        <h2 style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
          Connect your first campaign sheet
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 420, margin: 0, lineHeight: 1.6 }}>
          Link a Google Sheets spreadsheet to start tracking contacts, open rates, and replies in real time.
        </p>
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start',
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '20px 28px', maxWidth: 380,
      }}>
        {[
          { n: '1', text: 'Open your Google Sheet' },
          { n: '2', text: 'Copy the URL or the ID from the address bar' },
          { n: '3', text: 'Paste it below — we\'ll handle the rest' },
        ].map(s => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'var(--accent)22', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}>{s.n}</div>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>{s.text}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onAddSource}
        style={{
          background: 'var(--accent)', color: 'white', border: 'none',
          borderRadius: 10, padding: '14px 32px', fontSize: 15, fontWeight: 700,
          cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
        }}
      >
        + Connect a Sheet
      </button>
    </div>
  );
}

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  const opts: { id: DateRange; label: string }[] = [
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: '90d', label: '90 days' },
    { id: 'all', label: 'All time' },
  ];
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 8, padding: 2, border: '1px solid var(--border-subtle)' }}>
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
            background: value === o.id ? 'var(--accent)' : 'transparent',
            color: value === o.id ? 'white' : 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function filterByDateRange(contacts: Contact[], range: DateRange): Contact[] {
  if (range === 'all') return contacts;
  const now = Date.now();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return contacts.filter(c => {
    if (!c.sentAt) return false;
    return new Date(c.sentAt).getTime() >= cutoff;
  });
}

export default function OverviewTab({ contacts: rawContacts, industryMetrics: rawIndustryMetrics, funnel: rawFunnel, followUpMetrics: rawFollowUpMetrics, loading, onAddSource, globalStats }: Props) {
  const contacts = rawContacts || [];
  const industryMetrics = rawIndustryMetrics || [];
  const funnel = rawFunnel || [];
  const emptyTouch = { sent: 0, opened: 0, replied: 0, unsubscribed: 0, openRate: 0, replyRate: 0, unsubRate: 0 };
  const followUpMetrics = rawFollowUpMetrics || { touch1: emptyTouch, touch2: emptyTouch, touch3: emptyTouch };
  const [dateRange, setDateRange] = useState<DateRange>('all');

  const rangedContacts = useMemo(() => filterByDateRange(contacts, dateRange), [contacts, dateRange]);

  const dailyMetrics = useMemo(() => {
    const map = new Map<string, { date: string; sent: number; opened: number; replied: number; bounced: number }>();
    for (const c of rangedContacts) {
      if (!c.sentAt) continue;
      const date = c.sentAt.slice(0, 10);
      if (!map.has(date)) map.set(date, { date, sent: 0, opened: 0, replied: 0, bounced: 0 });
      const d = map.get(date)!;
      d.sent++;
      if (c.status === 'opened' || c.openCount > 0) d.opened++;
      if (c.status === 'replied') { d.opened++; d.replied++; }
      if (c.status === 'bounced') d.bounced++;
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [rangedContacts]);

  // Build charts from global stats when in "All Weeks" mode
  const globalFunnel = useMemo(() => {
    if (!globalStats) return null;
    return [
      { stage: 'Sent', value: globalStats.totalContacted, color: '#6366f1' },
      { stage: 'Delivered', value: globalStats.totalContacted - globalStats.totalBounced, color: '#818cf8' },
      { stage: 'Opened', value: globalStats.totalOpened + globalStats.totalReplied, color: '#a78bfa' },
      { stage: 'Replied', value: globalStats.totalReplied, color: '#22c55e' },
    ];
  }, [globalStats]);

  const globalIndustryMetrics = useMemo(() => {
    if (!globalStats?.byIndustryDetailed) return null;
    return Object.entries(globalStats.byIndustryDetailed)
      .filter(([ind]) => ind !== 'Unknown')
      .map(([industry, data]) => ({
        industry,
        replyRate: data.contacted > 0 ? Math.round((data.replied / data.contacted) * 100) : 0,
        total: data.total,
        contacted: data.contacted,
      }))
      .sort((a, b) => b.replyRate - a.replyRate);
  }, [globalStats]);

  const globalStatusData = useMemo(() => {
    if (!globalStats?.byStatus) return null;
    return globalStats.byStatus;
  }, [globalStats]);

  if (!loading && contacts.length === 0) {
    return <EmptyState onAddSource={onAddSource} />;
  }

  return (
    <div className="tab-content">
      {/* Daily Send Activity */}
      {dailyMetrics.length > 0 ? (
        <div className="chart-card full">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Daily Send Activity</h2>
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={dailyMetrics} margin={{ top: 12, right: 20, left: -4, bottom: 0 }}>
              <defs>
                <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.20} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradReplied" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: "'DM Mono', monospace" }}
                axisLine={false} tickLine={false} tickMargin={8}
                tickFormatter={d => {
                  const dt = new Date(d + 'T12:00:00');
                  return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
                }}
              />
              <YAxis
                tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: "'DM Mono', monospace" }}
                axisLine={false} tickLine={false} tickMargin={4}
                allowDecimals={false}
              />
              <Tooltip
                content={<ChartTooltip labelFormatter={(d: string) => {
                  const dt = new Date(d + 'T12:00:00');
                  return dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                }} />}
                cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                iconType="circle" iconSize={8}
                formatter={(value: string) => <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}>{value}</span>}
              />
              <Area type="monotone" dataKey="sent" name="Sent" stroke="#6366f1" strokeWidth={2}
                fill="url(#gradSent)" dot={false} activeDot={{ r: 4, fill: '#6366f1', stroke: 'rgba(99,102,241,0.2)', strokeWidth: 8 }} />
              <Area type="monotone" dataKey="opened" name="Opened" stroke="#8b5cf6" strokeWidth={2}
                fill="url(#gradOpened)" dot={false} activeDot={{ r: 4, fill: '#8b5cf6', stroke: 'rgba(139,92,246,0.2)', strokeWidth: 8 }} />
              <Area type="monotone" dataKey="replied" name="Replied" stroke="#22c55e" strokeWidth={2}
                fill="url(#gradReplied)" dot={false} activeDot={{ r: 4, fill: '#22c55e', stroke: 'rgba(34,197,94,0.2)', strokeWidth: 8 }} />
              <Line type="monotone" dataKey="bounced" name="Bounced" stroke="#ef4444" strokeWidth={1.5}
                dot={false} activeDot={{ r: 3, fill: '#ef4444', stroke: 'rgba(239,68,68,0.2)', strokeWidth: 6 }} strokeDasharray="5 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : loading ? (
        <SkeletonChart height={300} />
      ) : null}

      <div className="charts-row">
        {/* Funnel */}
        <div className="chart-card wide">
          <h2>Pipeline Funnel</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={funnel} margin={{ top: 12, right: 20, left: -4, bottom: 0 }} barCategoryGap="32%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="stage"
                tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}
                axisLine={false} tickLine={false} tickMargin={8}
              />
              <YAxis
                tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: "'DM Mono', monospace" }}
                axisLine={false} tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }} />
              <Bar dataKey="value" radius={[6, 6, 2, 2]} animationDuration={600}>
                {funnel.map((entry, index) => (
                  <Cell key={index} fill={entry.color} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status breakdown */}
        <div className="chart-card">
          <h2>Status Breakdown</h2>
          <div className="status-list">
            {Object.entries(STATUS_COLORS).map(([status, color]) => {
              const count = contacts.filter(c => c.status === status).length;
              const pct = contacts.length > 0 ? Math.round((count / contacts.length) * 100) : 0;
              return (
                <div key={status} className="status-row">
                  <div className="status-dot" style={{ background: color, color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span className="status-name">{status}</span>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>{pct}%</span>
                    </div>
                    <div className="status-bar-wrap">
                      <div className="status-bar" style={{ width: `${pct}%`, background: color, opacity: pct === 0 ? 0.2 : 1 }} />
                    </div>
                  </div>
                  <span className="status-count">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Reply Rate by Industry */}
      <div className="chart-card full">
        <h2>Reply Rate by Industry</h2>
        <ResponsiveContainer width="100%" height={Math.max(180, industryMetrics.length * 52)}>
          <BarChart data={industryMetrics} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={true} horizontal={false} />
            <XAxis
              type="number" unit="%" tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              type="category" dataKey="industry" width={155}
              tick={{ fill: 'var(--text)', fontSize: 12, fontWeight: 500 }}
              axisLine={false} tickLine={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }} />
            <ReferenceLine x={10} stroke="var(--text-muted)" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: '10% target', position: 'top', fill: 'var(--text-muted)', fontSize: 10 }} />
            <Bar dataKey="replyRate" radius={[0, 8, 8, 0]} name="Reply Rate" label={{
              position: 'right',
              formatter: (v: number) => v > 0 ? `${v}%` : '',
              fill: 'var(--text-secondary)',
              fontSize: 11,
            }}>
              {industryMetrics.map((entry, index) => (
                <Cell key={index} fill={INDUSTRY_COLORS[entry.industry] || '#6366f1'} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Follow-up Performance */}
      {(followUpMetrics.touch2.sent > 0 || followUpMetrics.touch3.sent > 0) && (
        <div className="chart-card full">
          <h2>Follow-up Performance</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={[
                { name: 'Initial', 'Open Rate': followUpMetrics.touch1.openRate, 'Reply Rate': followUpMetrics.touch1.replyRate, 'Unsub Rate': followUpMetrics.touch1.unsubRate },
                { name: 'Follow-up 1', 'Open Rate': followUpMetrics.touch2.openRate, 'Reply Rate': followUpMetrics.touch2.replyRate, 'Unsub Rate': followUpMetrics.touch2.unsubRate },
                { name: 'Follow-up 2', 'Open Rate': followUpMetrics.touch3.openRate, 'Reply Rate': followUpMetrics.touch3.replyRate, 'Unsub Rate': followUpMetrics.touch3.unsubRate },
              ]}
              margin={{ top: 12, right: 20, left: -4, bottom: 0 }}
              barCategoryGap="32%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}
                axisLine={false} tickLine={false} tickMargin={8}
              />
              <YAxis
                unit="%" domain={[0, 100]}
                tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: "'DM Mono', monospace" }}
                axisLine={false} tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                iconType="circle" iconSize={8}
                formatter={(value: string) => <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}>{value}</span>}
              />
              <ReferenceLine y={25} stroke="var(--text-muted)" strokeDasharray="3 3" strokeOpacity={0.4} label={{ value: '25% avg open', position: 'right', fill: 'var(--text-muted)', fontSize: 10 }} />
              <Bar dataKey="Open Rate" fill="#6366f1" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
              <Bar dataKey="Reply Rate" fill="#22c55e" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
              <Bar dataKey="Unsub Rate" fill="#ef4444" radius={[6, 6, 2, 2]} fillOpacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
