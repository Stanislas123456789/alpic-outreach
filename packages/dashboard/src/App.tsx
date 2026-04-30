import { useState, useEffect, useMemo } from 'react';
import { useAllSheets } from './hooks/useSheets';
import { useAuth } from './hooks/useAuth';
import { useConfig } from './hooks/useConfig';
import { useApi, useCampaigns } from './hooks/useApi';
import { StatCard } from './components/ui/StatCard';
import { SkeletonKpiStrip } from './components/ui/Skeleton';
import LoginPage from './components/LoginPage';
import SourceModal from './components/SourceModal';
import SenderPanel from './components/SenderPanel';
import SettingsPanel from './components/SettingsPanel';
import OverviewTab from './components/tabs/OverviewTab';
import RepsTab from './components/tabs/RepsTab';
import IndustriesTab from './components/tabs/IndustriesTab';
import PipelineTab from './components/tabs/PipelineTab';
import CampaignsTab from './components/tabs/CampaignsTab';
import './App.css';

type TabId = 'overview' | 'reps' | 'industries' | 'pipeline' | 'campaigns' | 'senders' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'reps', label: 'Reps' },
  { id: 'industries', label: 'Industries' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'settings', label: 'Settings' },
];

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

// Compute period-over-period trend (last N days vs preceding N days)
function computeTrend(contacts: { sentAt?: string; status: string; openCount: number }[], metric: 'sent' | 'bounceRate' | 'openRate' | 'replyRate', days = 14) {
  const now = Date.now();
  const cutoff1 = now - days * 86400000;
  const cutoff2 = cutoff1 - days * 86400000;

  const recent = contacts.filter(c => c.sentAt && new Date(c.sentAt).getTime() >= cutoff1);
  const previous = contacts.filter(c => c.sentAt && new Date(c.sentAt).getTime() >= cutoff2 && new Date(c.sentAt).getTime() < cutoff1);

  function calcMetric(group: typeof contacts) {
    const sent = group.filter(c => c.status !== 'pending' && c.status !== 'invalid').length;
    if (metric === 'sent') return sent;
    if (sent === 0) return 0;
    if (metric === 'bounceRate') return Math.round((group.filter(c => c.status === 'bounced').length / sent) * 100);
    if (metric === 'openRate') return Math.round((group.filter(c => c.openCount > 0 || c.status === 'opened' || c.status === 'replied').length / sent) * 100);
    if (metric === 'replyRate') return Math.round((group.filter(c => c.status === 'replied').length / sent) * 100);
    return 0;
  }

  const recentVal = calcMetric(recent);
  const prevVal = calcMetric(previous);
  if (prevVal === 0) return null;
  const diff = recentVal - prevVal;
  return { value: diff, label: `vs prev ${days}d` };
}

export default function App() {
  const { user, logout, loginWithKeyword, loginWithGoogle } = useAuth();
  const { sources, activeSource, activeId, setActiveId, addSource, updateSource, deleteSource } = useConfig();
  const sheetsData = useAllSheets([activeSource], 30000);
  const contacts = sheetsData.contacts || [];
  const { loading, lastUpdated, refresh, sheetErrors, repMetrics, industryMetrics, funnel, stats } = sheetsData;
  const emptyTouch = { sent: 0, opened: 0, replied: 0, unsubscribed: 0, openRate: 0, replyRate: 0, unsubRate: 0 };
  const followUpMetrics = sheetsData.followUpMetrics || { totalUnsubscribed: 0, touch1: emptyTouch, touch2: emptyTouch, touch3: emptyTouch };
  const { campaigns: campaignList } = useCampaigns(user);
  const error: string | null = null;
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showSources, setShowSources] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('alpic_theme') as 'dark' | 'light') || 'dark'
  );

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('alpic_theme', theme);
  }, [theme]);

  const api = useApi(user);

  // Handle post-OAuth redirect: ?tab=senders&connected=true
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'senders') {
      setActiveTab('senders');
      if (params.get('connected')) api.refresh();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // KPI trend calculations
  const trends = useMemo(() => ({
    sent: computeTrend(contacts, 'sent'),
    bounceRate: computeTrend(contacts, 'bounceRate'),
    openRate: computeTrend(contacts, 'openRate'),
    replyRate: computeTrend(contacts, 'replyRate'),
  }), [contacts]);

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

      {/* ── Header (simplified) ─────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="logo">ALPIC</div>
          <div className="header-title">
            <h1>Outreach Pipeline</h1>
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
          {/* Sender health pill (admin only) */}
          {user?.email?.endsWith('@alpic.ai') && api.senders.length > 0 && (() => {
            const connected = api.senders.filter(s => s.connected).length;
            const total = api.senders.length;
            const color = connected === 0 ? '#f87171' : connected < total ? '#f59e0b' : '#34d399';
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 20,
                background: `${color}18`, border: `1px solid ${color}44`,
                fontSize: 11, fontWeight: 600, color,
                flexShrink: 0,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
                {connected === 0 ? 'No senders' : `${connected}/${total} senders`}
              </div>
            );
          })()}
          <span className="last-updated">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ''}
          </span>
          <button className="refresh-btn" onClick={refresh}>Refresh</button>
          {/* Launch Campaign CTA (admin only) */}
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
              Launch Campaign
            </button>
          )}
          {/* User avatar + dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowUserMenu(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 8px 4px 4px', borderRadius: 8,
                background: showUserMenu ? 'var(--card-elevated)' : 'transparent',
                border: '1px solid transparent', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              title="Account menu"
            >
              {user.picture
                ? <img src={user.picture} alt={user.name} className="user-avatar-img" />
                : <div className="rep-avatar" style={{ width: 29, height: 29, fontSize: 12 }}>{user.name[0].toUpperCase()}</div>
              }
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>▾</span>
            </button>
            {showUserMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowUserMenu(false)} />
                <div style={{
                  position: 'absolute', top: '110%', right: 0, zIndex: 100,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: 8, minWidth: 200,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                }}>
                  {/* User info */}
                  <div style={{ padding: '8px 14px 12px', borderBottom: '1px solid var(--border-subtle)', marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user.email}</div>
                  </div>
                  {/* Theme toggle */}
                  <button
                    onClick={() => { setTheme(t => t === 'dark' ? 'light' : 'dark'); setShowUserMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px', border: 'none',
                      background: 'none', color: 'var(--text)', borderRadius: 8,
                      cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <span>{theme === 'dark' ? '☀️' : '🌙'}</span> {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                  </button>
                  {/* Manage sheets */}
                  <button
                    onClick={() => { setShowSources(true); setShowUserMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px', border: 'none',
                      background: 'none', color: 'var(--text)', borderRadius: 8,
                      cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <span>📁</span> Manage Sheets
                  </button>
                  {/* Sign out */}
                  <button
                    onClick={() => { logout(); setShowUserMenu(false); }}
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
        </div>
      </header>

      {/* ── KPI Strip ────────────────────────────────────────── */}
      {loading && contacts.length === 0 ? (
        <SkeletonKpiStrip />
      ) : (
        <div className="kpi-strip">
          <StatCard label="Total Sent" value={stats.totalSent} sub={`${stats.totalPending} pending`} color="#6366f1" trend={trends.sent ?? undefined} />
          <StatCard label="Bounce Rate" value={`${stats.bounceRate}%`} sub="target <5%" color={stats.bounceRate > 5 ? '#f87171' : '#34d399'} trend={trends.bounceRate ?? undefined} />
          <StatCard label="Open Rate" value={`${stats.openRate}%`} sub="industry avg 25%" color={stats.openRate > 25 ? '#34d399' : '#f59e0b'} trend={trends.openRate ?? undefined} />
          <StatCard label="Reply Rate" value={`${stats.replyRate}%`} sub="target >10%" color={stats.replyRate > 10 ? '#34d399' : '#f59e0b'} trend={trends.replyRate ?? undefined} />
          <StatCard label="Replied" value={contacts.filter(c => c.status === 'replied').length} sub="total replies" color="#34d399" />
          <StatCard label="Follow-ups" value={followUpMetrics.touch2.sent + followUpMetrics.touch3.sent} sub={`FU1: ${followUpMetrics.touch2.sent} / FU2: ${followUpMetrics.touch3.sent}`} color="#a78bfa" />
          <StatCard label="Unsubscribed" value={followUpMetrics.totalUnsubscribed} sub={`${stats.totalSent > 0 ? Math.round((followUpMetrics.totalUnsubscribed / stats.totalSent) * 100) : 0}% of total sent`} color="#ef4444" />
        </div>
      )}

      {/* Sheet error banner */}
      {sheetErrors.length > 0 && (
        <div style={{ margin: '0 24px 12px', padding: '10px 16px', background: '#f871711a', border: '1px solid #f87171', borderRadius: 8 }}>
          {sheetErrors.map((err, i) => (
            <div key={i} style={{ fontSize: 12, color: '#f87171', lineHeight: 1.5 }}>{err}</div>
          ))}
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <nav className="tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {activeTab === 'senders' && (
          <button className="tab active">Campaign</button>
        )}
      </nav>

      {/* ── Tab Content ──────────────────────────────────────── */}
      <main className="main">

        {/* Inline error banner */}
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
                <button onClick={() => setShowSources(true)} style={{
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7,
                  color: 'var(--text)', padding: '6px 12px', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                }}>Open Settings</button>
                <button onClick={refresh} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 7,
                  color: 'var(--text-secondary)', padding: '6px 12px', fontSize: 12,
                  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                }}>Retry</button>
              </div>
            </div>
          );
        })()}

        {activeTab === 'overview' && (
          <OverviewTab
            contacts={contacts}
            industryMetrics={industryMetrics}
            funnel={funnel}
            followUpMetrics={followUpMetrics}
            loading={loading}
            onAddSource={() => setShowSources(true)}
          />
        )}

        {activeTab === 'reps' && (
          <RepsTab repMetrics={repMetrics} loading={loading} />
        )}

        {activeTab === 'industries' && (
          <IndustriesTab industryMetrics={industryMetrics} loading={loading} />
        )}

        {activeTab === 'pipeline' && (
          <PipelineTab contacts={contacts} loading={loading} />
        )}

        {activeTab === 'campaigns' && (
          <CampaignsTab contacts={contacts} campaignList={campaignList} loading={loading} />
        )}

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
              disconnectSender={api.disconnectSender}
              fetchPreview={api.previewContacts}
              pollProgress={api.pollProgress}
              sources={sources}
              activeSheetId={activeSource.sheetId}
              activeSheetTab={activeSource.sheetTab}
              onManageSources={() => setShowSources(true)}
            />
          </div>
        )}

        {activeTab === 'settings' && user && (
          <div className="tab-content">
            <SettingsPanel
              user={user}
              senders={api.senders}
              getConnectUrl={api.getConnectUrl}
              disconnectSender={api.disconnectSender}
              updateSenderLimit={api.updateSenderLimit}
            />
          </div>
        )}
      </main>
    </div>
  );
}
