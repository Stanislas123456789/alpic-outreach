import { useState } from 'react';
import type { AuthUser } from '../hooks/useAuth';
import type { SenderStatus, PipelineStatus, PreviewContact, PipelineProgress } from '../hooks/useApi';
import SendPreviewModal from './SendPreviewModal';
import SendLiveView from './SendLiveView';

interface Props {
  user: AuthUser;
  senders: SenderStatus[];
  pipelineStatus: PipelineStatus | null;
  loading: boolean;
  runMessage: string | null;
  apiError: string | null;
  onRunPipeline: (opts?: { excludeIds?: string[]; sheetId?: string; tab?: string; emailOverrides?: Record<string, { subject: string; body: string }> }) => void;
  onRefresh: () => void;
  getConnectUrl: (email: string) => string;
  fetchPreview: (sheetId?: string, tab?: string, limit?: number) => Promise<PreviewContact[]>;
  pollProgress: () => Promise<PipelineProgress>;
  activeSheetId?: string;
  activeSheetTab?: string;
}

export default function SenderPanel({
  user,
  senders,
  pipelineStatus,
  loading,
  runMessage,
  apiError,
  onRunPipeline,
  onRefresh,
  getConnectUrl,
  fetchPreview,
  pollProgress,
  activeSheetId,
  activeSheetTab,
}: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [showSenders, setShowSenders] = useState(false);

  const userSender = senders.find(s => s.email === user.email);
  const isConnected = !!userSender?.connected;
  const hasAnySender = senders.some(s => s.connected);
  const totalRemaining = senders.filter(s => s.connected).reduce((sum, s) => sum + s.remaining, 0);
  const totalSentToday = senders.filter(s => s.connected).reduce((sum, s) => sum + s.sentToday, 0);

  return (
    <div style={styles.wrap}>

      {/* ── HERO: Launch Campaign ─────────────────────────────── */}
      <div style={styles.hero}>
        <div style={styles.heroLeft}>
          <div style={styles.heroLabel}>Outreach Pipeline</div>
          <h2 style={styles.heroTitle}>Ready to send?</h2>
          <p style={styles.heroDesc}>
            Preview pending contacts, edit emails if needed, then launch — and watch each email go out in real time.
          </p>

          {/* Steps */}
          <div style={styles.steps}>
            {[
              { n: '1', label: 'Pick contacts', desc: 'Review who's next in the queue' },
              { n: '2', label: 'Edit emails', desc: 'Tweak subject or body per contact' },
              { n: '3', label: 'Watch live', desc: 'See each send happen in real time' },
            ].map(s => (
              <div key={s.n} style={styles.step}>
                <div style={styles.stepNum}>{s.n}</div>
                <div>
                  <div style={styles.stepLabel}>{s.label}</div>
                  <div style={styles.stepDesc}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' as const }}>
            <button
              style={{
                ...styles.launchBtn,
                opacity: loading || !hasAnySender ? 0.45 : 1,
                cursor: loading || !hasAnySender ? 'not-allowed' : 'pointer',
              }}
              onClick={() => { setShowLive(false); setShowPreview(true); }}
              disabled={loading || !hasAnySender}
            >
              {loading ? '⏳ Running…' : '🚀 Launch Campaign'}
            </button>
            {showLive && (
              <button style={styles.liveBtn} onClick={() => setShowLive(true)}>
                📡 View Live Feed
              </button>
            )}
          </div>

          {!hasAnySender && !isConnected && (
            <div style={styles.connectPrompt}>
              <span style={{ color: 'var(--text-secondary)' }}>Gmail not connected —</span>
              <a href={getConnectUrl(user.email)} style={styles.connectLink}>Connect now →</a>
            </div>
          )}
          {runMessage && <p style={styles.successMsg}>✅ {runMessage}</p>}
          {apiError && <p style={styles.errorMsg}>⚠ {apiError}</p>}
        </div>

        {/* Right: sender status card */}
        <div style={styles.heroRight}>
          <div style={styles.senderCard}>
            <div style={styles.senderCardTop}>
              {user.picture
                ? <img src={user.picture} alt={user.name} style={styles.avatar} />
                : <div style={styles.avatarFallback}>{user.name[0].toUpperCase()}</div>
              }
              <div>
                <div style={styles.senderName}>{user.name}</div>
                <div style={styles.senderEmail}>{user.email}</div>
              </div>
              {isConnected
                ? <span style={styles.badgeGreen}>Connected</span>
                : <a href={getConnectUrl(user.email)} style={styles.connectBtn}>Connect →</a>
              }
            </div>

            {isConnected && userSender && (
              <>
                <div style={styles.quotaRow}>
                  <div style={styles.quotaStat}>
                    <span style={styles.quotaLabel}>Sent today</span>
                    <strong style={styles.quotaValue}>{userSender.sentToday}</strong>
                  </div>
                  <div style={styles.quotaDivider} />
                  <div style={styles.quotaStat}>
                    <span style={styles.quotaLabel}>Remaining</span>
                    <strong style={{ ...styles.quotaValue, color: userSender.remaining > 0 ? '#34d399' : '#f87171' }}>
                      {userSender.remaining}
                    </strong>
                  </div>
                  <div style={styles.quotaDivider} />
                  <div style={styles.quotaStat}>
                    <span style={styles.quotaLabel}>Limit</span>
                    <strong style={styles.quotaValue}>{userSender.dailyLimit}</strong>
                  </div>
                </div>
                <div style={styles.quotaBarWrap}>
                  <div style={{
                    ...styles.quotaBar,
                    width: `${Math.min(100, (userSender.sentToday / userSender.dailyLimit) * 100)}%`,
                  }} />
                </div>
              </>
            )}

            {pipelineStatus?.lastRunAt && (
              <div style={styles.lastRun}>
                Last run: {new Date(pipelineStatus.lastRunAt).toLocaleString()}
                <span style={{ marginLeft: 6, color: pipelineStatus.lastRunResult === 'success' ? '#34d399' : '#f87171' }}>
                  {pipelineStatus.lastRunResult === 'success' ? '✓' : '✗'}
                </span>
              </div>
            )}
          </div>

          {/* All senders toggle */}
          {senders.length > 1 && (
            <button style={styles.allSendersToggle} onClick={() => setShowSenders(v => !v)}>
              {showSenders ? '▲' : '▼'} {senders.filter(s => s.connected).length} sender{senders.filter(s => s.connected).length !== 1 ? 's' : ''} active
              {totalRemaining > 0 && <span style={{ color: '#34d399', marginLeft: 8 }}>{totalRemaining} emails remaining</span>}
            </button>
          )}

          {showSenders && (
            <div style={styles.sendersTable}>
              {senders.map(s => (
                <div key={s.email} style={styles.senderRow}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{s.email}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.sentToday}/{s.dailyLimit} sent</div>
                  </div>
                  <span style={s.connected ? styles.badgeGreen : styles.badgeGray}>
                    {s.connected ? 'Active' : 'Offline'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button style={styles.refreshBtn} onClick={onRefresh}>↻ Refresh status</button>
        </div>
      </div>

      {/* ── Live send view ───────────────────────────────────────── */}
      {showLive && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>Live Send Feed</h3>
          </div>
          <SendLiveView
            pollProgress={pollProgress}
            onDone={() => { setShowLive(false); onRefresh(); }}
          />
        </div>
      )}

      {/* ── Preview modal ────────────────────────────────────────── */}
      {showPreview && (
        <SendPreviewModal
          sheetId={activeSheetId}
          sheetTab={activeSheetTab}
          fetchPreview={fetchPreview}
          onClose={() => setShowPreview(false)}
          onConfirm={(excludeIds, emailOverrides) => {
            setShowPreview(false);
            setShowLive(true);
            onRunPipeline({ excludeIds, sheetId: activeSheetId, tab: activeSheetTab, emailOverrides });
          }}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    maxWidth: 1100,
  },

  // Hero
  hero: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: 32,
    display: 'flex',
    gap: 40,
    alignItems: 'flex-start',
  },
  heroLeft: {
    flex: 1,
    minWidth: 0,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--accent)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: 700,
    color: 'var(--text)',
    margin: '0 0 10px',
    lineHeight: 1.2,
  },
  heroDesc: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    margin: 0,
    maxWidth: 420,
  },
  steps: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    marginTop: 24,
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'var(--accent)22',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text)',
  },
  stepDesc: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    marginTop: 1,
  },
  launchBtn: {
    background: 'var(--accent)',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    padding: '14px 32px',
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "'DM Sans', sans-serif",
    cursor: 'pointer',
    transition: 'opacity 0.15s, transform 0.1s',
    letterSpacing: '0.01em',
  },
  liveBtn: {
    background: '#34d39922',
    color: '#34d399',
    border: '1px solid #34d39944',
    borderRadius: 10,
    padding: '14px 24px',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    cursor: 'pointer',
  },
  connectPrompt: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    fontSize: 13,
  },
  connectLink: {
    color: 'var(--accent)',
    fontWeight: 600,
    textDecoration: 'none',
  },
  successMsg: {
    fontSize: 13,
    color: '#34d399',
    marginTop: 14,
  },
  errorMsg: {
    fontSize: 13,
    color: '#f87171',
    marginTop: 14,
  },

  // Right side sender card
  heroRight: {
    width: 280,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  senderCard: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  senderCardTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    flexShrink: 0,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'var(--accent)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  senderName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text)',
  },
  senderEmail: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  badgeGreen: {
    background: '#34d39922',
    color: '#34d399',
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 600,
    marginLeft: 'auto',
    flexShrink: 0,
  },
  badgeGray: {
    background: '#94a3b822',
    color: '#94a3b8',
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 11,
    flexShrink: 0,
  },
  connectBtn: {
    background: 'var(--accent)',
    color: 'white',
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    textDecoration: 'none',
    marginLeft: 'auto',
    flexShrink: 0,
  },
  quotaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  quotaStat: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 1,
    flex: 1,
    alignItems: 'center' as const,
  },
  quotaLabel: {
    fontSize: 10,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  quotaValue: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text)',
  },
  quotaDivider: {
    width: 1,
    height: 28,
    background: 'var(--border)',
  },
  quotaBarWrap: {
    height: 4,
    background: 'var(--border)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  quotaBar: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: 2,
    transition: 'width 0.3s',
  },
  lastRun: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  allSendersToggle: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-secondary)',
    fontSize: 12,
    padding: '8px 12px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: "'DM Sans', sans-serif",
    width: '100%',
  },
  sendersTable: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  senderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    fontSize: 12,
    color: 'var(--text)',
  },
  refreshBtn: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-secondary)',
    fontSize: 11,
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    width: '100%',
  },

  // Card (for live view)
  card: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 24,
  },
  cardHeader: {
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    margin: 0,
  },
};
