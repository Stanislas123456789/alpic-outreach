import { useState } from 'react';
import { useTemplates } from '../hooks/useTemplates';
import type { EmailTemplate } from '../hooks/useTemplates';
import type { AuthUser } from '../hooks/useAuth';
import type { SenderStatus } from '../hooks/useApi';

interface Props {
  user: AuthUser;
  senders: SenderStatus[];
  getConnectUrl: (email: string) => string;
  disconnectSender: (email: string) => Promise<void>;
  updateSenderLimit: (email: string, dailyLimit: number) => Promise<void>;
}

const BLANK_TEMPLATE: Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'New Template',
  senderName: '',
  subjectEn: '',
  subjectFr: '',
  bodyEn: '',
  bodyFr: '',
  closingEn: 'Best',
  closingFr: 'Cordialement',
  followUpEnabled: false,
  followUpDelayDays: 4,
  followUpSubjectEn: '',
  followUpSubjectFr: '',
  followUpBodyEn: 'Just following up on my message below — is this something {company} could explore?',
  followUpBodyFr: 'Je reviens vers vous suite à mon message ci-dessous — est-ce quelque chose que {company} pourrait explorer\u00a0?',
  followUp2Enabled: false,
  followUp2DelayDays: 4,
  followUp2SubjectEn: '',
  followUp2SubjectFr: '',
  followUp2BodyEn: 'Wanted to bump this one more time — happy to jump on a quick call if easier.',
  followUp2BodyFr: 'Je me permets de relancer une dernière fois — seriez-vous disponible pour un appel rapide\u00a0?',
};

export default function SettingsPanel({ user, senders, getConnectUrl, disconnectSender, updateSenderLimit }: Props) {
  const { templates, activeTemplate, activeTemplateId, addTemplate, updateTemplate, deleteTemplate, setActiveTemplate } = useTemplates();
  const [section, setSection] = useState<'senders' | 'templates' | 'prefs'>('senders');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<EmailTemplate>>({});
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [savingLimit, setSavingLimit] = useState<Record<string, boolean>>({});

  function startEdit(tpl: EmailTemplate) {
    setEditingId(tpl.id);
    setEditDraft({ ...tpl });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({});
  }

  function saveEdit() {
    if (!editingId) return;
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = editDraft as EmailTemplate;
    updateTemplate(editingId, rest);
    setEditingId(null);
    setEditDraft({});
  }

  function handleNewTemplate() {
    const created = addTemplate({ ...BLANK_TEMPLATE, senderName: user.name || user.email.split('@')[0] });
    startEdit(created);
  }

  async function handleSaveLimit(email: string) {
    const val = parseInt(limitDrafts[email]);
    if (isNaN(val) || val < 1 || val > 2000) return;
    setSavingLimit(p => ({ ...p, [email]: true }));
    await updateSenderLimit(email, val);
    setSavingLimit(p => ({ ...p, [email]: false }));
    setLimitDrafts(p => { const n = { ...p }; delete n[email]; return n; });
  }

  const navItem = (id: typeof section, label: string, icon: string) => (
    <button
      onClick={() => setSection(id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '10px 14px', border: 'none',
        background: section === id ? 'var(--accent)18' : 'none',
        color: section === id ? 'var(--accent)' : 'var(--text)',
        borderRadius: 8, cursor: 'pointer', fontSize: 13,
        fontWeight: section === id ? 700 : 500,
        fontFamily: "'DM Sans', sans-serif", textAlign: 'left' as const,
        borderLeft: `2px solid ${section === id ? 'var(--accent)' : 'transparent'}`,
      }}
    >
      <span>{icon}</span> {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', maxWidth: 900 }}>

      {/* Sidebar nav */}
      <div style={{
        width: 180, flexShrink: 0,
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 8,
        display: 'flex', flexDirection: 'column' as const, gap: 2,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.08em', padding: '8px 14px 4px' }}>
          Settings
        </div>
        {navItem('senders', 'Senders', '📧')}
        {navItem('templates', 'Templates', '📝')}
        {navItem('prefs', 'Preferences', '⚙️')}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* ── SENDERS section ─────────────────────────────────── */}
        {section === 'senders' && (
          <div style={S.card}>
            <h2 style={S.sectionTitle}>Gmail Senders</h2>
            <p style={S.sectionDesc}>Manage connected Gmail accounts and their daily send limits.</p>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10, marginTop: 16 }}>
              {senders.length === 0 && (
                <div style={S.empty}>No senders connected yet.</div>
              )}
              {senders.map(s => {
                const limitVal = limitDrafts[s.email] ?? String(s.dailyLimit);
                const isDirty = limitDrafts[s.email] !== undefined && limitDrafts[s.email] !== String(s.dailyLimit);
                return (
                  <div key={s.email} style={S.senderRow}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: s.connected ? '#34d39918' : '#94a3b818',
                        color: s.connected ? '#34d399' : '#94a3b8',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700, flexShrink: 0,
                      }}>
                        {s.name[0]?.toUpperCase() || s.email[0].toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{s.email}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {/* Daily limit editor */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Daily limit:</span>
                        <input
                          type="number"
                          min={1} max={2000}
                          value={limitVal}
                          onChange={e => setLimitDrafts(p => ({ ...p, [s.email]: e.target.value }))}
                          style={{
                            width: 60, background: 'var(--bg)', border: `1px solid ${isDirty ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: 6, color: 'var(--text)', fontSize: 12,
                            padding: '3px 6px', fontFamily: "'DM Sans', sans-serif",
                          }}
                        />
                        {isDirty && (
                          <button
                            onClick={() => handleSaveLimit(s.email)}
                            disabled={savingLimit[s.email]}
                            style={{ ...S.btnSmall, background: 'var(--accent)', color: 'white', border: 'none' }}
                          >
                            {savingLimit[s.email] ? '…' : 'Save'}
                          </button>
                        )}
                      </div>
                      {/* Stats */}
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {s.sentToday}/{s.dailyLimit} today
                      </div>
                      {/* Status + connect/disconnect */}
                      {s.connected ? (
                        <>
                          <span style={S.badgeGreen}>Connected</span>
                          {s.email === user.email && (
                            <button
                              style={{ ...S.btnSmall, color: '#f87171', borderColor: '#f8717144' }}
                              onClick={() => disconnectSender(s.email)}
                            >
                              Disconnect
                            </button>
                          )}
                        </>
                      ) : (
                        <a href={getConnectUrl(s.email)} style={S.btnConnect}>
                          Connect →
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Connect new sender */}
              <div style={{ marginTop: 4 }}>
                <a href={getConnectUrl(user.email)} style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                  + Connect your Gmail account
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ── TEMPLATES section ─────────────────────────────── */}
        {section === 'templates' && (
          <div style={S.card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h2 style={S.sectionTitle}>Email Templates</h2>
                <p style={S.sectionDesc}>Save and reuse email hooks + CTAs across campaigns.</p>
              </div>
              <button style={S.btnPrimary} onClick={handleNewTemplate}>+ New Template</button>
            </div>

            {templates.length === 0 && !editingId && (
              <div style={{ ...S.empty, padding: '40px 0' }}>
                No templates yet — click "New Template" to create one.
              </div>
            )}

            {/* Template list */}
            {!editingId && templates.map(tpl => (
              <div key={tpl.id} style={{
                ...S.senderRow,
                flexDirection: 'column' as const,
                alignItems: 'flex-start',
                gap: 8,
                border: `1px solid ${activeTemplateId === tpl.id ? 'var(--accent)' : 'var(--border)'}`,
                background: activeTemplateId === tpl.id ? 'var(--accent)08' : 'var(--bg)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{tpl.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Updated {new Date(tpl.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      style={{ ...S.btnSmall, color: activeTemplateId === tpl.id ? 'var(--accent)' : 'var(--text-secondary)', borderColor: activeTemplateId === tpl.id ? 'var(--accent)' : 'var(--border)' }}
                      onClick={() => setActiveTemplate(activeTemplateId === tpl.id ? null : tpl.id)}
                    >
                      {activeTemplateId === tpl.id ? '★ Active' : '☆ Set active'}
                    </button>
                    <button style={S.btnSmall} onClick={() => startEdit(tpl)}>Edit</button>
                    <button
                      style={{ ...S.btnSmall, color: '#f87171', borderColor: '#f8717144' }}
                      onClick={() => deleteTemplate(tpl.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {/* Preview body */}
                {tpl.bodyEn && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 8, width: '100%' }}>
                    <strong style={{ color: 'var(--text)' }}>EN body:</strong> {tpl.bodyEn.slice(0, 120)}{tpl.bodyEn.length > 120 ? '…' : ''}
                  </div>
                )}
              </div>
            ))}

            {/* Template editor */}
            {editingId && (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                    {editDraft.name || 'Template'}
                  </h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={S.btnSmall} onClick={cancelEdit}>Cancel</button>
                    <button style={{ ...S.btnSmall, background: 'var(--accent)', color: 'white', border: 'none' }} onClick={saveEdit}>Save</button>
                  </div>
                </div>

                {[
                  { key: 'name', label: 'Template name', multiline: false },
                  { key: 'senderName', label: 'Sender name (used in signature)', multiline: false },
                  { key: 'subjectEn', label: 'Subject — English (use {competitors}, {company}, {appWord})', multiline: false },
                  { key: 'subjectFr', label: 'Subject — French', multiline: false },
                  { key: 'bodyEn', label: 'Body — English', multiline: true },
                  { key: 'bodyFr', label: 'Body — French', multiline: true },
                  { key: 'closingEn', label: 'Closing — English', multiline: false },
                  { key: 'closingFr', label: 'Closing — French', multiline: false },
                ].map(({ key, label, multiline }) => (
                  <div key={key}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 5 }}>
                      {label}
                    </label>
                    {multiline ? (
                      <textarea
                        rows={4}
                        value={(editDraft as any)[key] || ''}
                        onChange={e => setEditDraft(p => ({ ...p, [key]: e.target.value }))}
                        style={S.textarea}
                      />
                    ) : (
                      <input
                        type="text"
                        value={(editDraft as any)[key] || ''}
                        onChange={e => setEditDraft(p => ({ ...p, [key]: e.target.value }))}
                        style={S.input}
                      />
                    )}
                  </div>
                ))}

                {/* ── Follow-up settings ── */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Follow-up 1</label>
                    <button onClick={() => setEditDraft(p => ({ ...p, followUpEnabled: !p.followUpEnabled }))} style={{
                      padding: '3px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                      border: `1px solid ${editDraft.followUpEnabled ? 'var(--accent)' : 'var(--border)'}`,
                      background: editDraft.followUpEnabled ? 'var(--accent)' : 'none',
                      color: editDraft.followUpEnabled ? 'white' : 'var(--text-secondary)',
                      cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                    }}>{editDraft.followUpEnabled ? 'Enabled' : 'Disabled'}</button>
                  </div>
                  {editDraft.followUpEnabled && (<>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Send after</span>
                      <input type="number" min={1} max={30} value={editDraft.followUpDelayDays ?? 4}
                        onChange={e => setEditDraft(p => ({ ...p, followUpDelayDays: Number(e.target.value) }))}
                        style={{ ...S.input, width: 56, textAlign: 'center' as const }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>days</span>
                    </div>
                    {[
                      { key: 'followUpSubjectEn', label: 'Subject (EN) — blank = reuse original' },
                      { key: 'followUpSubjectFr', label: 'Subject (FR)' },
                    ].map(({ key, label }) => (
                      <div key={key} style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{label}</label>
                        <input value={(editDraft as any)[key] || ''} onChange={e => setEditDraft(p => ({ ...p, [key]: e.target.value }))} style={S.input} />
                      </div>
                    ))}
                    {[
                      { key: 'followUpBodyEn', label: 'Message (EN)' },
                      { key: 'followUpBodyFr', label: 'Message (FR)' },
                    ].map(({ key, label }) => (
                      <div key={key} style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{label}</label>
                        <textarea rows={2} value={(editDraft as any)[key] || ''} onChange={e => setEditDraft(p => ({ ...p, [key]: e.target.value }))} style={S.textarea} />
                      </div>
                    ))}

                    {/* Follow-up 2 */}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Follow-up 2</label>
                        <button onClick={() => setEditDraft(p => ({ ...p, followUp2Enabled: !p.followUp2Enabled }))} style={{
                          padding: '3px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                          border: `1px solid ${editDraft.followUp2Enabled ? 'var(--accent)' : 'var(--border)'}`,
                          background: editDraft.followUp2Enabled ? 'var(--accent)' : 'none',
                          color: editDraft.followUp2Enabled ? 'white' : 'var(--text-secondary)',
                          cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                        }}>{editDraft.followUp2Enabled ? 'Enabled' : 'Disabled'}</button>
                      </div>
                      {editDraft.followUp2Enabled && (<>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Send after</span>
                          <input type="number" min={1} max={30} value={editDraft.followUp2DelayDays ?? 4}
                            onChange={e => setEditDraft(p => ({ ...p, followUp2DelayDays: Number(e.target.value) }))}
                            style={{ ...S.input, width: 56, textAlign: 'center' as const }} />
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>days after Follow-up 1</span>
                        </div>
                        {[
                          { key: 'followUp2SubjectEn', label: 'Subject (EN) — blank = reuse original' },
                          { key: 'followUp2SubjectFr', label: 'Subject (FR)' },
                        ].map(({ key, label }) => (
                          <div key={key} style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{label}</label>
                            <input value={(editDraft as any)[key] || ''} onChange={e => setEditDraft(p => ({ ...p, [key]: e.target.value }))} style={S.input} />
                          </div>
                        ))}
                        {[
                          { key: 'followUp2BodyEn', label: 'Message (EN)' },
                          { key: 'followUp2BodyFr', label: 'Message (FR)' },
                        ].map(({ key, label }) => (
                          <div key={key} style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{label}</label>
                            <textarea rows={2} value={(editDraft as any)[key] || ''} onChange={e => setEditDraft(p => ({ ...p, [key]: e.target.value }))} style={S.textarea} />
                          </div>
                        ))}
                      </>)}
                    </div>
                  </>)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PREFERENCES section ───────────────────────────── */}
        {section === 'prefs' && (
          <div style={S.card}>
            <h2 style={S.sectionTitle}>Preferences</h2>
            <p style={S.sectionDesc}>Default settings applied when launching new campaigns.</p>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column' as const, gap: 16 }}>
              <PrefRow
                label="Default send speed"
                desc="Applied when you open the campaign wizard"
              >
                {(['slow', 'normal', 'fast'] as const).map(mode => {
                  const stored = localStorage.getItem('alpic_default_speed') || 'normal';
                  return (
                    <button
                      key={mode}
                      onClick={() => localStorage.setItem('alpic_default_speed', mode)}
                      style={{
                        padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                        border: `1px solid ${stored === mode ? 'var(--accent)' : 'var(--border)'}`,
                        background: stored === mode ? 'var(--accent)18' : 'var(--bg)',
                        color: stored === mode ? 'var(--accent)' : 'var(--text-secondary)',
                        cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  );
                })}
              </PrefRow>
              <PrefRow
                label="Active template"
                desc="The template that loads by default in the campaign wizard"
              >
                <span style={{ fontSize: 12, color: activeTemplate ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  {activeTemplate ? activeTemplate.name : 'None selected — go to Templates tab'}
                </span>
              </PrefRow>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PrefRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 24,
  },
  sectionTitle: {
    fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px',
  },
  sectionDesc: {
    fontSize: 12, color: 'var(--text-secondary)', margin: 0,
  },
  senderRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 14px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
  },
  empty: {
    fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' as const,
  },
  badgeGreen: {
    background: '#34d39918', color: '#34d399',
    borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600,
  },
  btnSmall: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-secondary)',
    fontSize: 11, fontWeight: 600,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  btnPrimary: {
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 8,
    color: 'white',
    fontSize: 13, fontWeight: 700,
    padding: '8px 18px',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    flexShrink: 0,
  },
  btnConnect: {
    background: 'var(--accent)',
    color: 'white',
    borderRadius: 6,
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 600,
    textDecoration: 'none',
  },
  textarea: {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    fontSize: 12,
    padding: '8px 10px',
    fontFamily: "'DM Sans', sans-serif",
    lineHeight: 1.5,
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  },
  input: {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    fontSize: 12,
    padding: '7px 10px',
    fontFamily: "'DM Sans', sans-serif",
    boxSizing: 'border-box' as const,
  },
};
