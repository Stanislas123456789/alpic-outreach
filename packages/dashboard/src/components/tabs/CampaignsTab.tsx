import React, { useMemo, useState } from 'react';
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

interface CampaignPerf extends Campaign {
  perf: {
    sent: number;
    opened: number;
    replied: number;
    bounced: number;
    openRate: number;
    replyRate: number;
    bounceRate: number;
  };
  matchedContacts: Contact[];
  industries: string[];
  senderEmail: string;
}

export default function CampaignsTab({ contacts: rawContacts, campaignList, loading }: Props) {
  const contacts = rawContacts || [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const campaignPerformance = useMemo<CampaignPerf[]>(() => {
    if (!campaignList.length) return [];
    const contactByEmail = new Map(contacts.map(c => [c.email.toLowerCase(), c]));
    return campaignList
      .filter(c => c.status !== 'cancelled')
      .map(c => {
        const emails = c.sentEmails || [];
        const matched = emails.map(e => contactByEmail.get(e.toLowerCase())).filter(Boolean) as Contact[];
        const sent = matched.length || c.sent;
        const opened = matched.filter(m => m.openCount > 0 || m.status === 'opened' || m.status === 'replied').length;
        const replied = matched.filter(m => m.status === 'replied').length;
        const bounced = matched.filter(m => m.status === 'bounced').length;

        // Extract unique industries from matched contacts
        const industrySet = new Set<string>();
        matched.forEach(m => { if (m.industry) industrySet.add(m.industry); });
        const industries = Array.from(industrySet).sort();

        // Sender email from campaign record (stored on creation)
        const senderEmail = c.senderEmail || '';

        return {
          ...c,
          matchedContacts: matched,
          industries,
          senderEmail,
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
          <div style={{ overflowX: 'auto' }}>
            <table className="leaderboard" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Date</th>
                  <th>Sender</th>
                  <th>Industries</th>
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
                  <React.Fragment key={c.id}>
                    <tr
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                      style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                    >
                      <td style={{ fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: expandedId === c.id ? 'rotate(90deg)' : 'none' }}>&#9654;</span>
                          {c.name || c.sheetTab}
                        </div>
                      </td>
                      <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--text-secondary)' }}>
                        {c.startedAt ? new Date(c.startedAt).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {c.senderEmail ? c.senderEmail.split('@')[0] : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {c.industries.length > 0 ? c.industries.slice(0, 3).map(ind => (
                            <span key={ind} style={{
                              background: 'var(--accent)14', color: 'var(--accent)',
                              borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}>{ind}</span>
                          )) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
                          {c.industries.length > 3 && (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{c.industries.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${
                          c.status === 'done' ? 'badge-green' :
                          c.status === 'error' ? 'badge-red' :
                          c.status === 'active' ? 'badge-blue' :
                          c.status === 'running' ? 'badge-green' :
                          c.status === 'paused' ? 'badge-yellow' :
                          c.status === 'scheduled' ? 'badge-yellow' :
                          'badge-yellow'
                        }`}>
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
                    {expandedId === c.id && (
                      <tr>
                        <td colSpan={12} style={{ padding: 0, background: 'var(--bg)' }}>
                          <CampaignDetailPanel campaign={c} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
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

// ── Campaign detail panel (expanded row) ────────────────────────────────────

function CampaignDetailPanel({ campaign }: { campaign: CampaignPerf }) {
  const { matchedContacts } = campaign;
  const [filter, setFilter] = useState<'all' | 'sent' | 'opened' | 'replied' | 'bounced'>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return matchedContacts;
    if (filter === 'opened') return matchedContacts.filter(c => c.openCount > 0 || c.status === 'opened' || c.status === 'replied');
    if (filter === 'replied') return matchedContacts.filter(c => c.status === 'replied');
    if (filter === 'bounced') return matchedContacts.filter(c => c.status === 'bounced');
    return matchedContacts.filter(c => c.status === 'sent' || c.status === 'opened' || c.status === 'replied');
  }, [matchedContacts, filter]);

  const filterBtn = (id: typeof filter, label: string, count: number) => (
    <button
      key={id}
      onClick={() => setFilter(id)}
      style={{
        padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
        border: `1px solid ${filter === id ? 'var(--accent)' : 'var(--border)'}`,
        background: filter === id ? 'var(--accent)14' : 'none',
        color: filter === id ? 'var(--accent)' : 'var(--text-secondary)',
        cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {label} ({count})
    </button>
  );

  if (matchedContacts.length === 0) {
    return (
      <div style={{ padding: '24px 32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        No contact-level data available for this campaign.
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 24px 20px' }}>
      {/* Campaign meta */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
        {campaign.senderEmail && (
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>Sender: </span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{campaign.senderEmail}</span>
          </div>
        )}
        {campaign.industries.length > 0 && (
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>Industries: </span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{campaign.industries.join(', ')}</span>
          </div>
        )}
        {campaign.sheetTab && (
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>Sheet: </span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{campaign.sheetTab}</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {filterBtn('all', 'All', matchedContacts.length)}
        {filterBtn('opened', 'Opened', matchedContacts.filter(c => c.openCount > 0 || c.status === 'opened' || c.status === 'replied').length)}
        {filterBtn('replied', 'Replied', matchedContacts.filter(c => c.status === 'replied').length)}
        {filterBtn('bounced', 'Bounced', matchedContacts.filter(c => c.status === 'bounced').length)}
      </div>

      {/* Contact table */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Company</th>
              <th style={thStyle}>Industry</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Opens</th>
              <th style={thStyle}>Sent At</th>
              <th style={thStyle}>LinkedIn</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={tdStyle}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{c.firstName}</span>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: 'var(--text-secondary)' }}>{c.email}</span>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: 'var(--text)' }}>{c.company}</span>
                </td>
                <td style={tdStyle}>
                  <span style={{
                    background: 'var(--accent)14', color: 'var(--accent)',
                    borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600,
                  }}>{c.industry}</span>
                </td>
                <td style={tdStyle}>
                  <span className={`badge ${
                    c.status === 'replied' ? 'badge-green' :
                    c.status === 'bounced' ? 'badge-red' :
                    (c.status === 'opened' || c.openCount > 0) ? 'badge-blue' :
                    'badge-yellow'
                  }`}>
                    {c.openCount > 0 && c.status === 'sent' ? 'opened' : c.status}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontFamily: "'DM Mono', monospace" }}>
                  {c.openCount}
                </td>
                <td style={{ ...tdStyle, fontFamily: "'DM Mono', monospace", color: 'var(--text-secondary)' }}>
                  {c.sentAt ? new Date(c.sentAt).toLocaleDateString([], { day: '2-digit', month: 'short' }) : '—'}
                </td>
                <td style={tdStyle}>
                  {c.linkedIn ? (
                    <a
                      href={c.linkedIn.startsWith('http') ? c.linkedIn : `https://${c.linkedIn}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#0a66c2', fontWeight: 600, textDecoration: 'none', fontSize: 11 }}
                    >
                      View
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        Showing {filtered.length} of {matchedContacts.length} contacts
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  whiteSpace: 'nowrap',
};
