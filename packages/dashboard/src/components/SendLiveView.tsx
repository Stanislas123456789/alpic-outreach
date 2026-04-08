import { useState, useEffect, useRef } from 'react';
import type { ProgressEvent, PipelineProgress } from '../hooks/useApi';

interface Props {
  pollProgress: () => Promise<PipelineProgress>;
  onDone: () => void;
}

const EVENT_ICONS: Record<string, string> = {
  start: '🚀',
  sending: '📤',
  sent: '✅',
  failed: '❌',
  invalid: '⚠️',
  skipped: '⏭',
  done: '🏁',
};

const EVENT_COLORS: Record<string, string> = {
  start: '#6366f1',
  sending: '#f59e0b',
  sent: '#34d399',
  failed: '#f87171',
  invalid: '#f87171',
  skipped: '#94a3b8',
  done: '#34d399',
};

export default function SendLiveView({ pollProgress, onDone }: Props) {
  const [log, setLog] = useState<ProgressEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const seenLength = useRef(0);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await pollProgress();
        const newEvents = data.log.slice(seenLength.current);
        if (newEvents.length > 0) {
          seenLength.current = data.log.length;
          setLog(data.log);
          setTotal(data.total);
          setSentCount(data.log.filter(e => e.type === 'sent').length);
          setFailedCount(data.log.filter(e => e.type === 'failed' || e.type === 'invalid').length);
        }
        if (!data.running && data.log.some(e => e.type === 'done')) {
          setDone(true);
          clearInterval(interval);
        }
      } catch {
        // silent — API may not be running
      }
    }, 800);
    return () => clearInterval(interval);
  }, [pollProgress]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const sentEvents = log.filter(e => e.type === 'sent');
  const progressPct = total > 0 ? Math.round((sentCount / total) * 100) : 0;

  return (
    <div style={styles.wrap}>

      {/* Progress bar */}
      <div style={styles.progressWrap}>
        <div style={styles.progressBar}>
          <div
            style={{
              ...styles.progressFill,
              width: `${progressPct}%`,
              background: done ? '#34d399' : 'var(--accent)',
            }}
          />
        </div>
        <div style={styles.progressStats}>
          <span style={{ color: '#34d399', fontWeight: 700 }}>{sentCount} sent</span>
          {failedCount > 0 && <span style={{ color: '#f87171' }}>{failedCount} failed</span>}
          {total > 0 && <span style={{ color: 'var(--text-secondary)' }}>of {total} total</span>}
          {!done && <span style={styles.liveDot}>● LIVE</span>}
        </div>
      </div>

      {/* Sent cards */}
      {sentEvents.length > 0 && (
        <div style={styles.sentCards}>
          {sentEvents.map((e, i) => (
            <div key={i} style={styles.sentCard}>
              <div style={styles.sentCardIcon}>✅</div>
              <div style={styles.sentCardInfo}>
                <span style={styles.sentCardName}>{e.firstName} @ {e.company}</span>
                <span style={styles.sentCardEmail}>{e.email}</span>
              </div>
              <div style={styles.sentCardVia}>via {e.via?.split('@')[0]}</div>
              <div style={styles.sentCardTime}>
                {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full log */}
      <div style={styles.logWrap}>
        <div style={styles.logTitle}>Event Log</div>
        <div style={styles.log}>
          {log.length === 0 && !done && (
            <div style={styles.logEmpty}>
              <div style={styles.spinner} />
              <span>Waiting for pipeline to start…</span>
            </div>
          )}
          {log.map((e, i) => (
            <div key={i} style={styles.logRow}>
              <span style={styles.logTime}>
                {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span style={{ flexShrink: 0 }}>{EVENT_ICONS[e.type] || '·'}</span>
              <span style={{ color: EVENT_COLORS[e.type] || 'var(--text)', fontWeight: e.type === 'sent' ? 600 : 400 }}>
                {e.type === 'start' && `Pipeline started — ${e.total} contacts to send`}
                {e.type === 'sending' && `Sending to ${e.firstName} @ ${e.company} (${e.email})`}
                {e.type === 'sent' && `Sent to ${e.firstName} @ ${e.company} via ${e.via}`}
                {e.type === 'failed' && `Failed: ${e.email} — ${e.error}`}
                {e.type === 'invalid' && `Invalid email: ${e.email} — ${e.error}`}
                {e.type === 'skipped' && `Skipped: ${e.email} — ${e.error}`}
                {e.type === 'done' && 'Sequence complete'}
              </span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {done && (
        <div style={styles.doneBar}>
          <span style={{ color: '#34d399', fontWeight: 700 }}>
            🏁 Sequence complete — {sentCount} sent{failedCount > 0 ? `, ${failedCount} failed` : ''}
          </span>
          <button style={styles.closeBtn} onClick={onDone}>Close</button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  progressWrap: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  progressBar: {
    height: 8,
    background: 'var(--border)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.5s ease',
  },
  progressStats: {
    display: 'flex',
    gap: 16,
    fontSize: 13,
    alignItems: 'center',
  },
  liveDot: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: 700,
    animation: 'pulse 1.5s ease-in-out infinite',
    marginLeft: 'auto',
  },
  sentCards: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sentCard: {
    background: 'var(--card)',
    border: '1px solid #34d39933',
    borderRadius: 10,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    animation: 'fadeIn 0.3s ease',
  },
  sentCardIcon: {
    fontSize: 18,
    flexShrink: 0,
  },
  sentCardInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    flex: 1,
  },
  sentCardName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text)',
  },
  sentCardEmail: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  sentCardVia: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    background: 'var(--bg)',
    borderRadius: 4,
    padding: '2px 8px',
  },
  sentCardTime: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    flexShrink: 0,
  },
  logWrap: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  logTitle: {
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    borderBottom: '1px solid var(--border)',
  },
  log: {
    padding: '8px 0',
    maxHeight: 240,
    overflowY: 'auto' as const,
    fontFamily: 'monospace',
  },
  logEmpty: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '16px 20px',
    color: 'var(--text-secondary)',
    fontSize: 12,
  },
  spinner: {
    width: 16,
    height: 16,
    border: '2px solid var(--border)',
    borderTop: '2px solid var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },
  logRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '4px 16px',
    fontSize: 12,
  },
  logTime: {
    color: 'var(--text-secondary)',
    flexShrink: 0,
    fontSize: 11,
  },
  doneBar: {
    background: '#34d39911',
    border: '1px solid #34d39944',
    borderRadius: 10,
    padding: '14px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  closeBtn: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
};
