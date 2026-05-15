import { useState, useEffect, useRef } from 'react';
import type { AuthUser } from '../hooks/useAuth';
import type { SenderStatus, PipelineStatus, PreviewContact, PipelineProgress, Campaign, ProgressEvent } from '../hooks/useApi';
import { useCampaigns } from '../hooks/useApi';
import type { SheetSource } from '../hooks/useConfig';
import CampaignWizard from './CampaignWizard';
import SendLiveView from './SendLiveView';

interface Props {
  user: AuthUser;
  senders: SenderStatus[];
  pipelineStatus: PipelineStatus | null;
  loading: boolean;
  runMessage: string | null;
  apiError: string | null;
  onRunPipeline: (opts?: { excludeIds?: string[]; sheetId?: string; tab?: string; emailOverrides?: Record<string, { subject: string; body: string }> }) => Promise<{ campaignId?: string }> | void;
  onRefresh: () => void;
  getConnectUrl: (email: string) => string;
  disconnectSender: (email: string) => Promise<void>;
  fetchPreview: (sheetId?: string, tab?: string, limit?: number) => Promise<PreviewContact[]>;
  pollProgress: (campaignId?: string) => Promise<PipelineProgress>;
  sources: SheetSource[];
  activeSheetId?: string;
  activeSheetTab?: string;
  onManageSources: () => void;
}

// ── Relative time helper ─────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return 'Starting soon';
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `Starts in ${hours}h ${minutes}m`;
  return `Starts in ${minutes}m`;
}

function formatCompletedTime(isoString: string | null): string {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Campaign stat helpers ────────────────────────────────────────────────────

interface CampaignStats {
  sent: number;
  failed: number;
  invalid: number;
  skipped: number;
  total: number;
  completedAt: string | null;
  sentContacts: ProgressEvent[];
  failedContacts: ProgressEvent[];
  invalidContacts: ProgressEvent[];
}

function getCampaignStats(campaign: Campaign): CampaignStats {
  const log = campaign.log || [];
  const sentContacts = log.filter(e => e.type === 'sent');
  const failedContacts = log.filter(e => e.type === 'failed');
  const invalidContacts = log.filter(e => e.type === 'invalid');
  const skippedEvts = log.filter(e => e.type === 'skipped');
  const doneEvt = [...log].reverse().find(e => e.type === 'done');
  return {
    sent: campaign.sent || sentContacts.length,
    failed: failedContacts.length,
    invalid: invalidContacts.length,
    skipped: skippedEvts.length,
    total: campaign.total || (sentContacts.length + failedContacts.length + invalidContacts.length),
    completedAt: doneEvt?.timestamp || null,
    sentContacts,
    failedContacts,
    invalidContacts,
  };
}

// ── Campaign card ─────────────────────────────────────────────────────────────

// ── Campaign details modal ────────────────────────────────────────────────────

function CampaignDetailsModal({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  const stats = getCampaignStats(campaign);
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 640,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column' as const,
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
              {campaign.name || campaign.sheetTab || 'Campaign'} — Contacts
            </h2>
            <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
              <span style={{ color: '#6366f1', fontWeight: 600 }}>{stats.sent} sent</span>
              {stats.failed > 0 && <span style={{ color: '#f87171', fontWeight: 600 }}>{stats.failed} failed</span>}
              {stats.invalid > 0 && <span style={{ color: '#fb923c', fontWeight: 600 }}>{stats.invalid} invalid</span>}
              {stats.total > 0 && <span style={{ color: 'var(--text-secondary)' }}>{stats.total} total</span>}
            </div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Modal body */}
        <div style={{ overflow: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column' as const, gap: 20 }}>

          {/* Sent */}
          {stats.sentContacts.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#34d399', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 8 }}>
                Sent ({stats.sentContacts.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                {stats.sentContacts.map((evt, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px',
                    background: 'var(--bg)',
                    borderRadius: 7,
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: '#6366f118', color: '#6366f1',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, flexShrink: 0,
                    }}>
                      {(evt.firstName || evt.email || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        {[evt.firstName, evt.company].filter(Boolean).join(' · ')}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                        {evt.email}
                      </div>
                    </div>
                    {evt.via && (
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
                        via {evt.via.split('@')[0]}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Failed */}
          {stats.failedContacts.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 8 }}>
                Failed ({stats.failedContacts.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                {stats.failedContacts.map((evt, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px',
                    background: '#f871710a',
                    borderRadius: 7,
                    border: '1px solid #f8717122',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: '#f8717118', color: '#f87171',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, flexShrink: 0,
                    }}>
                      {(evt.firstName || evt.email || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        {evt.firstName}{evt.email ? ` — ${evt.email}` : ''}
                      </div>
                      {evt.error && (
                        <div style={{ fontSize: 11, color: '#f87171', marginTop: 1 }}>{evt.error}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invalid */}
          {stats.invalidContacts.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fb923c', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 8 }}>
                Invalid Email ({stats.invalidContacts.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                {stats.invalidContacts.map((evt, i) => (
                  <div key={i} style={{
                    padding: '8px 10px',
                    background: '#fb923c0a',
                    borderRadius: 7,
                    border: '1px solid #fb923c22',
                    fontSize: 12, color: 'var(--text)',
                  }}>
                    {evt.firstName}{evt.email ? ` — ` : ''}<span style={{ color: '#fb923c' }}>{evt.email}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.sent === 0 && stats.failed === 0 && stats.invalid === 0 && (
            <div style={{ textAlign: 'center' as const, color: 'var(--text-secondary)', fontSize: 13, padding: '24px 0' }}>
              No contact data recorded for this campaign.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatScheduleDays(weekSchedule?: Campaign['weekSchedule']): string {
  if (!weekSchedule?.activeDays) return '';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return weekSchedule.activeDays
    .map((active, i) => active ? dayNames[i] : null)
    .filter(Boolean)
    .join(', ');
}

function CampaignCard({
  campaign,
  onCancel,
  onPause,
  onResume,
  onViewLive,
  onViewDetails,
}: {
  campaign: Campaign;
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onViewLive: () => void;
  onViewDetails: (c: Campaign) => void;
}) {
  const stats = getCampaignStats(campaign);
  const [expanded, setExpanded] = useState(false);

  const [relativeTime, setRelativeTime] = useState(() =>
    campaign.scheduledAt ? formatRelativeTime(campaign.scheduledAt) : ''
  );

  useEffect(() => {
    if ((campaign.status !== 'scheduled' && campaign.status !== 'active') || !campaign.scheduledAt) return;
    const update = () => setRelativeTime(formatRelativeTime(campaign.scheduledAt!));
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [campaign.status, campaign.scheduledAt]);

  const badgeMap: Record<string, { color: string; bg: string; label: string; pulse: boolean }> = {
    scheduled: { color: '#f59e0b', bg: '#f59e0b18', label: 'Scheduled', pulse: false },
    running:   { color: '#34d399', bg: '#34d39918', label: 'Running',   pulse: true  },
    done:      { color: '#34d399', bg: '#34d39918', label: 'Done',      pulse: false },
    active:    { color: '#6366f1', bg: '#6366f118', label: `Active — Day ${campaign.daysSent || 1}`, pulse: true },
    error:     { color: '#f87171', bg: '#f8717118', label: 'Error',     pulse: false },
    cancelled: { color: '#94a3b8', bg: '#94a3b818', label: 'Cancelled', pulse: false },
    paused:    { color: '#f59e0b', bg: '#f59e0b18', label: 'Paused',    pulse: false },
  };
  const badge = badgeMap[campaign.status] || badgeMap.error;

  const isFinished = campaign.status === 'done' || campaign.status === 'error';
  const isStoppable = campaign.status === 'running' || campaign.status === 'active' || campaign.status === 'scheduled';
  const isPausable = campaign.status === 'running' || campaign.status === 'active' || campaign.status === 'scheduled';
  const progressPct = stats.total > 0 ? Math.round((stats.sent / stats.total) * 100) : 0;
  const displayTime = stats.completedAt || campaign.startedAt;

  // Config summary for expanded view
  const sendWindowStr = campaign.sendWindow?.enabled
    ? `${campaign.sendWindow.startHour}:00 – ${campaign.sendWindow.endHour}:00`
    : null;
  const scheduleDaysStr = formatScheduleDays(campaign.weekSchedule);
  const hasFollowUp = campaign.followUp?.enabled;
  const hasFollowUp2 = campaign.followUp2?.enabled;

  return (
    <div style={{
      background: 'var(--bg)',
      border: `1px solid ${campaign.status === 'paused' ? '#f59e0b44' : 'var(--border)'}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 8,
    }}>
      {/* Row 1: name + badge + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 10, color: 'var(--text-secondary)', transition: 'transform 0.2s',
            transform: expanded ? 'rotate(90deg)' : 'none', flexShrink: 0,
          }}
          onClick={() => setExpanded(v => !v)}
        >
          &#9654;
        </button>
        <span style={{
          fontSize: 13, fontWeight: 600, color: 'var(--text)',
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
        }}>
          {campaign.name || campaign.sheetTab || 'Campaign'}
        </span>
        <span style={{
          background: badge.bg, color: badge.color,
          borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
        }}>
          {badge.pulse && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: badge.color, display: 'inline-block',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          )}
          {badge.label}
        </span>
        {/* Actions */}
        {campaign.status === 'running' && (
          <button style={styles.campaignBtn} onClick={onViewLive}>View Live</button>
        )}
        {isPausable && (
          <button
            style={{ ...styles.campaignBtn, color: '#f59e0b', borderColor: '#f59e0b44' }}
            onClick={() => onPause(campaign.id)}
          >
            Pause
          </button>
        )}
        {campaign.status === 'paused' && (
          <button
            style={{ ...styles.campaignBtn, color: '#34d399', borderColor: '#34d39944' }}
            onClick={() => onResume(campaign.id)}
          >
            Resume
          </button>
        )}
        {isStoppable && (
          <button
            style={{ ...styles.campaignBtn, color: '#f87171', borderColor: '#f8717144' }}
            onClick={() => onCancel(campaign.id)}
          >
            Stop
          </button>
        )}
        {campaign.status === 'paused' && (
          <button
            style={{ ...styles.campaignBtn, color: '#f87171', borderColor: '#f8717144' }}
            onClick={() => onCancel(campaign.id)}
          >
            Cancel
          </button>
        )}
        {isFinished && (stats.sent > 0 || stats.failed > 0) && (
          <button style={styles.campaignBtn} onClick={() => onViewDetails(campaign)}>
            Details
          </button>
        )}
      </div>

      {/* Row 2: running progress bar */}
      {campaign.status === 'running' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
            <span>{stats.sent} / {stats.total > 0 ? stats.total : '?'} sent</span>
            {stats.total > 0 && <span>{progressPct}%</span>}
          </div>
          <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${stats.total > 0 ? progressPct : 0}%`,
              background: '#34d399',
              borderRadius: 2,
              transition: 'width 0.5s',
            }} />
          </div>
        </div>
      )}

      {/* Row 3: finished stats */}
      {isFinished && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' as const }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#6366f1' }}>{stats.sent}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>sent</span>
          </div>
          {stats.failed > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#f87171' }}>{stats.failed}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>failed</span>
            </div>
          )}
          {stats.total > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{stats.total}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>total</span>
            </div>
          )}
          {displayTime && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
              {campaign.status === 'done' ? 'Completed' : 'Failed'} {formatCompletedTime(displayTime)}
            </span>
          )}
        </div>
      )}

      {/* Active multi-day campaign info */}
      {campaign.status === 'active' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' as const }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#6366f1' }}>{campaign.sent}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>sent so far</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{campaign.daysSent || 1}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>day{(campaign.daysSent || 1) > 1 ? 's' : ''} done</span>
          </div>
          {campaign.scheduledAt && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6366f1', flexShrink: 0 }}>
              Next batch: {new Date(campaign.scheduledAt).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} at {new Date(campaign.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {/* Scheduled countdown */}
      {campaign.status === 'scheduled' && campaign.scheduledAt && (
        <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 500 }}>
          {relativeTime} — {new Date(campaign.scheduledAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* Paused info */}
      {campaign.status === 'paused' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
          <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
            Paused — {campaign.sent} sent so far
          </span>
          {campaign.scheduledAt && (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Was scheduled for {new Date(campaign.scheduledAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {/* Error message */}
      {campaign.status === 'error' && campaign.error && (
        <div style={{ fontSize: 11, color: '#f87171', fontStyle: 'italic' as const }}>{campaign.error}</div>
      )}

      {/* Expanded: campaign config details */}
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border)',
          paddingTop: 10,
          marginTop: 2,
          display: 'flex',
          flexDirection: 'column' as const,
          gap: 6,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
            Campaign Config
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const, fontSize: 12 }}>
            {campaign.senderEmail && (
              <div><span style={{ color: 'var(--text-secondary)' }}>Sender: </span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{campaign.senderEmail.split('@')[0]}</span></div>
            )}
            <div><span style={{ color: 'var(--text-secondary)' }}>Sheet: </span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{campaign.sheetTab}</span></div>
            {campaign.total > 0 && (
              <div><span style={{ color: 'var(--text-secondary)' }}>Target: </span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{campaign.total} contacts</span></div>
            )}
            {sendWindowStr && (
              <div><span style={{ color: 'var(--text-secondary)' }}>Window: </span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{sendWindowStr}</span></div>
            )}
            {scheduleDaysStr && (
              <div><span style={{ color: 'var(--text-secondary)' }}>Days: </span><span style={{ color: 'var(--text)', fontWeight: 600 }}>{scheduleDaysStr}</span></div>
            )}
            {hasFollowUp && (
              <div style={{ color: '#6366f1', fontWeight: 600 }}>
                Follow-up 1 ({campaign.followUp!.delayDays}d)
                {hasFollowUp2 && ` + Follow-up 2 (${campaign.followUp2!.delayDays}d)`}
              </div>
            )}
          </div>
          {campaign.startedAt && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Started: {new Date(campaign.startedAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

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
  disconnectSender,
  fetchPreview,
  pollProgress,
  sources,
  activeSheetId,
  activeSheetTab,
  onManageSources,
}: Props) {
  const [showSheetPicker, setShowSheetPicker] = useState(false);
  const [pickedSheetId, setPickedSheetId] = useState<string | undefined>(activeSheetId);
  const [pickedSheetTab, setPickedSheetTab] = useState<string | undefined>(activeSheetTab);
  const [showPreview, setShowPreview] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [showSenders, setShowSenders] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleValue, setScheduleValue] = useState('');

  // Persist active campaign across page reloads
  const [activeCampaignId, setActiveCampaignIdRaw] = useState<string | undefined>(
    () => localStorage.getItem('activeCampaignId') || undefined
  );
  function setActiveCampaignId(id: string | undefined) {
    setActiveCampaignIdRaw(id);
    if (id) localStorage.setItem('activeCampaignId', id);
    else localStorage.removeItem('activeCampaignId');
  }

  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);

  const { campaigns, cancelCampaign, pauseCampaign, resumeCampaign, fetchCampaignDetails } = useCampaigns(user);

  async function handleViewDetails(campaign: Campaign) {
    // Fetch full campaign with log events from Postgres
    const full = await fetchCampaignDetails(campaign.id);
    setDetailCampaign(full || campaign);
  }

  // Auto-reconnect live view when a running campaign is detected (e.g. after reload).
  // Track the last running ID we've seen so we only react to changes, not every poll.
  const lastRunningId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (campaigns.length === 0) return;
    const running = campaigns.find(c => c.status === 'running');
    if (running && running.id !== lastRunningId.current) {
      lastRunningId.current = running.id;
      setActiveCampaignId(running.id);
      setShowLive(true);
    }
    if (!running) lastRunningId.current = undefined;
  }, [campaigns]);

  function handleLaunchClick() {
    if (sources.length > 1) {
      setShowSheetPicker(true);
    } else {
      setPickedSheetId(activeSheetId);
      setPickedSheetTab(activeSheetTab);
      setShowLive(false);
      setShowPreview(true);
    }
  }

  function handleSheetPicked(source: SheetSource) {
    setPickedSheetId(source.sheetId);
    setPickedSheetTab(source.sheetTab);
    setShowSheetPicker(false);
    setShowLive(false);
    setShowPreview(true);
  }

  async function handleConfirm(
    excludeIds: string[],
    emailOverrides: Record<string, { subject: string; body: string }>
  ) {
    setShowPreview(false);

    if (showSchedule && scheduleValue) {
      const result = await onRunPipeline({
        excludeIds,
        sheetId: pickedSheetId,
        tab: pickedSheetTab,
        emailOverrides,
        // Pass scheduledAt via cast since onRunPipeline might not have it in opts type
        // — it's actually accepted by the API route
        ...(scheduleValue ? { scheduledAt: new Date(scheduleValue).toISOString() } : {}),
      } as any);
      // Scheduled: don't show live view
    } else {
      const result = await onRunPipeline({ excludeIds, sheetId: pickedSheetId, tab: pickedSheetTab, emailOverrides });
      const campaignId = (result as any)?.campaignId;
      if (campaignId) setActiveCampaignId(campaignId);
      setShowLive(true);
    }
  }

  const userSender = senders.find(s => s.email === user.email);
  const isConnected = !!userSender?.connected;
  const hasAnySender = senders.some(s => s.connected);
  const totalRemaining = senders.filter(s => s.connected).reduce((sum, s) => sum + s.remaining, 0);
  const totalSentToday = senders.filter(s => s.connected).reduce((sum, s) => sum + s.sentToday, 0);

  const activePollProgress = activeCampaignId
    ? () => pollProgress(activeCampaignId)
    : () => pollProgress();

  return (
    <div style={styles.wrap}>

      {/* ── Campaigns section ─────────────────────────────────── */}
      <div style={styles.campaignsSection}>
        <div style={styles.campaignsSectionHeader}>
          <h3 style={styles.campaignsSectionTitle}>Campaigns</h3>
        </div>
        {campaigns.length === 0 ? (
          <div style={styles.campaignsEmpty}>
            No campaigns yet — launch your first one below
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            {campaigns.map(c => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onCancel={cancelCampaign}
                onPause={pauseCampaign}
                onResume={resumeCampaign}
                onViewLive={() => {
                  setActiveCampaignId(c.id);
                  setShowLive(true);
                }}
                onViewDetails={handleViewDetails}
              />
            ))}
          </div>
        )}
      </div>

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
              { n: '1', label: 'Pick contacts', desc: "Review who's next in the queue" },
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
              onClick={handleLaunchClick}
              disabled={loading || !hasAnySender}
            >
              {loading ? '⏳ Running…' : '🚀 Launch Campaign'}
            </button>
            {!showLive && pipelineStatus?.running && (
              <button style={styles.liveBtn} onClick={() => setShowLive(true)}>
                📡 View Live Feed
              </button>
            )}
          </div>

          {/* Schedule for later toggle */}
          <div style={{ marginTop: 14 }}>
            <button
              style={styles.scheduleToggle}
              onClick={() => setShowSchedule(v => !v)}
            >
              {showSchedule ? '▲' : '▼'} Schedule for later
            </button>
            {showSchedule && (
              <div style={styles.scheduleRow}>
                <input
                  type="datetime-local"
                  value={scheduleValue}
                  onChange={e => setScheduleValue(e.target.value)}
                  style={styles.scheduleInput}
                />
                {scheduleValue && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>
                    Will launch at {new Date(scheduleValue).toLocaleString()}
                  </span>
                )}
              </div>
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
              {isConnected ? (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <span style={styles.badgeGreen}>Connected</span>
                  <button
                    style={styles.disconnectBtn}
                    onClick={() => disconnectSender(user.email)}
                    title="Disconnect — you'll need to reconnect to send emails"
                  >✕</button>
                </div>
              ) : (
                <a href={getConnectUrl(user.email)} style={styles.connectBtn}>Connect →</a>
              )}
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
            key={activeCampaignId || 'live'}
            pollProgress={activePollProgress}
            onDone={() => { setShowLive(false); setActiveCampaignId(undefined); onRefresh(); }}
          />
        </div>
      )}

      {/* ── Sheet picker modal ──────────────────────────────────── */}
      {showSheetPicker && (
        <div style={styles.overlay} onClick={() => setShowSheetPicker(false)}>
          <div style={styles.pickerModal} onClick={e => e.stopPropagation()}>
            <div style={styles.pickerHeader}>
              <div>
                <h2 style={styles.pickerTitle}>Choose a campaign sheet</h2>
                <p style={styles.pickerSub}>Select which sheet to pull pending contacts from</p>
              </div>
              <button style={styles.closeBtn} onClick={() => setShowSheetPicker(false)}>✕</button>
            </div>
            <div style={styles.pickerList}>
              {sources.map(source => (
                <button
                  key={source.id}
                  style={{
                    ...styles.pickerRow,
                    ...(source.sheetId === activeSheetId ? styles.pickerRowActive : {}),
                  }}
                  onClick={() => handleSheetPicked(source)}
                >
                  <div style={styles.pickerRowLeft}>
                    <div style={styles.pickerSheetIcon}>📋</div>
                    <div>
                      <div style={styles.pickerName}>{source.name}</div>
                      <div style={styles.pickerMeta}>Tab: {source.sheetTab}</div>
                    </div>
                  </div>
                  <div style={styles.pickerArrow}>→</div>
                </button>
              ))}
              <button
                style={{
                  ...styles.pickerRow,
                  borderStyle: 'dashed',
                  color: 'var(--accent)',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onClick={() => { setShowSheetPicker(false); onManageSources(); }}
              >
                <span>+</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Add a new sheet</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Campaign wizard ──────────────────────────────────────── */}
      {showPreview && (
        <CampaignWizard
          user={user}
          sources={sources}
          activeSheetId={pickedSheetId}
          activeSheetTab={pickedSheetTab}
          onManageSources={onManageSources}
          fetchPreview={fetchPreview}
          pollProgress={pollProgress}
          onLaunch={async (opts) => {
            setShowPreview(false);
            const result = await onRunPipeline({
              excludeIds: opts.excludeIds,
              sheetId: opts.sheetId,
              tab: opts.tab,
              emailOverrides: opts.emailOverrides,
              ...(opts as any),
            } as any);
            const campaignId = (result as any)?.campaignId;
            if (campaignId) setActiveCampaignId(campaignId);
            setShowLive(true);
            return { campaignId };
          }}
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* Campaign details modal */}
      {detailCampaign && (
        <CampaignDetailsModal
          campaign={detailCampaign}
          onClose={() => setDetailCampaign(null)}
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

  // Campaigns section
  campaignsSection: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 20,
  },
  campaignsSectionHeader: {
    marginBottom: 14,
  },
  campaignsSectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    margin: 0,
  },
  campaignsEmpty: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    padding: '8px 0',
  },
  campaignBtn: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
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
  scheduleToggle: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-secondary)',
    fontSize: 12,
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  scheduleRow: {
    display: 'flex',
    alignItems: 'center',
    marginTop: 10,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  scheduleInput: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 7,
    color: 'var(--text)',
    fontSize: 12,
    padding: '6px 10px',
    fontFamily: "'DM Sans', sans-serif",
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
  disconnectBtn: {
    background: 'none',
    border: '1px solid #f8717144',
    borderRadius: 6,
    color: '#f87171',
    fontSize: 12,
    fontWeight: 700,
    padding: '2px 7px',
    cursor: 'pointer',
    lineHeight: 1,
    flexShrink: 0,
    fontFamily: "'DM Sans', sans-serif",
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

  // Sheet picker overlay
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  },
  pickerModal: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    width: '100%',
    maxWidth: 480,
    overflow: 'hidden',
  },
  pickerHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '24px 24px 16px',
    borderBottom: '1px solid var(--border)',
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: 'var(--text)',
    margin: 0,
  },
  pickerSub: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    margin: '3px 0 0',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 18,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1,
    flexShrink: 0,
  },
  pickerList: {
    padding: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  pickerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: "'DM Sans', sans-serif",
    transition: 'border-color 0.15s, background 0.15s',
    width: '100%',
  },
  pickerRowActive: {
    borderColor: 'var(--accent)',
    background: 'var(--accent)11',
  },
  pickerRowLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  pickerSheetIcon: {
    fontSize: 22,
    flexShrink: 0,
  },
  pickerName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
  },
  pickerMeta: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    marginTop: 2,
  },
  pickerArrow: {
    fontSize: 16,
    color: 'var(--accent)',
    fontWeight: 700,
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
