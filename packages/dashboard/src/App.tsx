import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, Legend,
  AreaChart, Area,
} from 'recharts';
import { useAllSheets } from './hooks/useSheets';
import { useAuth } from './hooks/useAuth';
import { useConfig } from './hooks/useConfig';
import { useApi } from './hooks/useApi';
import LoginPage from './components/LoginPage';
import SourceModal from './components/SourceModal';
import SenderPanel from './components/SenderPanel';
import './App.css';

const INDUSTRY_COLORS: Record<string, string> = {
  'Travel': '#6366f1',
  'Insurance': '#f59e0b',
  'SaaS': '#10b981',
  'Ecommerce/Marketplace': '#ef4444',
  'Real Estate': '#8b5cf6',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#64748b',
  sent: '#6366f1',
  opened: '#a78bfa',
  replied: '#34d399',
  bounced: '#f87171',
  invalid: '#fb923c',
};

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  const c = color || 'var(--accent)';
  return (
    <div className="stat-card" style={{ '--stat-color': c } as React.CSSProperties}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: c, opacity: 0.6,
      }} />
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: c }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ScoreBadge({ rate }: { rate: number }) {
  const stars = rate >= 20 ? 5 : rate >= 15 ? 4 : rate >= 10 ? 3 : rate >= 5 ? 2 : 1;
  return <span className="score-badge">{'⭐'.repeat(stars)}</span>;
}

function friendlySheetError(error: string): { message: string; action: string } {
  if (error.includes('No Sheet ID')) return {
    message: 'No spreadsheet connected yet.',
    action: 'Add your Google Sheet ID in settings to start tracking your outreach.',
  };
  if (error.includes('403')) return {
    message: 'Access denied to the spreadsheet.',
    action: 'Make sure the sheet is shared publicly (viewer access) or with the service account.',
  };
  if (error.includes('404')) return {
    message: 'Spreadsheet not found.',
    action: 'Double-check the Sheet ID in settings — it may be incorrect or the sheet was deleted.',
  };
  if (error.includes('400')) return {
    message: 'Invalid spreadsheet configuration.',
    action: 'Check both the Sheet ID and tab name in your settings.',
  };
  return {
    message: 'Could not load spreadsheet data.',
    action: 'Check your internet connection, verify your Sheet ID in settings, and try again.',
  };
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

export default function App() {
  const { user, logout, loginWithKeyword, loginWithGoogle } = useAuth();
  const { sources, activeSource, activeId, setActiveId, addSource, updateSource, deleteSource } = useConfig();
  const { contacts, loading, lastUpdated, refresh, repMetrics, industryMetrics, funnel, stats } = useAllSheets(sources, 30000);
  const error: string | null = null;
  const [activeTab, setActiveTab] = useState<'overview' | 'reps' | 'industries' | 'pipeline' | 'senders'>('overview');
  const [showSources, setShowSources] = useState(false);
  const [showLogoMenu, setShowLogoMenu] = useState(false);
  const [pipelineStatusFilter, setPipelineStatusFilter] = useState<string>('all');
  const [pipelineIndustryFilter, setPipelineIndustryFilter] = useState<string>('all');
  const [pipelineSortCol, setPipelineSortCol] = useState<string>('sentAt');
  const [pipelineSortDir, setPipelineSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterName, setFilterName] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterCountry, setFilterCountry] = useState('all');
  const [filterAssignedTo, setFilterAssignedTo] = useState('all');
  const [filterLinkedIn, setFilterLinkedIn] = useState<'all' | 'yes' | 'no'>('all');
  const [filterOpens, setFilterOpens] = useState<'all' | 'yes'>('all');
  const api = useApi(user);

  // Daily metrics for chronological chart
  const dailyMetrics = useMemo(() => {
    const map = new Map<string, { date: string; sent: number; opened: number; replied: number; bounced: number }>();
    for (const c of contacts) {
      if (!c.sentAt) continue;
      const date = c.sentAt.slice(0, 10); // YYYY-MM-DD
      if (!map.has(date)) map.set(date, { date, sent: 0, opened: 0, replied: 0, bounced: 0 });
      const d = map.get(date)!;
      d.sent++;
      if (c.status === 'opened' || c.openCount > 0) d.opened++;
      if (c.status === 'replied') { d.opened++; d.replied++; }
      if (c.status === 'bounced') d.bounced++;
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [contacts]);

  // Handle post-OAuth redirect: ?tab=senders&connected=true
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'senders') {
      setActiveTab('senders');
      if (params.get('connected')) api.refresh();
      // Clean up the URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  if (!user) return <LoginPage loginWithKeyword={loginWithKeyword} loginWithGoogle={loginWithGoogle} />;

  if (loading && contacts.length === 0) return (
    <div className="loading">
      <div className="loading-spinner" />
      <p>Loading pipeline data...</p>
    </div>
  );

  return (
    <div className="app">
      {showSources && (
        <SourceModal
          sources={sources}
          activeId={activeId}
          onAdd={addSource}
          onUpdate={updateSource}
          onDelete={deleteSource}
          onClose={() => setShowSources(false)}
        />
      )}

      {/* Header */}
      <header className="header">
        <div className="header-left">
          {/* Logo with dropdown menu */}
          <div style={{ position: 'relative' }}>
            <button
              className="logo"
              onClick={() => setShowLogoMenu(v => !v)}
              style={{
                cursor: 'pointer', background: 'none', border: 'none',
                fontFamily: 'inherit', padding: 0, userSelect: 'none',
              }}
              title="Menu"
            >
              ALPIC ▾
            </button>
            {showLogoMenu && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                  onClick={() => setShowLogoMenu(false)}
                />
                <div style={{
                  position: 'absolute', top: '110%', left: 0, zIndex: 100,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: 8, minWidth: 200,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                }}>
                  {([
                    { label: 'Overview', tab: 'overview' as const, icon: '📊' },
                    { label: 'Reps', tab: 'reps' as const, icon: '👥' },
                    { label: 'Industries', tab: 'industries' as const, icon: '🏭' },
                    { label: 'Pipeline', tab: 'pipeline' as const, icon: '📋' },
                  ] as const).map(item => (
                    <button
                      key={item.tab}
                      onClick={() => { setActiveTab(item.tab); setShowLogoMenu(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '10px 14px', border: 'none',
                        background: activeTab === item.tab ? 'var(--accent)22' : 'none',
                        color: activeTab === item.tab ? 'var(--accent)' : 'var(--text)',
                        borderRadius: 8, cursor: 'pointer', fontSize: 13,
                        fontWeight: activeTab === item.tab ? 700 : 500,
                        fontFamily: 'inherit', textAlign: 'left',
                      }}
                    >
                      <span>{item.icon}</span> {item.label}
                    </button>
                  ))}
                  <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                  <button
                    onClick={() => { setShowSources(true); setShowLogoMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px', border: 'none',
                      background: 'none', color: 'var(--text)', borderRadius: 8,
                      cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <span>📁</span> Manage Sheets
                  </button>
                  <button
                    onClick={() => { logout(); setShowLogoMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px', border: 'none',
                      background: 'none', color: '#f87171', borderRadius: 8,
                      cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <span>↩</span> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="header-title">
            <h1>Outreach Pipeline</h1>
            <span className="header-sub">Sales Analytics Dashboard</span>
          </div>
        </div>
        <div className="header-right">
          {/* Source switcher */}
          <div className="source-switcher">
            <select
              className="source-select"
              value={activeId}
              onChange={e => setActiveId(e.target.value)}
            >
              {sources.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className="source-manage-btn" onClick={() => setShowSources(true)} title="Add or manage campaign sheets">
              + Sheet
            </button>
          </div>
          <span className="last-updated">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ''}
          </span>
          <button className="refresh-btn" onClick={refresh}>↻ Refresh</button>
          {/* Launch Campaign CTA — replaces Senders tab */}
          {user?.email?.endsWith('@alpic.ai') && (
            <button
              onClick={() => { setActiveTab('senders'); api.refresh(); }}
              style={{
                background: activeTab === 'senders' ? '#4f46e5' : 'var(--accent)',
                color: 'white', border: 'none', borderRadius: 9,
                padding: '8px 18px', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                display: 'flex', alignItems: 'center', gap: 6,
                boxShadow: '0 2px 8px rgba(99,102,241,0.4)',
              }}
            >
              🚀 Launch Campaign
            </button>
          )}
          <div className="user-info">
            {user.picture
              ? <img src={user.picture} alt={user.name} className="user-avatar-img" />
              : <div className="rep-avatar" style={{ width: 32, height: 32, fontSize: 13 }}>{user.name[0].toUpperCase()}</div>
            }
          </div>
        </div>
      </header>

      {/* KPI Strip */}
      <div className="kpi-strip">
        <StatCard label="Total Sent" value={stats.totalSent} sub={`${stats.totalPending} pending`} color="#6366f1" />
        <StatCard label="Bounce Rate" value={`${stats.bounceRate}%`} sub="target <5%" color={stats.bounceRate > 5 ? '#f87171' : '#34d399'} />
        <StatCard label="Open Rate" value={`${stats.openRate}%`} sub="industry avg 25%" color={stats.openRate > 25 ? '#34d399' : '#f59e0b'} />
        <StatCard label="Reply Rate" value={`${stats.replyRate}%`} sub="target >10%" color={stats.replyRate > 10 ? '#34d399' : '#f59e0b'} />
        <StatCard label="Replied" value={contacts.filter(c => c.status === 'replied').length} sub="total replies" color="#34d399" />
      </div>

      {/* Tabs */}
      <nav className="tabs">
        {(['overview', 'reps', 'industries', 'pipeline'] as const).map(tab => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
        {/* Senders tab — hidden from nav, accessible via Launch Campaign button */}
        {activeTab === 'senders' && (
          <button className="tab active">Campaign</button>
        )}
      </nav>

      {/* Tab Content */}
      <main className="main">

        {/* ── INLINE ERROR BANNER ── */}
        {error && (() => {
          const { message, action } = friendlySheetError(error);
          return (
            <div style={{
              background: '#f871711a', border: '1px solid #f8717144', borderRadius: 10,
              padding: '14px 20px', marginBottom: 16, display: 'flex', gap: 14,
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>⚠</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f87171', marginBottom: 2 }}>{message}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{action}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => setShowSources(true)}
                  style={{
                    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7,
                    color: 'var(--text)', padding: '6px 12px', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Open Settings
                </button>
                <button
                  onClick={refresh}
                  style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 7,
                    color: 'var(--text-secondary)', padding: '6px 12px', fontSize: 12,
                    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── OVERVIEW ── */}
        {activeTab === 'overview' && (
          <div className="tab-content">
            {!error && contacts.length === 0 && !loading && (
              <EmptyState onAddSource={() => setShowSources(true)} />
            )}
            {(contacts.length > 0 || error) && <>
              {/* Chronological send activity */}
              {dailyMetrics.length > 0 && (
                <div className="chart-card full">
                  <h2>Daily Send Activity</h2>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={dailyMetrics} margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradReplied" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                        axisLine={false} tickLine={false}
                        tickFormatter={d => {
                          const dt = new Date(d + 'T12:00:00');
                          return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
                        }}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                        axisLine={false} tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0f1119', border: '1px solid #1d2030',
                          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                          padding: '10px 14px',
                        }}
                        labelStyle={{ color: 'var(--text)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}
                        itemStyle={{ fontSize: 12 }}
                        cursor={{ stroke: 'rgba(99,102,241,0.2)', strokeWidth: 1 }}
                        labelFormatter={d => {
                          const dt = new Date(d + 'T12:00:00');
                          return dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                        iconType="circle" iconSize={7}
                      />
                      <Area type="monotone" dataKey="sent" name="Sent" stroke="#6366f1" strokeWidth={2.5}
                        fill="url(#gradSent)" dot={false} activeDot={{ r: 5, fill: '#6366f1', strokeWidth: 0 }} />
                      <Area type="monotone" dataKey="opened" name="Opened" stroke="#a78bfa" strokeWidth={2}
                        fill="url(#gradOpened)" dot={false} activeDot={{ r: 5, fill: '#a78bfa', strokeWidth: 0 }} />
                      <Area type="monotone" dataKey="replied" name="Replied" stroke="#34d399" strokeWidth={2}
                        fill="url(#gradReplied)" dot={false} activeDot={{ r: 5, fill: '#34d399', strokeWidth: 0 }} />
                      <Line type="monotone" dataKey="bounced" name="Bounced" stroke="#f87171" strokeWidth={1.5}
                        dot={false} activeDot={{ r: 4, fill: '#f87171', strokeWidth: 0 }} strokeDasharray="5 3" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="charts-row">
                {/* Funnel */}
                <div className="chart-card wide">
                  <h2>Pipeline Funnel</h2>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={funnel} margin={{ top: 10, right: 16, left: -8, bottom: 0 }} barCategoryGap="28%">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis
                        dataKey="stage"
                        tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                        axisLine={false} tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                        axisLine={false} tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0f1119', border: '1px solid #1d2030',
                          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                        }}
                        labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                        cursor={{ fill: 'rgba(99,102,241,0.06)' }}
                      />
                      <Bar dataKey="value" radius={[8, 8, 4, 4]}>
                        {funnel.map((entry, index) => (
                          <Cell key={index} fill={entry.color} fillOpacity={0.9} />
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

              <div className="chart-card full">
                <h2>Reply Rate by Industry</h2>
                <ResponsiveContainer width="100%" height={Math.max(180, industryMetrics.length * 52)}>
                  <BarChart data={industryMetrics} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={true} horizontal={false} />
                    <XAxis
                      type="number" unit="%" tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      axisLine={false} tickLine={false}
                    />
                    <YAxis
                      type="category" dataKey="industry" width={155}
                      tick={{ fill: 'var(--text)', fontSize: 12, fontWeight: 500 }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#0f1119', border: '1px solid #1d2030',
                        borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                      }}
                      labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                      formatter={(val) => [`${val}%`, 'Reply Rate']}
                      cursor={{ fill: 'rgba(99,102,241,0.05)' }}
                    />
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
            </>}
          </div>
        )}

        {/* ── REPS LEADERBOARD ── */}
        {activeTab === 'reps' && (
          <div className="tab-content">
            <div className="chart-card full">
              <h2>🏆 Rep Leaderboard</h2>
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
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Rep comparison bar chart */}
            {repMetrics.length > 0 && (
              <div className="chart-card full">
                <h2>Rep Performance Comparison</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={repMetrics} margin={{ top: 10, right: 16, left: -8, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="repName" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis unit="%" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#0f1119', border: '1px solid #1d2030', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                      labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                      formatter={(val) => [`${val}%`]}
                      cursor={{ fill: 'rgba(99,102,241,0.06)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    <Bar dataKey="openRate" name="Open Rate" fill="#6366f1" radius={[6, 6, 3, 3]} fillOpacity={0.9} />
                    <Bar dataKey="replyRate" name="Reply Rate" fill="#34d399" radius={[6, 6, 3, 3]} fillOpacity={0.9} />
                    <Bar dataKey="bounceRate" name="Bounce Rate" fill="#f87171" radius={[6, 6, 3, 3]} fillOpacity={0.9} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── INDUSTRIES ── */}
        {activeTab === 'industries' && (
          <div className="tab-content">
            <div className="industry-grid">
              {industryMetrics.map(ind => (
                <div key={ind.industry} className="industry-card">
                  <div className="industry-header">
                    <div className="industry-dot" style={{ background: INDUSTRY_COLORS[ind.industry] || '#6366f1' }} />
                    <h3>{ind.industry}</h3>
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
                <p style={{ color: 'var(--text-secondary)' }}>No industry data yet — send some emails first.</p>
              )}
            </div>

            {industryMetrics.length > 0 && (
              <div className="chart-card full" style={{ marginTop: 8 }}>
                <h2>Industry Volume vs Reply Rate</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={industryMetrics} margin={{ top: 10, right: 16, left: -8, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="industry" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#0f1119', border: '1px solid #1d2030', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                      labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
                      cursor={{ fill: 'rgba(99,102,241,0.06)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                    <Bar yAxisId="left" dataKey="sent" name="Emails Sent" fill="#6366f1" radius={[6, 6, 3, 3]} fillOpacity={0.75} />
                    <Bar yAxisId="right" dataKey="replyRate" name="Reply %" fill="#34d399" radius={[6, 6, 3, 3]} fillOpacity={0.9} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── PIPELINE TABLE ── */}
        {activeTab === 'pipeline' && (() => {
          const allStatuses = ['all', 'pending', 'sent', 'opened', 'replied', 'bounced', 'invalid'];
          const allIndustries = ['all', ...Array.from(new Set(contacts.map(c => c.industry).filter(Boolean))).sort()];
          const allCountries = ['all', ...Array.from(new Set(contacts.map(c => c.country).filter(Boolean))).sort()];
          const allReps = ['all', ...Array.from(new Set(contacts.map(c => c.assignedTo?.split('@')[0]).filter(Boolean))).sort() as string[]];

          const filtered = contacts.filter(c => {
            if (pipelineStatusFilter !== 'all' && c.status !== pipelineStatusFilter) return false;
            if (pipelineIndustryFilter !== 'all' && c.industry !== pipelineIndustryFilter) return false;
            if (filterName && !c.firstName.toLowerCase().includes(filterName.toLowerCase())) return false;
            if (filterCompany && !c.company.toLowerCase().includes(filterCompany.toLowerCase())) return false;
            if (filterCountry !== 'all' && c.country !== filterCountry) return false;
            if (filterAssignedTo !== 'all' && (c.assignedTo?.split('@')[0] || '') !== filterAssignedTo) return false;
            if (filterLinkedIn === 'yes' && !c.linkedIn) return false;
            if (filterLinkedIn === 'no' && c.linkedIn) return false;
            if (filterOpens === 'yes' && c.openCount === 0) return false;
            return true;
          });

          const sorted = [...filtered].sort((a, b) => {
            const dir = pipelineSortDir === 'asc' ? 1 : -1;
            switch (pipelineSortCol) {
              case 'name': return dir * a.firstName.localeCompare(b.firstName);
              case 'company': return dir * a.company.localeCompare(b.company);
              case 'industry': return dir * (a.industry || '').localeCompare(b.industry || '');
              case 'country': return dir * (a.country || '').localeCompare(b.country || '');
              case 'assignedTo': return dir * (a.assignedTo || '').localeCompare(b.assignedTo || '');
              case 'status': return dir * a.status.localeCompare(b.status);
              case 'opens': return dir * (a.openCount - b.openCount);
              case 'sentAt': {
                const da = a.sentAt ? new Date(a.sentAt).getTime() : 0;
                const db = b.sentAt ? new Date(b.sentAt).getTime() : 0;
                return dir * (da - db);
              }
              default: return 0;
            }
          });

          const handleSort = (col: string) => {
            if (pipelineSortCol === col) setPipelineSortDir(d => d === 'asc' ? 'desc' : 'asc');
            else { setPipelineSortCol(col); setPipelineSortDir('asc'); }
          };

          const activeFilterCount = [
            pipelineStatusFilter !== 'all', pipelineIndustryFilter !== 'all',
            !!filterName, !!filterCompany, filterCountry !== 'all',
            filterAssignedTo !== 'all', filterLinkedIn !== 'all', filterOpens !== 'all',
          ].filter(Boolean).length;

          const clearAllFilters = () => {
            setPipelineStatusFilter('all'); setPipelineIndustryFilter('all');
            setFilterName(''); setFilterCompany('');
            setFilterCountry('all'); setFilterAssignedTo('all');
            setFilterLinkedIn('all'); setFilterOpens('all');
          };

          const formatDate = (dateStr: string) => {
            if (!dateStr) return '—';
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '—';
            return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
          };

          const pill = (active: boolean, color: string): React.CSSProperties => ({
            padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.6, transition: 'all 0.12s',
            border: active ? `1px solid ${color}55` : '1px solid rgba(255,255,255,0.08)',
            background: active ? color + '22' : 'rgba(255,255,255,0.03)',
            color: active ? color : 'var(--text-secondary)',
          });

          const ctrlInput: React.CSSProperties = {
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text)', fontSize: 11, padding: '5px 10px',
            fontFamily: 'inherit', outline: 'none',
          };
          const ctrlSelect: React.CSSProperties = {
            ...ctrlInput, cursor: 'pointer', appearance: 'none' as const,
            paddingRight: 24, backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
          };

          const SortTh = ({ col, label, align }: { col: string; label: string; align?: string }) => (
            <th onClick={() => handleSort(col)} style={{
              background: '#0c0e15', borderBottom: '2px solid var(--border)',
              padding: '11px 13px', textAlign: (align as any) || 'left',
              cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
              position: 'sticky', top: 0, zIndex: 10,
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: pipelineSortCol === col ? 'var(--text)' : 'var(--text-secondary)',
              }}>
                {label}
                <span style={{ fontSize: 9, opacity: pipelineSortCol === col ? 1 : 0.3, color: pipelineSortCol === col ? 'var(--accent)' : 'inherit' }}>
                  {pipelineSortCol === col ? (pipelineSortDir === 'asc' ? '▲' : '▼') : '⇅'}
                </span>
              </span>
            </th>
          );

          const StaticTh = ({ label }: { label: string }) => (
            <th style={{
              background: '#0c0e15', borderBottom: '2px solid var(--border)',
              padding: '11px 13px', position: 'sticky', top: 0, zIndex: 10,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                {label}
              </span>
            </th>
          );

          return (
            <div className="tab-content">
              {/* ── Filter bar ── */}
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '12px 14px', marginBottom: 10,
              }}>
                {/* Row 1: text + dropdown filters */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 9 }}>
                  <input type="text" placeholder="Search name…" value={filterName} onChange={e => setFilterName(e.target.value)}
                    style={{ ...ctrlInput, width: 120, borderColor: filterName ? 'var(--accent)' : 'var(--border)' }} />
                  <input type="text" placeholder="Search company…" value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
                    style={{ ...ctrlInput, width: 150, borderColor: filterCompany ? 'var(--accent)' : 'var(--border)' }} />
                  <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)}
                    style={{ ...ctrlSelect, width: 120, borderColor: filterCountry !== 'all' ? 'var(--accent)' : 'var(--border)', color: filterCountry !== 'all' ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    <option value="all">All countries</option>
                    {allCountries.filter(c => c !== 'all').map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={pipelineIndustryFilter} onChange={e => setPipelineIndustryFilter(e.target.value)}
                    style={{ ...ctrlSelect, width: 140, borderColor: pipelineIndustryFilter !== 'all' ? 'var(--accent)' : 'var(--border)', color: pipelineIndustryFilter !== 'all' ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    <option value="all">All industries</option>
                    {allIndustries.filter(i => i !== 'all').map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                  <select value={filterAssignedTo} onChange={e => setFilterAssignedTo(e.target.value)}
                    style={{ ...ctrlSelect, width: 130, borderColor: filterAssignedTo !== 'all' ? 'var(--accent)' : 'var(--border)', color: filterAssignedTo !== 'all' ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    <option value="all">All reps</option>
                    {allReps.filter(r => r !== 'all').map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginLeft: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.06em', marginRight: 2 }}>LI</span>
                    {(['all', 'yes', 'no'] as const).map(v => (
                      <button key={v} onClick={() => setFilterLinkedIn(v)} style={pill(filterLinkedIn === v, '#0a66c2')}>
                        {v === 'all' ? 'ALL' : v === 'yes' ? 'HAS' : 'NONE'}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.06em', marginRight: 2 }}>OPENS</span>
                    {(['all', 'yes'] as const).map(v => (
                      <button key={v} onClick={() => setFilterOpens(v)} style={pill(filterOpens === v, '#a78bfa')}>
                        {v === 'all' ? 'ALL' : 'HAS'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Row 2: status pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.06em', marginRight: 4 }}>STATUS</span>
                  {allStatuses.map(s => (
                    <button key={s} onClick={() => setPipelineStatusFilter(s)} style={pill(pipelineStatusFilter === s, STATUS_COLORS[s] || 'var(--accent)')}>
                      {s === 'all' ? 'ALL' : s.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Results bar ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text)' }}>{sorted.length.toLocaleString()}</strong>
                  <span> of {contacts.length.toLocaleString()} contacts</span>
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {pipelineSortCol && (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: "'DM Mono', monospace" }}>
                      Sort: {pipelineSortCol} {pipelineSortDir === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                  {activeFilterCount > 0 && (
                    <button onClick={clearAllFilters} style={{
                      background: 'none', border: '1px solid var(--border)', borderRadius: 5,
                      color: 'var(--text-secondary)', fontSize: 11, padding: '3px 10px',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      ✕ Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              </div>

              {/* ── Table ── */}
              <div className="chart-card full" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-wrap" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
                  <table className="pipeline-table" style={{ tableLayout: 'fixed', minWidth: 900, width: '100%' }}>
                    <colgroup>
                      <col style={{ width: 120 }} />
                      <col style={{ width: 170 }} />
                      <col style={{ width: 100 }} />
                      <col style={{ width: 76 }} />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 105 }} />
                      <col style={{ width: 80 }} />
                      <col style={{ width: 70 }} />
                      <col style={{ width: 100 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <SortTh col="name" label="Name" />
                        <SortTh col="company" label="Company" />
                        <SortTh col="industry" label="Industry" />
                        <SortTh col="country" label="Country" align="center" />
                        <SortTh col="assignedTo" label="Assigned" />
                        <SortTh col="status" label="Status" />
                        <StaticTh label="LinkedIn" />
                        <SortTh col="opens" label="Opens" align="center" />
                        <SortTh col="sentAt" label="Sent At" />
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.slice(0, 500).map((c, idx) => (
                        <tr key={c.id + idx}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                            background: idx % 2 === 1 ? 'rgba(255,255,255,0.012)' : undefined,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.07)')}
                          onMouseLeave={e => (e.currentTarget.style.background = idx % 2 === 1 ? 'rgba(255,255,255,0.012)' : '')}
                        >
                          <td style={{ padding: '8px 13px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                            {c.firstName}
                          </td>
                          <td style={{ padding: '8px 13px', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.company}>
                            {c.company}
                          </td>
                          <td style={{ padding: '8px 13px' }}>
                            {c.industry ? (
                              <span style={{
                                background: (INDUSTRY_COLORS[c.industry] || '#6366f1') + '20',
                                color: INDUSTRY_COLORS[c.industry] || '#6366f1',
                                fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                                whiteSpace: 'nowrap', display: 'inline-block',
                              }}>
                                {c.industry}
                              </span>
                            ) : <span style={{ color: 'var(--border)' }}>—</span>}
                          </td>
                          <td style={{ padding: '8px 13px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                            {c.country || '—'}
                          </td>
                          <td style={{ padding: '8px 13px', fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.assignedTo ? c.assignedTo.split('@')[0] : '—'}
                          </td>
                          <td style={{ padding: '8px 13px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span
                                className="status-pill"
                                title={c.bounceReason || undefined}
                                style={{
                                  background: (STATUS_COLORS[c.status] || '#64748b') + '22',
                                  color: STATUS_COLORS[c.status] || '#64748b',
                                  border: `1px solid ${(STATUS_COLORS[c.status] || '#64748b')}44`,
                                  fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                                  whiteSpace: 'nowrap', textTransform: 'capitalize',
                                  cursor: c.bounceReason ? 'help' : undefined,
                                }}
                              >
                                {c.status}
                              </span>
                              {c.status === 'bounced' && c.linkedIn && (
                                <span title="Follow up on LinkedIn" style={{ fontSize: 10 }}>💼</span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '8px 13px' }}>
                            {c.linkedIn ? (
                              <a href={c.linkedIn} target="_blank" rel="noopener noreferrer"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#0a66c2', fontSize: 11, fontWeight: 600, textDecoration: 'none', background: '#0a66c211', border: '1px solid #0a66c222', borderRadius: 4, padding: '2px 7px' }}
                                title={c.linkedIn}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="#0a66c2">
                                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                                </svg>
                                View
                              </a>
                            ) : (
                              <span style={{ color: 'var(--border)', fontSize: 12 }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 13px', textAlign: 'center' }}>
                            {c.openCount > 0 ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#a78bfa', fontFamily: "'DM Mono', monospace", fontSize: 11, background: '#a78bfa11', border: '1px solid #a78bfa22', borderRadius: 4, padding: '2px 7px' }}>
                                👁 {c.openCount}
                              </span>
                            ) : <span style={{ color: 'var(--border)' }}>—</span>}
                          </td>
                          <td style={{ padding: '8px 13px', fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {formatDate(c.sentAt || '')}
                          </td>
                        </tr>
                      ))}
                      {sorted.length === 0 && (
                        <tr>
                          <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '64px 32px' }}>
                            <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>No contacts match</div>
                            <div style={{ fontSize: 11 }}>Try adjusting your filters</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {sorted.length > 500 && (
                  <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', fontFamily: "'DM Mono', monospace" }}>
                    Showing first 500 of {sorted.length.toLocaleString()} contacts
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── SENDERS ── */}
        {activeTab === 'senders' && user && (
          <div className="tab-content">
            <SenderPanel
              user={user}
              senders={api.senders}
              pipelineStatus={api.pipelineStatus}
              loading={api.loading}
              runMessage={api.runMessage}
              apiError={api.apiError}
              onRunPipeline={api.runPipeline}
              onRefresh={api.refresh}
              getConnectUrl={api.getConnectUrl}
              fetchPreview={api.previewContacts}
              pollProgress={api.pollProgress}
              sources={sources}
              activeSheetId={activeSource.sheetId}
              activeSheetTab={activeSource.sheetTab}
              onManageSources={() => setShowSources(true)}
            />
          </div>
        )}

      </main>
    </div>
  );
}
