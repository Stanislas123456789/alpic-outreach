import { useState, useEffect, useMemo, useRef } from 'react';
import type { PreviewContact, PipelineProgress } from '../hooks/useApi';
import type { SheetSource } from '../hooks/useConfig';
import type { AuthUser } from '../hooks/useAuth';
import SendLiveView from './SendLiveView';

// ─── Types ───────────────────────────────────────────────────────────────────

type WizardStep = 'sheet' | 'audience' | 'configure' | 'template' | 'followup' | 'review' | 'live';
type SpeedMode = 'slow' | 'normal' | 'fast';
type DistributionMode = 'even' | 'front-loaded' | 'custom';

interface SendWindow {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

interface WeekSchedule {
  activeDays: boolean[]; // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  distributionMode: DistributionMode;
  customWeights?: number[]; // percentages per active day (must sum to 100)
}

interface LaunchOpts {
  name?: string;
  excludeIds: string[];
  sheetId?: string;
  tab?: string;
  emailOverrides: Record<string, { subject: string; body: string }>;
  maxEmails: number;
  speedMode: SpeedMode;
  draftMode: boolean;
  senderEmail: string;
  unsubscribeEnabled?: boolean;
  followUpUnsubscribeEnabled?: boolean;
  sendWindow?: SendWindow;
  weekSchedule?: WeekSchedule;
  followUp?: {
    enabled: boolean;
    delayDays: number;
    subjectEn: string;
    subjectFr: string;
    bodyEn: string;
    bodyFr: string;
  };
  followUp2?: {
    enabled: boolean;
    delayDays: number;
    subjectEn: string;
    subjectFr: string;
    bodyEn: string;
    bodyFr: string;
  };
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
  { id: 'followup', label: 'Follow-up' },
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

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const DISTRIBUTION_OPTIONS: { id: DistributionMode; label: string; desc: string; icon: string; color: string }[] = [
  { id: 'even', label: 'Even', desc: 'Split equally across active days', icon: '=', color: '#34d399' },
  { id: 'front-loaded', label: 'Front-loaded', desc: '40/25/20/10/5% across days', icon: '>', color: '#f59e0b' },
  { id: 'custom', label: 'Custom', desc: 'Set per-day percentages', icon: '%', color: '#6366f1' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, '0')}:00`,
}));

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

  // Campaign name
  const [campaignName, setCampaignName] = useState<string>('');

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
  const [unsubscribeEnabled, setUnsubscribeEnabled] = useState(false);
  const [followUpUnsubscribeEnabled, setFollowUpUnsubscribeEnabled] = useState(true);

  // Send window
  const [sendWindowEnabled, setSendWindowEnabled] = useState(true);
  const [sendWindowStart, setSendWindowStart] = useState(9);
  const [sendWindowEnd, setSendWindowEnd] = useState(17);

  // Week schedule
  const [activeDays, setActiveDays] = useState<boolean[]>([false, true, true, true, true, true, false]); // Mon-Fri
  const [distributionMode, setDistributionMode] = useState<DistributionMode>('even');
  const [customWeights, setCustomWeights] = useState<number[]>([20, 20, 20, 20, 20, 0, 0]);

  // Sender selection — locked to the logged-in user to prevent cross-user sends
  const [senderEmail] = useState<string>(user.email);

  // Step 3.5 — Template editor
  const [tplSenderName, setTplSenderName] = useState(user.name || user.email.split('@')[0]);
  const [tplClosingEn, setTplClosingEn] = useState(() => {
    try {
      const id = localStorage.getItem('alpic_active_template_id');
      if (id) { const ts = JSON.parse(localStorage.getItem('alpic_email_templates') || '[]'); const t = ts.find((x: any) => x.id === id); if (t?.closingEn) return t.closingEn; }
    } catch {}
    return 'Best';
  });
  const [tplClosingFr, setTplClosingFr] = useState(() => {
    try {
      const id = localStorage.getItem('alpic_active_template_id');
      if (id) { const ts = JSON.parse(localStorage.getItem('alpic_email_templates') || '[]'); const t = ts.find((x: any) => x.id === id); if (t?.closingFr) return t.closingFr; }
    } catch {}
    return 'Cordialement';
  });
  const [tplBodyEn, setTplBodyEn] = useState(() => {
    try {
      const id = localStorage.getItem('alpic_active_template_id');
      if (id) {
        const ts = JSON.parse(localStorage.getItem('alpic_email_templates') || '[]');
        const t = ts.find((x: any) => x.id === id);
        if (t?.bodyEn) return t.bodyEn;
        // migrate old hook+cta
        if (t?.hookEn || t?.ctaEn) return [t.hookEn, t.ctaEn].filter(Boolean).join('\n\n');
      }
    } catch {}
    return "{competitors} just launched their ChatGPT {appWord}. Their services are now integrated and natively accessible to 900M+ ChatGPT users. This market is live since January 2026 and we think it could be a great opportunity for {company}. Is it something you're looking at?\n\nAlpic is currently the first app developer in the world and the reference solution in the <a href=\"https://developers.openai.com/apps-sdk/deploy\">OpenAI documentation</a>. Would be happy to give you more insights and explore relevance for {company} in a quick 15-minute talk.";
  });
  const [tplBodyFr, setTplBodyFr] = useState(() => {
    try {
      const id = localStorage.getItem('alpic_active_template_id');
      if (id) {
        const ts = JSON.parse(localStorage.getItem('alpic_email_templates') || '[]');
        const t = ts.find((x: any) => x.id === id);
        if (t?.bodyFr) return t.bodyFr;
        if (t?.hookFr || t?.ctaFr) return [t.hookFr, t.ctaFr].filter(Boolean).join('\n\n');
      }
    } catch {}
    return "{competitors} viennent de lancer leurs {appWord} ChatGPT. Leurs services sont désormais intégrés et nativement accessibles à plus de 900M d'utilisateurs ChatGPT. Ce marché est actif depuis janvier 2026 et nous pensons que c'est une réelle opportunité pour {company}. C'est quelque chose que vous regardez\u00a0?\n\nAlpic est actuellement le premier développeur d'apps au monde et la solution de référence dans la <a href=\"https://developers.openai.com/apps-sdk/deploy\">documentation OpenAI</a>. Je serais ravi de vous donner plus de détails et d'explorer la pertinence pour {company} en 15 minutes.";
  });
  const [tplSubjectEn, setTplSubjectEn] = useState(() => {
    try {
      const id = localStorage.getItem('alpic_active_template_id');
      if (id) { const ts = JSON.parse(localStorage.getItem('alpic_email_templates') || '[]'); const t = ts.find((x: any) => x.id === id); if (t?.subjectEn) return t.subjectEn; }
    } catch {}
    return '';
  });
  const [tplSubjectFr, setTplSubjectFr] = useState(() => {
    try {
      const id = localStorage.getItem('alpic_active_template_id');
      if (id) { const ts = JSON.parse(localStorage.getItem('alpic_email_templates') || '[]'); const t = ts.find((x: any) => x.id === id); if (t?.subjectFr) return t.subjectFr; }
    } catch {}
    return '';
  });
  // Follow-up state — loads from active template if available
  const _tpl = (() => { try {
    const id = localStorage.getItem('alpic_active_template_id');
    if (id) { const ts = JSON.parse(localStorage.getItem('alpic_email_templates') || '[]'); return ts.find((x: any) => x.id === id); }
  } catch {} return null; })();
  const [followUpEnabled, setFollowUpEnabled] = useState(_tpl?.followUpEnabled ?? false);
  const [followUpDelayDays, setFollowUpDelayDays] = useState(_tpl?.followUpDelayDays ?? 4);
  const [followUpSubjectEn, setFollowUpSubjectEn] = useState(_tpl?.followUpSubjectEn ?? '');
  const [followUpSubjectFr, setFollowUpSubjectFr] = useState(_tpl?.followUpSubjectFr ?? '');
  const [followUpBodyEn, setFollowUpBodyEn] = useState(_tpl?.followUpBodyEn ?? 'Just following up on my message below — is this something {company} could explore?');
  const [followUpBodyFr, setFollowUpBodyFr] = useState(_tpl?.followUpBodyFr ?? 'Je reviens vers vous suite à mon message ci-dessous — est-ce quelque chose que {company} pourrait explorer\u00a0?');
  const [followUp2Enabled, setFollowUp2Enabled] = useState(_tpl?.followUp2Enabled ?? false);
  const [followUp2DelayDays, setFollowUp2DelayDays] = useState(_tpl?.followUp2DelayDays ?? 4);
  const [followUp2SubjectEn, setFollowUp2SubjectEn] = useState(_tpl?.followUp2SubjectEn ?? '');
  const [followUp2SubjectFr, setFollowUp2SubjectFr] = useState(_tpl?.followUp2SubjectFr ?? '');
  const [followUp2BodyEn, setFollowUp2BodyEn] = useState(_tpl?.followUp2BodyEn ?? 'Wanted to bump this one more time — happy to jump on a quick call if easier.');
  const [followUp2BodyFr, setFollowUp2BodyFr] = useState(_tpl?.followUp2BodyFr ?? 'Je me permets de relancer une dernière fois — seriez-vous disponible pour un appel rapide\u00a0?');
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

  // ── Auto-fill campaign name from industries ────────────────────────────────

  useEffect(() => {
    if (!campaignName && industries.length > 0) {
      setCampaignName(industries.map(i => i.industry).join(', '));
    }
  }, [industries]);

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

  function textToHtml(text: string): string {
    return text
      .split(/\n\n+/)
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('\n');
  }

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

    const bodyHtml = textToHtml(fill(isFr ? tplBodyFr : tplBodyEn));
    const closing = isFr ? tplClosingFr : tplClosingEn;
    const greeting = isFr ? `Bonjour ${c.firstName},` : `Hi ${c.firstName},`;

    return `<p>${greeting}</p>\n${bodyHtml}\n<p>${closing},<br>${tplSenderName}</p>`;
  }

  // Substitute {competitors}, {company}, {appWord} in a subject template string
  function fillSubject(rawSubject: string, c: PreviewContact): string {
    const comps = c.competitors || 'Your competitors';
    const compCount = comps.split(/[,/]/).filter(Boolean).length;
    const appWord = compCount === 1 ? 'app' : 'apps';
    return rawSubject
      .replace(/{firstName}/g, c.firstName || '')
      .replace(/{competitors}/g, comps)
      .replace(/{competitor}/g, comps.split(/[,/]/)[0]?.trim() || comps)
      .replace(/{company}/g, c.company || 'your company')
      .replace(/{industry}/g, c.industry || '')
      .replace(/{appWord}/g, appWord);
  }

  function buildFollowUpBody(c: PreviewContact, bodyEn: string, bodyFr: string): string {
    const lang = (c.language || 'EN').toUpperCase() as 'EN' | 'FR';
    const isFr = lang === 'FR';
    const comps = c.competitors || 'Your competitors';
    const compCount = comps.split(/[,/]/).filter(Boolean).length;
    const appWord = isFr ? (compCount === 1 ? 'app' : 'apps') : (compCount === 1 ? 'app' : 'apps');
    const fill = (s: string) =>
      s.replace(/{firstName}/g, c.firstName || '')
       .replace(/{company}/g, c.company || 'your company')
       .replace(/{competitors}/g, comps)
       .replace(/{competitor}/g, comps.split(/[,/]/)[0]?.trim() || comps)
       .replace(/{industry}/g, c.industry || '')
       .replace(/{appWord}/g, appWord);

    const body = isFr ? bodyFr : bodyEn;
    return textToHtml(fill(body));
  }

  function applyTemplateOverrides() {
    const overrides: Record<string, { subject: string; body: string }> = { ...emailOverrides };
    for (const c of finalContacts) {
      const lang = (c.language || 'EN').toUpperCase() as 'EN' | 'FR';
      const tplSubject = lang === 'FR' ? tplSubjectFr : tplSubjectEn;
      const resolvedSubject = tplSubject ? fillSubject(tplSubject, c) : c.subject;
      if (!overrides[c.id]) {
        overrides[c.id] = { subject: resolvedSubject, body: buildTplBody(c) };
      } else {
        overrides[c.id] = { subject: overrides[c.id].subject, body: buildTplBody(c) };
      }
    }
    setEmailOverrides(overrides);
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
        name: campaignName || undefined,
        excludeIds,
        sheetId: pickedSheetId || undefined,
        tab: pickedSheetTab || undefined,
        emailOverrides,
        maxEmails: finalContacts.length - manualExcludes.size,
        speedMode,
        draftMode,
        senderEmail,
        unsubscribeEnabled,
        followUpUnsubscribeEnabled,
        sendWindow: {
          enabled: sendWindowEnabled,
          startHour: sendWindowStart,
          endHour: sendWindowEnd,
        },
        weekSchedule: {
          activeDays,
          distributionMode,
          customWeights: distributionMode === 'custom' ? customWeights : undefined,
        },
        followUp: followUpEnabled ? {
          enabled: true,
          delayDays: followUpDelayDays,
          subjectEn: followUpSubjectEn,
          subjectFr: followUpSubjectFr,
          bodyEn: followUpBodyEn,
          bodyFr: followUpBodyFr,
        } : undefined,
        followUp2: followUpEnabled && followUp2Enabled ? {
          enabled: true,
          delayDays: followUp2DelayDays,
          subjectEn: followUp2SubjectEn,
          subjectFr: followUp2SubjectFr,
          bodyEn: followUp2BodyEn,
          bodyFr: followUp2BodyFr,
        } : undefined,
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
              {step === 'followup' && 'Configure automatic follow-up emails for non-responders'}
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

                  {/* Campaign Name */}
                  <div>
                    <div style={S.sectionLabel}>Campaign Name</div>
                    <div style={S.configField}>
                      <input
                        type="text"
                        placeholder={`Campaign ${new Date().toLocaleDateString([], { day: '2-digit', month: 'short' })}`}
                        value={campaignName}
                        onChange={e => setCampaignName(e.target.value)}
                        style={{
                          width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
                          borderRadius: 8, color: 'var(--text)', fontSize: 14, fontWeight: 600,
                          padding: '10px 12px', fontFamily: "'DM Sans', sans-serif",
                          boxSizing: 'border-box' as const,
                        }}
                      />
                      <div style={S.configHint}>Give this campaign a name to identify it later</div>
                    </div>
                  </div>

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
                            type="range" min={1} max={10} value={maxPerCompany}
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

                  {/* Unsubscribe link — initial email only */}
                  <div>
                    <div style={S.sectionLabel}>Unsubscribe link (initial email)</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button
                        onClick={() => setUnsubscribeEnabled(p => !p)}
                        style={{
                          padding: '4px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                          border: `1px solid ${unsubscribeEnabled ? 'var(--accent)' : 'var(--border)'}`,
                          background: unsubscribeEnabled ? 'var(--accent)' : 'none',
                          color: unsubscribeEnabled ? 'white' : 'var(--text-secondary)',
                          cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                        }}
                      >{unsubscribeEnabled ? 'Enabled' : 'Disabled'}</button>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {unsubscribeEnabled ? 'Unsubscribe link on initial email' : 'No unsub link — looks more personal'}
                      </span>
                    </div>
                  </div>

                  {/* Send Window */}
                  <div>
                    <div style={S.sectionLabel}>Send window</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <button
                        onClick={() => setSendWindowEnabled(p => !p)}
                        style={{
                          padding: '4px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                          border: `1px solid ${sendWindowEnabled ? 'var(--accent)' : 'var(--border)'}`,
                          background: sendWindowEnabled ? 'var(--accent)' : 'none',
                          color: sendWindowEnabled ? 'white' : 'var(--text-secondary)',
                          cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                        }}
                      >{sendWindowEnabled ? 'Enabled' : 'Disabled'}</button>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Deliver at optimal time for each recipient's timezone
                      </span>
                    </div>
                    {sendWindowEnabled && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Send between</span>
                        <select
                          value={sendWindowStart}
                          onChange={e => setSendWindowStart(Number(e.target.value))}
                          style={{ ...S.editInput, width: 90, padding: '6px 8px', fontSize: 12 }}
                        >
                          {HOUR_OPTIONS.map(h => (
                            <option key={h.value} value={h.value}>{h.label}</option>
                          ))}
                        </select>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>and</span>
                        <select
                          value={sendWindowEnd}
                          onChange={e => setSendWindowEnd(Number(e.target.value))}
                          style={{ ...S.editInput, width: 90, padding: '6px 8px', fontSize: 12 }}
                        >
                          {HOUR_OPTIONS.map(h => (
                            <option key={h.value} value={h.value}>{h.label}</option>
                          ))}
                        </select>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>in recipient's local time</span>
                      </div>
                    )}
                  </div>

                  {/* Send Schedule */}
                  <div>
                    <div style={S.sectionLabel}>Send schedule</div>
                    {/* Day-of-week toggles */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Active days</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {DAY_LABELS.map((label, i) => {
                          const active = activeDays[i];
                          return (
                            <button
                              key={label}
                              onClick={() => {
                                const next = [...activeDays];
                                next[i] = !next[i];
                                setActiveDays(next);
                              }}
                              style={{
                                width: 44, height: 36, borderRadius: 8,
                                border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                                background: active ? 'var(--accent)18' : 'var(--bg)',
                                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s',
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Distribution mode */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Distribution</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {DISTRIBUTION_OPTIONS.map(opt => (
                          <button
                            key={opt.id}
                            style={{
                              ...S.speedCard,
                              borderColor: distributionMode === opt.id ? opt.color : 'var(--border)',
                              background: distributionMode === opt.id ? `${opt.color}18` : 'var(--bg)',
                            }}
                            onClick={() => setDistributionMode(opt.id)}
                          >
                            <div style={{ fontSize: 16, marginBottom: 6, fontWeight: 700 }}>{opt.icon}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: distributionMode === opt.id ? opt.color : 'var(--text)' }}>
                              {opt.label}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Custom weights editor */}
                    {distributionMode === 'custom' && (
                      <div style={{
                        background: 'var(--bg)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '12px 16px',
                      }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          {DAY_LABELS.map((label, i) => (
                            activeDays[i] && (
                              <div key={label} style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={customWeights[i]}
                                  onChange={e => {
                                    const next = [...customWeights];
                                    next[i] = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                                    setCustomWeights(next);
                                  }}
                                  style={{ ...S.editInput, width: 50, textAlign: 'center' as const, fontSize: 12, padding: '4px 6px' }}
                                />
                                <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>%</span>
                              </div>
                            )
                          ))}
                        </div>
                        {(() => {
                          const total = customWeights.filter((_, i) => activeDays[i]).reduce((a, b) => a + b, 0);
                          return (
                            <div style={{ marginTop: 8, fontSize: 11, color: total === 100 ? '#34d399' : '#f87171', fontWeight: 600 }}>
                              Total: {total}% {total !== 100 && '(must equal 100%)'}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Daily cap display */}
                    {(() => {
                      const activeDayCount = activeDays.filter(Boolean).length;
                      const emailsPerDay = activeDayCount > 0 ? Math.round(finalContacts.length / activeDayCount) : 0;
                      return activeDayCount > 0 ? (
                        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: 'var(--accent)', fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>
                            ~{emailsPerDay}
                          </span>
                          <span>emails/day across {activeDayCount} active days</span>
                        </div>
                      ) : (
                        <div style={{ marginTop: 12, fontSize: 12, color: '#f87171', fontWeight: 600 }}>
                          No active days selected — emails won't be sent
                        </div>
                      );
                    })()}
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
                        ['Send window', sendWindowEnabled ? `${sendWindowStart}:00–${sendWindowEnd}:00 (recipient tz)` : 'Disabled'],
                        ['Schedule', `${activeDays.filter(Boolean).length} days/week, ${distributionMode} distribution`],
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

                    {/* Subject */}
                    <div>
                      <div style={S.sectionLabel}>Subject line</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        Leave blank to use the subject from the sheet.
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>English</div>
                          <input value={tplSubjectEn} onChange={e => setTplSubjectEn(e.target.value)} style={S.editInput} placeholder="e.g. {company} could be available in ChatGPT" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>French</div>
                          <input value={tplSubjectFr} onChange={e => setTplSubjectFr(e.target.value)} style={S.editInput} placeholder="e.g. {company} pourrait être disponible dans ChatGPT" />
                        </div>
                      </div>
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

                    {/* Body */}
                    <div>
                      <div style={S.sectionLabel}>Body</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        Variables: <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>{'{competitors}'}</code>{' '}
                        <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>{'{company}'}</code>{' '}
                        <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>{'{appWord}'}</code>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>English</div>
                          <textarea value={tplBodyEn} onChange={e => setTplBodyEn(e.target.value)} rows={6} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>French</div>
                          <textarea value={tplBodyFr} onChange={e => setTplBodyFr(e.target.value)} rows={6} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Right: live preview */}
                <div style={{ width: 380, flexShrink: 0, padding: 20, overflowY: 'auto' as const, background: 'var(--bg)' }}>
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
                      Subject: {(() => { const raw = (tplPreviewLang === 'FR' ? tplSubjectFr : tplSubjectEn) || tplPreviewContact.subject; return raw ? fillSubject(raw, tplPreviewContact) : raw; })()}
                    </div>
                    <div className="email-preview" dangerouslySetInnerHTML={{ __html: buildTplBody({ ...tplPreviewContact, language: tplPreviewLang }) }} />
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
                  onClick={() => { applyTemplateOverrides(); setStep('followup'); }}
                >
                  Follow-up →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Follow-up ─────────────────────────────────── */}
          {step === 'followup' && (
            <div style={S.stepWrap}>
              <div style={{ ...S.stepContent, display: 'flex', gap: 0, padding: 0, flexDirection: 'row' as const, overflow: 'hidden' }}>
                {/* Left: fields */}
                <div style={{ flex: 1, padding: 24, overflowY: 'auto' as const, borderRight: '1px solid var(--border)' }}>
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                  {/* Header + master toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: followUpEnabled ? 16 : 0 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Follow-up emails</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Sent in the same thread if no reply</div>
                    </div>
                    <button onClick={() => setFollowUpEnabled((p: boolean) => !p)} style={{
                      padding: '4px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      border: `1px solid ${followUpEnabled ? 'var(--accent)' : 'var(--border)'}`,
                      background: followUpEnabled ? 'var(--accent)' : 'none',
                      color: followUpEnabled ? 'white' : 'var(--text-secondary)',
                      cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                    }}>{followUpEnabled ? 'Enabled' : 'Disabled'}</button>
                  </div>

                  {followUpEnabled && (
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 0 }}>
                      {/* ── Follow-up 1 ── */}
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>Follow-up 1</div>
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Send after</span>
                          <input type="number" min={1} max={30} value={followUpDelayDays} onChange={e => setFollowUpDelayDays(Number(e.target.value))} style={{ ...S.editInput, width: 56, textAlign: 'center' as const }} />
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>days without reply</span>
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Subject (EN) — blank = reuse original</div>
                            <input value={followUpSubjectEn} onChange={e => setFollowUpSubjectEn(e.target.value)} style={S.editInput} placeholder="Re: {competitors} on ChatGPT" />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Subject (FR)</div>
                            <input value={followUpSubjectFr} onChange={e => setFollowUpSubjectFr(e.target.value)} style={S.editInput} placeholder="Re: {competitors} sur ChatGPT" />
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Message (EN)</div>
                          <textarea value={followUpBodyEn} onChange={e => setFollowUpBodyEn(e.target.value)} rows={2} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Message (FR)</div>
                          <textarea value={followUpBodyFr} onChange={e => setFollowUpBodyFr(e.target.value)} rows={2} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                        </div>
                      </div>

                      {/* ── Divider ── */}
                      <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0' }} />

                      {/* ── Follow-up 2 ── */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: followUp2Enabled ? 10 : 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>Follow-up 2</div>
                        <button onClick={() => setFollowUp2Enabled((p: boolean) => !p)} style={{
                          padding: '3px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                          border: `1px solid ${followUp2Enabled ? 'var(--accent)' : 'var(--border)'}`,
                          background: followUp2Enabled ? 'var(--accent)' : 'none',
                          color: followUp2Enabled ? 'white' : 'var(--text-secondary)',
                          cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                        }}>{followUp2Enabled ? 'Enabled' : 'Disabled'}</button>
                      </div>
                      {followUp2Enabled && (
                        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Send after</span>
                            <input type="number" min={1} max={30} value={followUp2DelayDays} onChange={e => setFollowUp2DelayDays(Number(e.target.value))} style={{ ...S.editInput, width: 56, textAlign: 'center' as const }} />
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>days after Follow-up 1</span>
                          </div>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Subject (EN) — blank = reuse original</div>
                              <input value={followUp2SubjectEn} onChange={e => setFollowUp2SubjectEn(e.target.value)} style={S.editInput} placeholder="Re: {competitors} on ChatGPT" />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Subject (FR)</div>
                              <input value={followUp2SubjectFr} onChange={e => setFollowUp2SubjectFr(e.target.value)} style={S.editInput} placeholder="Re: {competitors} sur ChatGPT" />
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Message (EN)</div>
                            <textarea value={followUp2BodyEn} onChange={e => setFollowUp2BodyEn(e.target.value)} rows={2} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Message (FR)</div>
                            <textarea value={followUp2BodyFr} onChange={e => setFollowUp2BodyFr(e.target.value)} rows={2} style={{ ...S.editInput, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
                          </div>
                        </div>
                      )}

                      {/* ── Unsub toggle for follow-ups ── */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <button onClick={() => setFollowUpUnsubscribeEnabled(p => !p)} style={{
                            padding: '3px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                            border: `1px solid ${followUpUnsubscribeEnabled ? 'var(--accent)' : 'var(--border)'}`,
                            background: followUpUnsubscribeEnabled ? 'var(--accent)' : 'none',
                            color: followUpUnsubscribeEnabled ? 'white' : 'var(--text-secondary)',
                            cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                          }}>{followUpUnsubscribeEnabled ? 'Unsub link on' : 'Unsub link off'}</button>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            {followUpUnsubscribeEnabled ? 'Follow-ups include an unsubscribe link' : 'No unsub link on follow-ups'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                </div>

                {/* Right: live preview */}
                {followUpEnabled && (
                <div style={{ width: 380, flexShrink: 0, padding: 20, overflowY: 'auto' as const, background: 'var(--bg)' }}>
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

                  {/* Follow-up 1 preview */}
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                    Follow-up 1 — +{followUpDelayDays} days
                  </div>
                  <div style={{
                    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '14px 16px', fontSize: 12, lineHeight: 1.7, color: 'var(--text)', marginBottom: 16,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                      To: {tplPreviewContact.email}<br />
                      Subject: {(() => {
                        const raw = (tplPreviewLang === 'FR' ? followUpSubjectFr : followUpSubjectEn);
                        return raw ? fillSubject(raw, tplPreviewContact) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Re: (original subject)</span>;
                      })()}
                    </div>
                    <div className="email-preview" dangerouslySetInnerHTML={{ __html: buildFollowUpBody({ ...tplPreviewContact, language: tplPreviewLang }, followUpBodyEn, followUpBodyFr) }} />
                  </div>

                  {/* Follow-up 2 preview */}
                  {followUp2Enabled && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                        Follow-up 2 — +{followUpDelayDays + followUp2DelayDays} days
                      </div>
                      <div style={{
                        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
                        padding: '14px 16px', fontSize: 12, lineHeight: 1.7, color: 'var(--text)',
                      }}>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                          To: {tplPreviewContact.email}<br />
                          Subject: {(() => {
                            const raw = (tplPreviewLang === 'FR' ? followUp2SubjectFr : followUp2SubjectEn);
                            return raw ? fillSubject(raw, tplPreviewContact) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Re: (original subject)</span>;
                          })()}
                        </div>
                        <div className="email-preview" dangerouslySetInnerHTML={{ __html: buildFollowUpBody({ ...tplPreviewContact, language: tplPreviewLang }, followUp2BodyEn, followUp2BodyFr) }} />
                      </div>
                    </>
                  )}

                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Preview using <strong>{tplPreviewContact.firstName} {tplPreviewContact.lastName}</strong> @ {tplPreviewContact.company}
                  </div>
                </div>
                )}
              </div>
              <div style={S.footer}>
                <button style={S.btnSecondary} onClick={() => setStep('template')}>← Back</button>
                <button style={S.btnPrimary} onClick={() => setStep('review')}>
                  Review {finalContacts.length} {draftMode ? 'drafts' : 'emails'} →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Review ─────────────────────────────────────── */}
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
                <button style={S.btnSecondary} onClick={() => setStep('followup')}>← Back</button>
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
    borderRadius: 20, width: '100%', maxWidth: 1060,
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
