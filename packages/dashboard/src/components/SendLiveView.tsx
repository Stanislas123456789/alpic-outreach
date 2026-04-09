import { useState, useEffect, useRef } from 'react';
import type { ProgressEvent, PipelineProgress } from '../hooks/useApi';

interface Props {
  pollProgress: () => Promise<PipelineProgress>;
  onDone: () => void;
}

const EVENT_COLORS: Record<string, string> = {
  start: '#6366f1', sending: '#f59e0b', sent: '#34d399',
  failed: '#f87171', invalid: '#f87171', skipped: '#94a3b8', done: '#34d399',
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
      } catch { /* silent */ }
    }, 800);
    return () => clearInterval(interval);
  }, [pollProgress]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const sentEvents = log.filter(e => e.type === 'sent');
  const progressPct = total > 0 ? Math.round((sentCount / total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Hero status bar ── */}
      <div style={{
        background: done ? '#34d39911' : 'var(--accent)0d',
        border: `1px solid ${done ? '#34d39944' : 'var(--accent)44'}`,
        borderRadius: 14, padding: '20px 24px',
        display: 'flex', alignItems: 'center', gap: 24,
      }}>
        {/* Big sent counter */}
        <div style={{ textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, color: done ? '#34d399' : 'var(--accent)', letterSpacing: '-0.03em' }}>
            {sentCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>
            sent
          </div>
        </div>

        <div style={{ width: 1, height: 48, background: 'var(--border)' }} />

        {/* Progress */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {!done ? (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#f59e0b22', color: '#f59e0b',
                  borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}>
                  ● LIVE
                </span>
              ) : (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#34d39922', color: '#34d399',
                  borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700,
                }}>
                  ✓ COMPLETE
                </span>
              )}
              {total > 0 && (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {sentCount} / {total} emails
                </span>
              )}
            </div>
            {failedCount > 0 && (
              <span style={{ fontSize: 12, color: '#f87171' }}>{failedCount} failed</span>
            )}
            <span style={{ fontSize: 13, fontWeight: 700, color: done ? '#34d399' : 'var(--text)' }}>
              {progressPct}%
            </span>
          </div>
          <div style={{ height: 10, background: 'var(--border)', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 5,
              background: done
                ? 'linear-gradient(90deg, #34d399, #10b981)'
                : 'linear-gradient(90deg, var(--accent), #818cf8)',
              width: `${progressPct}%`,
              transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: done ? '0 0 12px #34d39966' : '0 0 12px var(--accent)66',
            }} />
          </div>
        </div>

        {done && (
          <button
            onClick={onDone}
            style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text)', padding: '10px 20px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
            }}
          >
            Close
          </button>
        )}
      </div>

      {/* ── Sent cards (last 5) ── */}
      {sentEvents.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            Sent emails
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sentEvents.slice(-8).reverse().map((e, i) => (
              <div key={i} style={{
                background: 'var(--card)', border: '1px solid #34d39922',
                borderLeft: '3px solid #34d399', borderRadius: 8,
                padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
                animation: i === 0 ? 'fadeIn 0.3s ease' : 'none',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#34d39922', color: '#34d399',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, flexShrink: 0,
                }}>
                  {e.firstName?.[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {e.firstName} · {e.company}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.email}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg)', borderRadius: 4, padding: '2px 8px', flexShrink: 0 }}>
                  via {e.via?.split('@')[0]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, fontFamily: 'DM Mono, monospace' }}>
                  {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Event log ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          padding: '10px 16px', fontSize: 11, fontWeight: 600,
          color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em',
          borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          Event Log
          {!done && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1.5s infinite', display: 'inline-block' }} />}
        </div>
        <div style={{ padding: '6px 0', maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace' }}>
          {log.length === 0 && !done && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', color: 'var(--text-secondary)', fontSize: 12 }}>
              <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTop: '2px solid var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              Waiting for pipeline to start…
            </div>
          )}
          {log.map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 16px', fontSize: 11 }}>
              <span style={{ color: 'var(--text-secondary)', flexShrink: 0, fontFamily: 'DM Mono, monospace' }}>
                {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span style={{ color: EVENT_COLORS[e.type] || 'var(--text)', fontWeight: ['sent', 'done'].includes(e.type) ? 600 : 400 }}>
                {e.type === 'start' && `🚀 Pipeline started — ${e.total} contacts`}
                {e.type === 'sending' && `📤 Sending to ${e.firstName} @ ${e.company}`}
                {e.type === 'sent' && `✅ Sent → ${e.firstName} @ ${e.company} via ${e.via?.split('@')[0]}`}
                {e.type === 'failed' && `❌ Failed: ${e.email} — ${e.error}`}
                {e.type === 'invalid' && `⚠️ Invalid: ${e.email}`}
                {e.type === 'skipped' && `⏭ Skipped: ${e.email}`}
                {e.type === 'done' && `🏁 Done — ${log.filter(x => x.type === 'sent').length} sent`}
              </span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

    </div>
  );
}
