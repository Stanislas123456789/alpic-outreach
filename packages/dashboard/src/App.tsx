import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, FunnelChart, Funnel, LabelList,
  RadarChart, PolarGrid, PolarAngleAxis, Radar, Cell,
} from 'recharts';
import { useSheets } from './hooks/useSheets';
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
  pending: '#94a3b8',
  sent: '#6366f1',
  opened: '#a78bfa',
  replied: '#34d399',
  bounced: '#f87171',
  invalid: '#cbd5e1',
};

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: color || 'var(--accent)' }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ScoreBadge({ rate }: { rate: number }) {
  const stars = rate >= 20 ? 5 : rate >= 15 ? 4 : rate >= 10 ? 3 : rate >= 5 ? 2 : 1;
  return <span className="score-badge">{'⭐'.repeat(stars)}</span>;
}

export default function App() {
  const { user, logout, loginWithKeyword, loginWithGoogle } = useAuth();
  const { sources, activeSource, activeId, setActiveId, addSource, updateSource, deleteSource } = useConfig();
  const { contacts, loading, error, lastUpdated, refresh, repMetrics, industryMetrics, funnel, stats } = useSheets(activeSource.sheetId, activeSource.sheetTab, 30000);
  const [activeTab, setActiveTab] = useState<'overview' | 'reps' | 'industries' | 'pipeline' | 'senders'>('senders');
  const [showSources, setShowSources] = useState(false);
  const api = useApi(user);

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

  if (loading) return (
    <div className="loading">
      <div className="loading-spinner" />
      <p>Loading pipeline data...</p>
    </div>
  );

  if (error) return (
    <div className="error">
      <h2>⚠️ Error loading data</h2>
      <p>{error}</p>
      <button onClick={refresh}>Retry</button>
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
          <div className="logo">ALPIC</div>
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
            <button className="source-manage-btn" onClick={() => setShowSources(true)} title="Manage sources">
              ⚙
            </button>
          </div>
          <span className="last-updated">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ''}
          </span>
          <button className="refresh-btn" onClick={refresh}>↻ Refresh</button>
          <div className="user-info">
            {user.picture
              ? <img src={user.picture} alt={user.name} className="user-avatar-img" />
              : <div className="rep-avatar" style={{ width: 32, height: 32, fontSize: 13 }}>{user.name[0].toUpperCase()}</div>
            }
            <button className="logout-btn" onClick={logout}>Sign out</button>
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
        {/* Senders tab — only for Google-authenticated @alpic.ai users */}
        {user?.email?.endsWith('@alpic.ai') && (
          <button
            className={`tab ${activeTab === 'senders' ? 'active' : ''}`}
            onClick={() => { setActiveTab('senders'); api.refresh(); }}
          >
            Senders
          </button>
        )}
      </nav>

      {/* Tab Content */}
      <main className="main">

        {/* ── OVERVIEW ── */}
        {activeTab === 'overview' && (
          <div className="tab-content">
            <div className="charts-row">
              {/* Funnel */}
              <div className="chart-card wide">
                <h2>Pipeline Funnel</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={funnel} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="stage" tick={{ fill: 'var(--text-secondary)', fontSize: 13 }} />
                    <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                      labelStyle={{ color: 'var(--text)' }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {funnel.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
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
                        <div className="status-dot" style={{ background: color }} />
                        <span className="status-name">{status}</span>
                        <div className="status-bar-wrap">
                          <div className="status-bar" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <span className="status-count">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Industry performance bar */}
            <div className="chart-card full">
              <h2>Reply Rate by Industry</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={industryMetrics} layout="vertical" margin={{ left: 20, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" unit="%" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                  <YAxis type="category" dataKey="industry" width={160} tick={{ fill: 'var(--text)', fontSize: 13 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                    formatter={(val) => [`${val}%`]}
                  />
                  <Bar dataKey="replyRate" radius={[0, 6, 6, 0]} name="Reply Rate">
                    {industryMetrics.map((entry, index) => (
                      <Cell key={index} fill={INDUSTRY_COLORS[entry.industry] || '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
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
                  <BarChart data={repMetrics} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="repName" tick={{ fill: 'var(--text)', fontSize: 13 }} />
                    <YAxis unit="%" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                      formatter={(val) => [`${val}%`]}
                    />
                    <Bar dataKey="openRate" name="Open Rate" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="replyRate" name="Reply Rate" fill="#34d399" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="bounceRate" name="Bounce Rate" fill="#f87171" radius={[4, 4, 0, 0]} />
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
              <div className="chart-card full" style={{ marginTop: 24 }}>
                <h2>Industry Volume vs Reply Rate</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={industryMetrics} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="industry" tick={{ fill: 'var(--text)', fontSize: 12 }} />
                    <YAxis yAxisId="left" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                    <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                    />
                    <Bar yAxisId="left" dataKey="sent" name="Emails Sent" fill="#6366f1" radius={[4, 4, 0, 0]} opacity={0.7} />
                    <Bar yAxisId="right" dataKey="replyRate" name="Reply %" fill="#34d399" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── PIPELINE TABLE ── */}
        {activeTab === 'pipeline' && (
          <div className="tab-content">
            <div className="chart-card full">
              <div className="pipeline-header">
                <h2>Contact Pipeline</h2>
                <span className="pipeline-count">{contacts.length} total contacts</span>
              </div>
              <div className="table-wrap">
                <table className="pipeline-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Company</th>
                      <th>Industry</th>
                      <th>Country</th>
                      <th>Assigned To</th>
                      <th>Status</th>
                      <th>Opens</th>
                      <th>Sent At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.slice(0, 200).map((c) => (
                      <tr key={c.id}>
                        <td>{c.firstName}</td>
                        <td>{c.company}</td>
                        <td>
                          <span className="industry-tag" style={{ background: (INDUSTRY_COLORS[c.industry] || '#6366f1') + '22', color: INDUSTRY_COLORS[c.industry] || '#6366f1' }}>
                            {c.industry}
                          </span>
                        </td>
                        <td>{c.country}</td>
                        <td className="rep-cell">{c.assignedTo ? c.assignedTo.split('@')[0] : '—'}</td>
                        <td>
                          <span className="status-pill" style={{ background: (STATUS_COLORS[c.status] || '#94a3b8') + '33', color: STATUS_COLORS[c.status] || '#94a3b8' }}>
                            {c.status}
                          </span>
                        </td>
                        <td>{c.openCount > 0 ? `👁 ${c.openCount}` : '—'}</td>
                        <td className="date-cell">{c.sentAt ? new Date(c.sentAt).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

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
              activeSheetId={activeSource.sheetId}
              activeSheetTab={activeSource.sheetTab}
            />
          </div>
        )}

      </main>
    </div>
  );
}
