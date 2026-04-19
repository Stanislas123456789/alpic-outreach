import { useState, useEffect, useMemo, useRef } from 'react';
import type { PreviewContact, PipelineProgress } from '../hooks/useApi';
import type { SheetSource } from '../hooks/useConfig';
import type { AuthUser } from '../hooks/useAuth';
import SendLiveView from './SendLiveView';

// ─── Types ───────────────────────────────────────────────────────────────────

type WizardStep = 'sheet' | 'audience' | 'configure' | 'template' | 'review' | 'live';
type SpeedMode = 'slow' | 'normal' | 'fast';

interface LaunchOpts {
  excludeIds: string[];
  sheetId?: string;
  tab?: string;
  emailOverrides: Record<string, { subject: string; body: string }>;
  maxEmails: number;
  speedMode: SpeedMode;
  draftMode: boolean;
  senderEmail: string;
}

interface Props {
  user: AuthUser;
  sources: SheetSource[];
  activeSheetId?: string;
  activeSheetTab?: string;
  onManageSources: () => void;
  fetchPreview: (sheetId?: string, tab?: string, limit?: number, includeSent?: boolean) => Promise<PreviewContact[]>;
  onLaunch: (opts: LaunchOpts) => Promise<{ campaignId?: string }>;
  pollProgress: (campaignId?: string) => Promise<PipelineProgress>;
  onClose: () => void;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'sheet', label: 'Sheet' },
  { id: 'audience', label: 'Audience' },
  { id: 'configure', label: 'Configure' },
  { id: 'template', label: 'Template' },
  { id: 'review', label: 'Review' },
  { id: 'live', label: 'Live' },
];

function StepIndicator({ current }: { current: WizardStep }) {
  const idx = STEPS.findIndex(s => s.id === current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, userSelect: 'none' }}>
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: done ? '#34d399' : active ? 'var(--accent)' : 'var(--border)',
                color: done || active ? 'white' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, transition: 'background 0.2s',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: 10, fontWeight: active ? 700 : 500,
                color: active ? 'var(--accent)' : done ? '#34d399' : 'var(--text-secondary)',
                transition: 'color 0.2s',
              }}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                width: 40, height: 1, background: i < idx ? '#34d399' : 'var(--border)',
                margin: '0 4px', marginBottom: 18, transition: 'background 0.2s',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Speed config ─────────────────────────────────────────────────────────────

const SPEED_OPTIONS: { id: SpeedMode; label: string; desc: string; color: string; icon: string }[] = [
  { id: 'slow', label: 'Cautious', desc: '3–5 min between emails', color: '#34d399', icon: '🐢' },
  { id: 'normal', label: 'Normal', desc: '90–180 sec between emails', color: '#f59e0b', icon: '🚀' },
  { id: 'fast', label: 'Rapid', desc: '30–60 sec between emails', color: '#f87171', icon: '⚡' },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────

function parseWeekAdded(weekAdded?: string): Date | null {
  if (!weekAdded) return null;

  // Handle ambiguous N1-N2-YYYY formats (DD-MM vs MM-DD).
  // weekAdded is always a past date (when the contact was added), so when
  // both interpretations are mathematically valid we prefer the one that is
  // not in the future — e.g. "04-06-2026" today (Apr 14) is April 6 (MM-DD),
  // not June 4 (DD-MM which would be 51 days in the future).
  const parts = weekAdded.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (parts) {
    const a = parseInt(parts[1]), b = parseInt(parts[2]), year = parseInt(parts[3]);
    const now = Date.now();
    const ddmm = (b >= 1 && b <= 12 && a >= 1 && a <= 31) ? new Date(year, b - 1, a) : null;
    const mmdd = (a >= 1 && a <= 12 && b >= 1 && b <= 31) ? new Date(year, a - 1, b) : null;
    const ddmmOk = ddmm && !isNaN(ddmm.getTime());
    const mmddOk = mmdd && !isNaN(mmdd.getTime());
    if (ddmmOk && mmddOk) {
      // Both valid — prefer whichever is not in the future; ties go to DD-MM.
      if (ddmm!.getTime() > now && mmdd!.getTime() <= now) return mmdd;
      return ddmm;
    }
    if (ddmmOk) return ddmm;
    if (mmddOk) return mmdd;
  }

  // ISO "2026-04-12", natural "Apr 7 2026", etc.
  const d = new Date(weekAdded);
  if (!isNaN(d.getTime())) return d;

  // "W{n}" or "2026-W{n}" ISO week format
  const weekMatch = weekAdded.match(/(?:(\d{4})-)?W(\d{1,2})/i);
  if (weekMatch) {
    const year = weekMatch[1] ? parseInt(weekMatch[1]) : new Date().getFullYear();
    const week = parseInt(weekMatch[2]);
    const jan4 = new Date(year, 0, 4);
    const day1 = jan4.getDate() - (jan4.getDay() || 7) + 1;
    return new Date(year, 0, day1 + (week - 1) * 7);
  }
  return null;
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function CampaignWizard({
  user,
  sources,
  activeSheetId,
  activeSheetTab,
  onManageSources,
  fetchPreview,
  onLaunch,
  pollProgress,
  onClose,
}: Props) {
  const [step, setStep] = useState<WizardStep>('sheet');

  // Step 1
  const [pickedSheetId, setPickedSheetId] = useState<string>(activeSheetId || '');
  const [pickedSheetTab, setPickedSheetTab] = useState<string>(activeSheetTab || '');

  // Step 2
  const [allContacts, setAllContacts] = useState<PreviewContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedIndustries, setSelectedIndustries] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState<string>(''); // ISO date string "YYYY-MM-DD"
  const [excludeAlreadySent, setExcludeAlreadySent] = useState(true);

  // Step 3
  const [maxEmails, setMaxEmails] = useState(20);
  const [maxPerCompany, setMaxPerCompany] = useState(2);
  const [speedMode, setSpeedMode] = useState<SpeedMode>('normal');
  const [draftMode, setDraftMode] = useState(false);

  // Sender selection — locked to the logged-in user to prevent cross-user sends
  const [senderEmail] = useState<string>(user.email);

  // Step 3.5 — Template editor
  const [tplSenderName, setTplSenderName] = useState(user.name || user.email.split('@')[0]);
  const [tplClosingEn, setTplClosingEn] = useState('Best');
  const [tplClosingFr, setTplClosingFr] = useState('Cordialement');
  const [tplHookEn, setTplHookEn] = useState(
    "{competitors} just launched their ChatGPT {appWord}. Their services are now integrated and natively accessible to 900M+ ChatGPT users. This market is live since January 2026 and we think it could be a great opportunity for {company}. Is it something you're looking at?"
  );
  const [tplHookFr, setTplHookFr] = useState(
    "{competitors} viennent de lancer leurs {appWord} ChatGPT. Leurs services sont désormais intégrés et nativement accessibles à plus de 900M d'utilisateurs ChatGPT. Ce marché est actif depuis janvier 2026 et nous pensons que c'est une réelle opportunité pour {company}. C'est quelque chose que vous regardez\u00a0?"
  );
  const [tplCtaEn, setTplCtaEn] = useState(
    'Alpic is currently the first app developer in the world and the reference solution in the <a href="https://developers.openai.com/apps-sdk/deploy">OpenAI documentation</a>. Would be happy to give you more insights and explore relevance for {company} in a quick 15-minute talk.'
  );
  const [tplCtaFr, setTplCtaFr] = useState(
    "Alpic est actuellement le premier développeur d'apps au monde et la solution de référence dans la <a href=\"https://developers.openai.com/apps-sdk/deploy\">documentation OpenAI</a>. Je serais ravi de vous donner plus de détails et d'explorer la pertinence pour {company} en 15 minutes."
  );
  const [tplPreviewLang, setTplPreviewLang] = useState<'EN' | 'FR'>('EN');

  // Step 4
  const [emailOverrides, setEmailOverrides] = useState<Record<string, { subject: string; body: string }>>({});
  const [manualExcludes, setManualExcludes] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Step 5
  const [activeCampaignId, setActiveCampaignId] = useState<string | undefined>();
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // ── Derived data ────────────────────────────────────────────────────────────

  const industries = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of allContacts) {
      if (c.industry) map.set(c.industry, (map.get(c.industry) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([industry, count]) => ({ industry, count }));
  }, [allContacts]);

  // Counts for dedup badge
  const alreadySentCount = useMemo(() => allContacts.filter(c => c.alreadySent).length, [allContacts]);
  const pendingOnly = useMemo(() => allContacts.filter(c => !c.alreadySent), [allContacts]);

  // Date-filtered contacts (always exclude already-sent unless toggle is off)
  const dateFilteredContacts = useMemo(() => {
    const base = excludeAlreadySent ? pendingOnly : allContacts;
    if (!dateFrom) return base;
    const [cy, cm, cd] = dateFrom.split('-').map(Number);
    const cutoff = new Date(cy, cm - 1, cd);
    return base.filter(c => {
      const d = parseWeekAdded(c.weekAdded);
      if (!d) return true;
      return d >= cutoff;
    });
  }, [allContacts, pendingOnly, dateFrom, excludeAlreadySent]);

  // Contacts passing industry + date filter
  const audienceContacts = useMemo(() => {
    if (selectedIndustries.size === 0) return dateFilteredContacts;
    return dateFilteredContacts.filter(c => selectedIndustries.has(c.industry));
  }, [dateFilteredContacts, selectedIndustries]);

  // Auto-sync maxEmails to full audience size whenever the audience changes.
  const prevAudienceLen = useRef(0);
  useEffect(() => {
    if (audienceContacts.length > 0 && audienceContacts.length !== prevAudienceLen.current) {
      setMaxEmails(audienceContacts.length);
      prevAudienceLen.current = audienceContacts.length;
    }
  }, [audienceContacts.length]);

  // After capping per-company and total
  const finalContacts = useMemo(() => {
    const companyCounts = new Map<string, number>();
    const result: PreviewContact[] = [];
    for (const c of audienceContacts) {
      if (manualExcludes.has(c.id)) continue;
      const count = companyCounts.get(c.company) || 0;
      if (count >= maxPerCompany) continue;
      companyCounts.set(c.company, count + 1);
      result.push(c);
      if (result.length >= maxEmails) break;
    }
    return result;
  }, [audienceContacts, maxPerCompany, maxEmails, manualExcludes]);

  // All contacts NOT in finalContacts → pass as excludeIds to pipeline
  const excludeIds = useMemo(() => {
    const included = new Set(finalContacts.map(c => c.id));
    return allContacts.filter(c => !included.has(c.id)).map(c => c.id);
  }, [allContacts, finalContacts]);

  // ── Auto-select first sheet if only one ────────────────────────────────────

  useEffect(() => {
    if (!pickedSheetId && sources.length === 1) {
      setPickedSheetId(sources[0].sheetId);
      setPickedSheetTab(sources[0].sheetTab);
    }
  }, [sources]);

  // ── Fetch contacts when reaching Step 2 ────────────────────────────────────

  async function fetchContacts() {
    setLoadingContacts(true);
    setFetchError(null);
    try {
      // Fetch pending + already-sent contacts so we can show the dedup count
      const data = await fetchPreview(pickedSheetId || undefined, pickedSheetTab || undefined, 500, true);
      setAllContacts(data);
      // Select all industries by default (only from pending contacts)
      const inds = new Set(data.filter(c => !c.alreadySent).map(c => c.industry).filter(Boolean));
      setSelectedIndustries(inds);
    } catch (err: any) {
      setFetchError(err.message);
    } finally {
      setLoadingContacts(false);
    }
  }

  // ── Template helpers ────────────────────────────────────────────────────────

  function buildTplBody(c: PreviewContact): string {
    const lang = (c.language || 'EN').toUpperCase() as 'EN' | 'FR';
    const isFr = lang === 'FR';
    const comps = c.competitors || 'Your competitors';
    const compCount = comps.split(/[,/]/).filter(Boolean).length;
    const appWord = isFr ? (compCount === 1 ? 'app' : 'apps') : (compCount === 1 ? 'app' : 'apps');
    const fill = (s: string) =>
      s.replace(/{competitors}/g, comps)
       .replace(/{company}/g, c.company || 'your company')
       .replace(/{appWord}/g, appWord);

    const hook = fill(isFr ? tplHookFr : tplHookEn);
    const cta  = fill(isFr ? tplCtaFr  : tplCtaEn);
    const closing = isFr ? tplClosingFr : tplClosingEn;
    const greeting = isFr ? `Bonjour ${c.firstName},` : `Hi ${c.firstName},`;

    return `<p>${greeting}</p>\n\n<p>${hook}</p>\n\n<p>${cta}</p>\n\n<p>${closing},<br>${tplSenderName}</p>`;
  }

  // Apply template to all final contacts before entering Review
  function applyTemplateAndGoToReview() {
    const overrides: Record<string, { subject: string; body: string }> = { ...emailOverrides };
    for (const c of finalContacts) {
      if (!overrides[c.id]) {
        overrides[c.id] = { subject: c.subject, body: buildTplBody(c) };
      } else {
        // Re-apply template body but keep any subject override
        overrides[c.id] = { subject: overrides[c.id].subject, body: buildTplBody(c) };
      }
    }
    setEmailOverrides(overrides);
    setStep('review');
  }

  // Preview for template step — first contact or dummy
  const tplPreviewContact: PreviewContact = finalContacts.find(c =>
    (c.language || 'EN').toUpperCase() === tplPreviewLang
  ) || finalContacts[0] || {
    id: '__preview__', rowIndex: 0,
    firstName: 'John', lastName: 'Doe', email: 'john@example.com',
    company: 'Acme Corp', industry: 'Travel', country: '', role: '',
    language: tplPreviewLang, competitors: 'Competitor A, Competitor B',
    competitorsLive: '', subject: '', body: '',
  };

  // ── Navigation ──────────────────────────────────────────────────────────────

  function goToAudience() {
    setStep('audience');
    fetchContacts();
  }

  async function handleLaunch() {
    setLaunching(true);
    setLaunchError(null);
    try {
      const result = await onLaunch({
        excludeIds,
        sheetId: pickedSheetId || undefined,
        tab: pickedSheetTab || undefined,
        emailOverrides,
        maxEmails: finalContacts.length - manualExcludes.size,
        speedMode,
        draftMode,
        senderEmail,
      });
      setActiveCampaignId(result?.campaignId);
      setStep('live');
    } catch (err: any) {
      setLaunchError(err.message);
    } finally {
      setLaunching(false);
    }
  }

  // ── Override helpers ────────────────────────────────────────────────────────

  function getOverride(c: PreviewContact) {
    return emailOverrides[c.id] || { subject: c.subject, body: c.body };
  }

  function setOverride(id: string, subject: string, body: string) {
    setEmailOverrides(prev => ({ ...prev, [id]: { subject, body } }));
  }

  function toggleExclude(id: string) {
    setManualExcludes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const readyToSend = finalContacts.length - manualExcludes.size;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={S.header}>
          <div>
            <h2 style={S.title}>Launch Campaign</h2>
            <p style={S.subtitle}>
              {step === 'sheet' && 'Select the sheet to pull contacts from'}
              {step === 'audience' && 'Choose which industries and contacts to include'}
              {step === 'configure' && 'Set send speed, volume, and options'}
              {step === 'template' && 'Edit the email template — changes apply to all contacts'}
              {step === 'review' && 'Review contacts and edit emails before sending'}
              {step === 'live' && (draftMode ? 'Drafts are being created in Gmail' : 'Campaign is running — watch emails go out live')}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <StepIndicator current={step} />
            {step !== 'live' && (
              <button style={S.closeBtn} onClick={onClose}>✕</button>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={S.body}>

          {/* ── STEP 1: Sheet ─────────────────────────────────────── */}
          {step === 'sheet' && (
            <div style={S.stepWrap}>
              <div style={S.stepContent}>
                {sources.length === 0 ? (
                  <div style={S.emptyState}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>No sheets connected</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>Add a Google Sheet to get started</div>
                    <button style={S.btnPrimary} onClick={() => { onClose(); onManageSources(); }}>
                      + Add a sheet
                    </button>
                  </div>
                ) : (
                  <div style={S.sheetGrid}>
                    {sources.map(source => {
                      const active = source.sheetId === pickedSheetId && source.sheetTab === pickedSheetTab;
                      return (
                        <button
                          key={source.id}
                          style={{
                            ...S.sheetCard,
                            borderColor: active ? 'var(--accent)' : 'var(--border)',
                            background: active ? 'var(--accent)11' : 'var(--bg)',
                          }}
                          onClick={() => { setPickedSheetId(source.sheetId); setPickedSheetTab(source.sheetTab); }}
                        >
                          <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{source.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tab: {source.sheetTab}</div>
                          {active && (
                            <div style={{
                              position: 'absolute', top: 10, right: 10,
                              width: 18, height: 18, borderRadius: '50%',
                              background: 'var(--accent)', display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, color: 'white', fontWeight: 700,
                            }}>✓</div>
                          )}
                        </button>
                      );
                    })}
                    <button
                      style={{ ...S.sheetCard, borderStyle: 'dashed', borderColor: 'var(--accent)88', background: 'none', color: 'var(--accent)' }}
                      onClick={() => { onClose(); onManageSources(); }}
                    >
                      <div style={{ fontSize: 28, marginBottom: 10 }}>+</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>Add new sheet</div>
                    </button>
                  </div>
                )}
              </div>
              <div style={S.footer}>
                <button style={S.btnSecondary} onClick={onClose}>Cancel</button>
                <button
                  style={{ ...S.btnPrimary, opacity: !pickedSheetId ? 0.4 : 1 }}
                  disabled={!pickedSheetId}
                  onClick={goToAudience}
                >
                  Next: Audience →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Audience ──────────────────────────────────── */}
          {step === 'audience' && (
            <div style={S.stepWrap}>
              <div style={S.stepContent}>
                {loadingContacts ? (
                  <div style={S.loadingWrap}>
                    <div style={S.spinner} />
                    <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading contacts from sheet…</p>
                  </div>
                ) : fetchError ? (
                  <div style={S.errorBox}>
                    <div style={{ fontWeight: 600, color: '#f87171', marginBottom: 6 }}>Could not load contacts</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>{fetchError}</div>
                    <button style={S.btnSecondary} onClick={fetchContacts}>Retry</button>
                  </div>
                ) : (
                  <>
                    {/* Dedup toggle */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: excludeAlreadySent ? '#34d39911' : '#f8717111',
                      border: `1px solid ${excludeAlreadySent ? '#34d39944' : '#f8717144'}`,
                      borderRadius: 10, padding: '10px 14px', marginBottom: 20,
                    }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
                        <input
                          type="checkbox"
                          checked={excludeAlreadySent}
                          onChange={e => setExcludeAlreadySent(e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: '#34d399', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 600, color: excludeAlreadySent ? '#34d399' : '#f87171' }}>
                          {excludeAlreadySent ? '✓ Skip already contacted' : '⚠ Including already contacted'}
                        </span>
                      </label>
                      {alreadySentCount > 0 && (
                        <span style={{
                          background: excludeAlreadySent ? '#34d39922' : '#f8717122',
                          color: excludeAlreadySent ? '#34d399' : '#f87171',
                          borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700,
                        }}>
                          {alreadySentCount} already sent
                        </span>
                      )}
                      {alreadySentCount === 0 && (
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No duplicates found</span>
                      )}
                    </div>

                    {/* Date filter */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={S.sectionLabel}>Filter by date added</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Added after:</label>
                          <input
                            type="date"
                            value={dateFrom}
                            onChange={e => setDateFrom(e.target.value)}
                            style={S.dateInput}
                          />
                          {dateFrom && (
                            <button
                              style={{ ...S.clearBtn }}
                              onClick={() => setDateFrom('')}
                            >✕ Clear</button>
                          )}
                        </div>
                        {dateFrom && (
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {dateFilteredContacts.length} / {allContacts.length} contacts after this date
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Industry filter */}
                    <div style={{ marginBottom: 24 }}>
                      <div style={S.sectionLabel}>Filter by industry</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <button
                          style={{
                            ...S.industryPill,
                            borderColor: selectedIndustries.size === industries.length ? 'var(--accent)' : 'var(--border)',
                            background: selectedIndustries.size === industries.length ? 'var(--accent)22' : 'none',
                            color: selectedIndustries.size === industries.length ? 'var(--accent)' : 'var(--text-secondary)',
                          }}
                          onClick={() => {
                            if (selectedIndustries.size === industries.length) {
                              setSelectedIndustries(new Set());
                            } else {
                              setSelectedIndustries(new Set(industries.map(i => i.industry)));
                            }
                          }}
                        >
                          All ({dateFilteredContacts.length})
                        </button>
                        {industries.map(({ industry, count }) => {
                          // Recount after date filter
                          const filteredCount = dateFilteredContacts.filter(c => c.industry === industry).length;
                          if (filteredCount === 0) return null;
                          const sel = selectedIndustries.has(industry);
                          return (
                            <button
                              key={industry}
                              style={{
                                ...S.industryPill,
                                borderColor: sel ? 'var(--accent)' : 'var(--border)',
                                background: sel ? 'var(--accent)22' : 'none',
                                color: sel ? 'var(--accent)' : 'var(--text)',
                              }}
                              onClick={() => {
                                setSelectedIndustries(prev => {
                                  const next = new Set(prev);
                                  sel ? next.delete(industry) : next.add(industry);
                                  return next;
                                });
                              }}
                            >
                              {industry} <span style={{ opacity: 0.6 }}>({filteredCount})</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div style={S.audienceSummary}>
                      <div style={S.audienceStat}>
                        <span style={S.audienceStatVal}>{audienceContacts.length}</span>
                        <span style={S.audienceStatLabel}>contacts matched</span>
                      </div>
                      <div style={S.audienceDivider} />
                      <div style={S.audienceStat}>
                        <span style={S.audienceStatVal}>{new Set(audienceContacts.map(c => c.company)).size}</span>
                        <span style={S.audienceStatLabel}>companies</span>
                      </div>
                      <div style={S.audienceDivider} />
                      <div style={S.audienceStat}>
                        <span style={S.audienceStatVal}>{selectedIndustries.size}</span>
                        <span style={S.audienceStatLabel}>industries</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div style={S.footer}>
                <button style={S.btnSecondary} onClick={() => setStep('sheet')}>← Back</button>
                <button
                  style={{ ...S.btnPrimary, opacity: audienceContacts.length === 0 ? 0.4 : 1 }}
                  disabled={audienceContacts.length === 0 || loadingContacts}
                  onClick={() => setStep('configure')}
                >
                  Next: Configure →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Configure ─────────────────────────────────── */}
          {step === 'configure' && (
            <div style={S.stepWrap}>
              <div style={S.stepContent}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

                  {/* Volume */}
                  <div>
                    <div style={S.sectionLabel}>Volume</div>
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      <div style={S.configField}>
                        <label style={S.configLabel}>Max emails to send</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <input
                            type="range" min={1} max={Math.min(100, audienceContacts.length || 100)} value={maxEmails}
                            onChange={e => setMaxEmails(Number(e.target.value))}
                            style={{ flex: 1, accentColor: 'var(--accent)' }}
                          />
                          <span style={S.configVal}>{maxEmails}</span>
                        </div>
                        <div style={S.configHint}>From {audienceContacts.length} available contacts</div>
                      </div>
                      <div style={S.configField}>
                        <label style={S.configLabel}>Max contacts per company</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <input
                            type="range" min={1} max={5} value={maxPerCompany}
                            onChange={e => setMaxPerCompany(Number(e.target.value))}
                            style={{ flex: 1, accentColor: 'var(--accent)' }}
                          />
                          <span style={S.configVal}>{maxPerCompany}</span>
                        </div>
                        <div style={S.configHint}>Avoid over-contacting the same company</div>
                      </div>
                    </div>
                  </div>

                  {/* Speed */}
                  <div>
                    <div style={S.sectionLabel}>Send speed</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {SPEED_OPTIONS.map(opt => (
                        <button
                          key={opt.id}
                          style={{
                            ...S.speedCard,
                            borderColor: speedMode === opt.id ? opt.color : 'var(--border)',
                            background: speedMode === opt.id ? `${opt.color}18` : 'var(--bg)',
                          }}
                          onClick={() => setSpeedMode(opt.id)}
                        >
                          <div style={{ fontSize: 16, marginBottom: 6 }}>{opt.icon}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: speedMode === opt.id ? opt.color : 'var(--text)' }}>
                            {opt.label}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Draft mode */}
                  <div>
                    <div style={S.sectionLabel}>Send mode</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        style={{
                          ...S.modeCard,
                          borderColor: !draftMode ? 'var(--accent)' : 'var(--border)',
                          background: !draftMode ? 'var(--accent)18' : 'var(--bg)',
                        }}
                        onClick={() => setDraftMode(false)}
                      >
                        <div style={{ fontSize: 16, marginBottom: 6 }}>🚀</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: !draftMode ? 'var(--accent)' : 'var(--text)' }}>Send now</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>Emails sent immediately</div>
                      </button>
                      <button
                        style={{
                          ...S.modeCard,
                          borderColor: draftMode ? '#f59e0b' : 'var(--border)',
                          background: draftMode ? '#f59e0b18' : 'var(--bg)',
                        }}
                        onClick={() => setDraftMode(true)}
                      >
                        <div style={{ fontSize: 16, marginBottom: 6 }}>📝</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: draftMode ? '#f59e0b' : 'var(--text)' }}>Draft mode</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>Saved as Gmail drafts to review</div>
                      </button>
                    </div>
                  </div>

                  {/* Summary */}
                  <div style={S.summaryBox}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Campaign summary</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {[
                        ['From', senderEmail],
                        ['Sheet', sources.find(s => s.sheetId === pickedSheetId)?.name || pickedSheetTab],
                        ['Industries', selectedIndustries.size === industries.length ? 'All' : Array.from(selectedIndustries).join(', ')],
                        ['Date filter', dateFrom ? `After ${new Date(dateFrom).toLocaleDateString()}` : 'None'],
                        ['Emails', `${finalContacts.length} to send (max ${maxEmails}, max ${maxPerCompany}/company)`],
                        ['Speed', SPEED_OPTIONS.find(o => o.id === speedMode)?.label || speedMode],
                        ['Mode', draftMode ? 'Draft (no emails sent)' : 'Live send'],
                      ].map(([label, val]) => (
                        <div key={label} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                          <span style={{ color: 'var(--text-secondary)', minWidth: 80 }}>{label}</span>
                          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div style={S.footer}>
                <button style={S.btnSecondary} onClick={() => setStep('audience')}>← Back</button>
                <button
                  style={{ ...S.btnPrimary, opacity: finalContacts.length === 0 ? 0.4 : 1 }}
                  disabled={finalContacts.length === 0}
                  onClick={() => setStep('template')}
                >
                  Edit Template →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3.5: Template editor ─────────────────────────── */}
          {step === 'template' && (
            <div style={S.stepWrap}>
              <div style={{ ...S.stepContent, display: 'flex', gap: 0, padding: 0, flexDirection: 'row' as const, overflow: 'hidden' }}>
                {/* Left: fields */}
                <div style={{ flex: 1, padding: 24, overflowY: 'auto' as const, borderRight: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 20 }}>

                    {/* Sender name */}
                    <div>
                      <div style={S.sectionLabel}>Sender name (sign-off)</div>
                      <input
                        value={tplSenderName}
                        onChange={e => setTplSenderName(e.target.value)}
                        style={S.editInput}
                        placeholder="Stanislas Michel"
                      />
                    </div>

                    {/* Closing */}
                    <div>
                      <div style={S.sectionLabel}>Closing</div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>English</div>
                          <input value={tplClosingEn} onChange={e => setTplClosingEn(e.target.value)} style={S.editInput} placeholder="Best" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>French</div>
                          <input value={tplClosingFr} onChange={e => setTplClosingFr(e.target.value)} style={S.editInput} placeholder="Cordialement" />
                        </div>
                      </div>
                    </div>

                    {/* Hook paragraph */}
                    <div>
                      <div style={S.sectionLabel}>Hook paragraph</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        Variables: <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>{'{competitors}'}</code>{' '}
                        <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>{'{company}'}</code>{' '}
                        <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>{'{appWord}'}</code>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>English</div>
                          <textarea value={tplHookEn} onChange={e => setTplHookEn(e.target.value)} rows={3} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>French</div>
                          <textarea value={tplHookFr} onChange={e => setTplHookFr(e.target.value)} rows={3} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                        </div>
                      </div>
                    </div>

                    {/* CTA paragraph */}
                    <div>
                      <div style={S.sectionLabel}>CTA / closing pitch</div>
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>English</div>
                          <textarea value={tplCtaEn} onChange={e => setTplCtaEn(e.target.value)} rows={3} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>French</div>
                          <textarea value={tplCtaFr} onChange={e => setTplCtaFr(e.target.value)} rows={3} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Right: live preview */}
                <div style={{ width: 320, flexShrink: 0, padding: 20, overflowY: 'auto' as const, background: 'var(--bg)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.07em' }}>Live preview</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['EN', 'FR'] as const).map(lang => (
                        <button key={lang} onClick={() => setTplPreviewLang(lang)} style={{
                          padding: '2px 8px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
                          border: `1px solid ${tplPreviewLang === lang ? 'var(--accent)' : 'var(--border)'}`,
                          background: tplPreviewLang === lang ? 'var(--accent)22' : 'none',
                          color: tplPreviewLang === lang ? 'var(--accent)' : 'var(--text-secondary)',
                        }}>{lang}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{
                    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '14px 16px', fontSize: 12, lineHeight: 1.7, color: 'var(--text)',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                      To: {tplPreviewContact.email}<br />
                      Subject: {tplPreviewContact.subject}
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: buildTplBody({ ...tplPreviewContact, language: tplPreviewLang }) }} />
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Preview using <strong>{tplPreviewContact.firstName} {tplPreviewContact.lastName}</strong> @ {tplPreviewContact.company}.
                    Changes apply to all {finalContacts.length} contacts when you proceed.
                  </div>
                </div>
              </div>
              <div style={S.footer}>
                <button style={S.btnSecondary} onClick={() => setStep('configure')}>← Back</button>
                <button
                  style={{ ...S.btnPrimary, opacity: finalContacts.length === 0 ? 0.4 : 1 }}
                  disabled={finalContacts.length === 0}
                  onClick={applyTemplateAndGoToReview}
                >
                  Review {finalContacts.length} {draftMode ? 'drafts' : 'emails'} →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Review ────────────────────────────────────── */}
          {step === 'review' && (
            <div style={S.stepWrap}>
              <div style={{ ...S.stepContent, padding: 0 }}>
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text)' }}>{readyToSend}</strong> emails queued
                    {draftMode && <span style={{ marginLeft: 8, color: '#f59e0b', fontWeight: 600 }}>· DRAFT MODE</span>}
                    · <span style={{ fontSize: 12 }}>click any row to preview or edit</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Toggle row to exclude</div>
                </div>
                <div style={{ overflowY: 'auto', maxHeight: 380 }}>
                  {finalContacts.map((c, i) => {
                    const excluded = manualExcludes.has(c.id);
                    const expanded = expandedId === c.id;
                    const editing = editingId === c.id;
                    const ov = getOverride(c);
                    return (
                      <div key={c.id} style={{
                        borderBottom: '1px solid var(--border)',
                        opacity: excluded ? 0.4 : 1,
                        transition: 'opacity 0.15s',
                      }}>
                        <div
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 24px', cursor: 'pointer',
                            background: expanded ? 'var(--accent)08' : 'none',
                          }}
                          onClick={() => setExpandedId(expanded ? null : c.id)}
                        >
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 22 }}>{i + 1}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {c.firstName} {c.lastName}
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>· {c.company}</span>
                              <span style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 4,
                                background: 'var(--accent)22', color: 'var(--accent)',
                              }}>{c.industry}</span>
                              {c.weekAdded && (
                                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{c.weekAdded}</span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {ov.subject}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                            <button
                              style={{ ...S.rowBtn, color: excluded ? '#34d399' : '#f87171' }}
                              onClick={e => { e.stopPropagation(); toggleExclude(c.id); }}
                            >
                              {excluded ? '+ Include' : '✕ Exclude'}
                            </button>
                            <button
                              style={{ ...S.rowBtn, color: 'var(--accent)' }}
                              onClick={e => { e.stopPropagation(); setExpandedId(c.id); setEditingId(editing ? null : c.id); }}
                            >
                              {editing ? 'Done' : 'Edit'}
                            </button>
                          </div>
                        </div>
                        {expanded && (
                          <div style={{ padding: '0 24px 16px 58px' }}>
                            {editing ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <input
                                  value={ov.subject}
                                  onChange={e => setOverride(c.id, e.target.value, ov.body)}
                                  style={S.editInput}
                                  placeholder="Subject"
                                />
                                <textarea
                                  value={ov.body}
                                  onChange={e => setOverride(c.id, ov.subject, e.target.value)}
                                  rows={6}
                                  style={{ ...S.editInput, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                                  placeholder="Email body"
                                />
                              </div>
                            ) : (
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Subject: {ov.subject}</div>
                                <div style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>{ov.body}</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={S.footer}>
                <button style={S.btnSecondary} onClick={() => setStep('template')}>← Back</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {launchError && <span style={{ fontSize: 12, color: '#f87171' }}>{launchError}</span>}
                  <button
                    style={{
                      ...S.btnPrimary,
                      background: draftMode ? '#f59e0b' : 'var(--accent)',
                      opacity: launching || readyToSend === 0 ? 0.4 : 1,
                      minWidth: 180,
                    }}
                    disabled={launching || readyToSend === 0}
                    onClick={handleLaunch}
                  >
                    {launching
                      ? '⏳ Launching…'
                      : draftMode
                        ? `📝 Create ${readyToSend} drafts`
                        : `🚀 Send ${readyToSend} emails`
                    }
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 5: Live ──────────────────────────────────────── */}
          {step === 'live' && (
            <div style={S.stepWrap}>
              <div style={{ ...S.stepContent, padding: 24 }}>
                {draftMode && (
                  <div style={{ ...S.draftBanner }}>
                    📝 Draft mode — emails are being created as Gmail drafts, not sent
                  </div>
                )}
                <SendLiveView
                  pollProgress={activeCampaignId ? () => pollProgress(activeCampaignId) : () => pollProgress()}
                  onDone={() => { /* user closes manually */ }}
                />
              </div>
              <div style={S.footer}>
                <button style={S.btnSecondary} onClick={onClose}>Close</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000, padding: 16,
  },
  modal: {
    background: 'var(--card)', border: '1px solid var(--border)',
    borderRadius: 20, width: '100%', maxWidth: 800,
    maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
  },
  header: {
    padding: '20px 28px', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 16,
  },
  title: {
    fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px',
  },
  subtitle: {
    fontSize: 12, color: 'var(--text-secondary)', margin: 0,
  },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text-secondary)',
    fontSize: 18, cursor: 'pointer', padding: 4, lineHeight: 1,
    flexShrink: 0, marginLeft: 8,
  },
  body: {
    flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
  },
  stepWrap: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  stepContent: {
    flex: 1, overflowY: 'auto', padding: 28,
  },
  footer: {
    padding: '16px 28px', borderTop: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'var(--card)', flexShrink: 0,
  },
  emptyState: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', padding: '60px 20px', textAlign: 'center',
  },

  // Sheet grid
  sheetGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12,
  },
  sheetCard: {
    position: 'relative', display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '20px 16px', borderRadius: 12,
    border: '2px solid', cursor: 'pointer', transition: 'all 0.15s',
    fontFamily: "'DM Sans', sans-serif", textAlign: 'center',
  },

  // Date input
  dateInput: {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 7, color: 'var(--text)', fontSize: 12, padding: '6px 10px',
    fontFamily: "'DM Sans', sans-serif",
  },
  clearBtn: {
    background: 'none', border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--text-secondary)', fontSize: 11, padding: '4px 8px',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },

  // Industry pills
  industryPill: {
    padding: '6px 14px', borderRadius: 20, border: '1px solid',
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s',
    lineHeight: 1.3,
  },

  // Audience summary
  audienceSummary: {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '16px 24px',
    display: 'flex', alignItems: 'center', gap: 0,
  },
  audienceStat: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  },
  audienceStatVal: {
    fontSize: 28, fontWeight: 700, color: 'var(--accent)',
  },
  audienceStatLabel: {
    fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  audienceDivider: {
    width: 1, height: 40, background: 'var(--border)',
  },

  // Configure
  sectionLabel: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12,
  },
  configField: {
    flex: 1, minWidth: 200,
  },
  configLabel: {
    fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8,
  },
  configVal: {
    fontSize: 18, fontWeight: 700, color: 'var(--accent)', minWidth: 32, textAlign: 'center',
  },
  configHint: {
    fontSize: 11, color: 'var(--text-secondary)', marginTop: 4,
  },
  speedCard: {
    flex: 1, padding: '16px 12px', borderRadius: 12, border: '2px solid',
    cursor: 'pointer', textAlign: 'center', fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.15s', minWidth: 100,
  },
  modeCard: {
    flex: 1, padding: '16px 12px', borderRadius: 12, border: '2px solid',
    cursor: 'pointer', textAlign: 'center', fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.15s', minWidth: 140,
  },
  summaryBox: {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '16px 20px',
  },

  // Review
  rowBtn: {
    background: 'none', border: '1px solid var(--border)', borderRadius: 6,
    fontSize: 11, fontWeight: 600, padding: '4px 10px', cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  editInput: {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 7, color: 'var(--text)', fontSize: 13, padding: '8px 10px',
    fontFamily: "'DM Sans', sans-serif", width: '100%', boxSizing: 'border-box',
  },

  // Draft banner
  draftBanner: {
    background: '#f59e0b22', border: '1px solid #f59e0b44',
    borderRadius: 8, padding: '10px 16px', fontSize: 13,
    color: '#f59e0b', fontWeight: 600, marginBottom: 20,
  },

  // Buttons
  btnPrimary: {
    background: 'var(--accent)', color: 'white', border: 'none',
    borderRadius: 9, padding: '10px 24px', fontSize: 14, fontWeight: 700,
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'opacity 0.15s',
  },
  btnSecondary: {
    background: 'none', color: 'var(--text-secondary)', border: '1px solid var(--border)',
    borderRadius: 9, padding: '10px 20px', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },

  // Loading
  loadingWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 16, padding: 60,
  },
  spinner: {
    width: 32, height: 32, borderRadius: '50%',
    border: '3px solid var(--border)',
    borderTopColor: 'var(--accent)',
    animation: 'spin 0.8s linear infinite',
  },
  errorBox: {
    background: '#f871711a', border: '1px solid #f8717144',
    borderRadius: 10, padding: '16px 20px',
  },
};
