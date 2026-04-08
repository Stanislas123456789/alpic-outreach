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
  const userSender = senders.find(s => s.email === user.email);
  const isConnected = !!userSender?.connected;
  const hasAnySender = senders.some(s => s.connected);

  return (
    <div style={styles.wrap}>

      {/* ── Your account ────────────────────────────────────────── */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Your Gmail</h3>
        <div style={styles.accountRow}>
          {user.picture
            ? <img src={user.picture} alt={user.name} style={styles.avatar} />
            : <div style={styles.avatarFallback}>{user.name[0].toUpperCase()}</div>
          }
          <div style={styles.accountInfo}>
            <div style={styles.accountName}>{user.name}</div>
            <div style={styles.accountEmail}>{user.email}</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            {isConnected
              ? <span style={styles.badgeGreen}>Connected</span>
              : (
                <a
                  href={getConnectUrl(user.email)}
                  style={styles.connectBtn}
                >
                  Connect Gmail →
                </a>
              )
            }
          </div>
        </div>

        {isConnected && userSender && (
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
              <span style={styles.quotaLabel}>Daily limit</span>
              <strong style={styles.quotaValue}>{userSender.dailyLimit}</strong>
            </div>
            <div style={styles.quotaBarWrap}>
              <div
                style={{
                  ...styles.quotaBar,
                  width: `${Math.min(100, (userSender.sentToday / userSender.dailyLimit) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Send batch ───────────────────────────────────────────── */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Launch Campaign</h3>
        <p style={styles.batchDesc}>
          Preview the next pending contacts from your sheet, remove or edit emails before sending, then watch them go out live.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
          <button
            style={{
              ...styles.sendBtn,
              opacity: loading || !hasAnySender ? 0.5 : 1,
              cursor: loading || !hasAnySender ? 'not-allowed' : 'pointer',
            }}
            onClick={() => { setShowLive(false); setShowPreview(true); }}
            disabled={loading || !hasAnySender}
          >
            {loading ? '⏳ Running...' : '👁 Preview & Send'}
          </button>
          {showLive && (
            <button
              style={{ ...styles.sendBtn, background: '#34d399' }}
              onClick={() => setShowLive(true)}
            >
              📡 View Live Feed
            </button>
          )}
        </div>

        {!hasAnySender && (
          <p style={styles.hint}>Connect at least one Gmail account above to enable sending.</p>
        )}
        {runMessage && <p style={styles.successMsg}>✅ {runMessage}</p>}
        {apiError && <p style={styles.errorMsg}>⚠ {apiError}</p>}

        {pipelineStatus?.lastRunAt && (
          <p style={styles.lastRun}>
            Last run: {new Date(pipelineStatus.lastRunAt).toLocaleString()}
            {pipelineStatus.lastRunResult && (
              <span style={{ marginLeft: 8, color: pipelineStatus.lastRunResult === 'success' ? '#34d399' : '#f87171' }}>
                {pipelineStatus.lastRunResult === 'success' ? '✓ success' : `✗ ${pipelineStatus.lastRunError || 'error'}`}
              </span>
            )}
          </p>
        )}
      </div>

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

      {/* ── Live send view ───────────────────────────────────────── */}
      {showLive && (
        <div style={styles.card}>
          <div style={styles.senderListHeader}>
            <h3 style={styles.cardTitle}>Live Send Feed</h3>
          </div>
          <SendLiveView
            pollProgress={pollProgress}
            onDone={() => { setShowLive(false); onRefresh(); }}
          />
        </div>
      )}

      {/* ── All connected senders ────────────────────────────────── */}
      {senders.length > 0 && (
        <div style={styles.card}>
          <div style={styles.senderListHeader}>
            <h3 style={styles.cardTitle}>All Senders</h3>
            <button style={styles.refreshBtn} onClick={onRefresh}>↻ Refresh</button>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Account</th>
                <th style={styles.th}>Sent today</th>
                <th style={styles.th}>Remaining</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {senders.map(s => (
                <tr key={s.email}>
                  <td style={styles.td}>
                    <div style={styles.senderEmail}>{s.email}</div>
                    <div style={styles.senderName}>{s.name}</div>
                  </td>
                  <td style={styles.td}>{s.sentToday}</td>
                  <td style={styles.td}>
                    <span style={{ color: s.remaining > 0 ? '#34d399' : '#f87171' }}>
                      {s.remaining} / {s.dailyLimit}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {s.connected
                      ? <span style={styles.badgeGreen}>Active</span>
                      : <span style={styles.badgeGray}>Not connected</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    maxWidth: 720,
  },
  card: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 24,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    margin: '0 0 16px',
  },
  accountRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'var(--accent)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 600,
  },
  accountInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  accountName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
  },
  accountEmail: {
    fontSize: 12,
    color: 'var(--text-secondary)',
  },
  badgeGreen: {
    background: '#34d39933',
    color: '#34d399',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
  },
  badgeGray: {
    background: '#94a3b833',
    color: '#94a3b8',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
  },
  connectBtn: {
    background: 'var(--accent)',
    color: 'white',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
    display: 'inline-block',
  },
  quotaRow: {
    marginTop: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    position: 'relative',
  },
  quotaStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  quotaLabel: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  quotaValue: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text)',
  },
  quotaDivider: {
    width: 1,
    height: 36,
    background: 'var(--border)',
  },
  quotaBarWrap: {
    flex: 1,
    minWidth: 120,
    height: 6,
    background: 'var(--border)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  quotaBar: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: 3,
    transition: 'width 0.3s',
  },
  batchDesc: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    margin: '0 0 16px',
    lineHeight: 1.5,
  },
  sendBtn: {
    background: 'var(--accent)',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  hint: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    marginTop: 8,
  },
  successMsg: {
    fontSize: 13,
    color: '#34d399',
    marginTop: 10,
  },
  errorMsg: {
    fontSize: 13,
    color: '#f87171',
    marginTop: 10,
  },
  lastRun: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    marginTop: 12,
  },
  senderListHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  refreshBtn: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-secondary)',
    fontSize: 12,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)',
  },
  senderEmail: {
    fontSize: 13,
    color: 'var(--text)',
  },
  senderName: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    marginTop: 2,
  },
};
