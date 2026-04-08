import { useState, useEffect } from 'react';
import type { PreviewContact } from '../hooks/useApi';

interface EmailOverride {
  subject: string;
  body: string;
}

interface Props {
  sheetId?: string;
  sheetTab?: string;
  onConfirm: (excludeIds: string[], emailOverrides: Record<string, EmailOverride>) => void;
  onClose: () => void;
  fetchPreview: (sheetId?: string, tab?: string, limit?: number) => Promise<PreviewContact[]>;
}

export default function SendPreviewModal({ sheetId, sheetTab, onConfirm, onClose, fetchPreview }: Props) {
  const [contacts, setContacts] = useState<PreviewContact[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, EmailOverride>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchPreview(sheetId, sheetTab, 20)
      .then(data => {
        setContacts(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [sheetId, sheetTab]);

  function toggleExclude(id: string) {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getEmail(c: PreviewContact): EmailOverride {
    return overrides[c.id] ?? { subject: c.subject, body: c.body };
  }

  function updateOverride(id: string, field: 'subject' | 'body', value: string) {
    setOverrides(prev => ({
      ...prev,
      [id]: { ...getEmail(contacts.find(c => c.id === id)!), ...prev[id], [field]: value },
    }));
  }

  function resetOverride(id: string) {
    setOverrides(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const toSend = contacts.filter(c => !excluded.has(c.id));
  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Review Emails Before Sending</h2>
            <p style={styles.subtitle}>
              {loading
                ? 'Loading contacts…'
                : `${toSend.length} of ${contacts.length} contacts selected · click a row to preview the email · pencil to edit`}
            </p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {loading && (
            <div style={styles.center}>
              <div style={styles.spinner} />
              <p style={{ color: 'var(--text-secondary)', marginTop: 12 }}>Fetching pending contacts…</p>
            </div>
          )}

          {error && (
            <div style={styles.center}>
              <p style={{ color: '#f87171' }}>⚠ {error}</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 8 }}>
                Make sure the API server is running and the sheet credentials are set.
              </p>
            </div>
          )}

          {!loading && !error && contacts.length === 0 && (
            <div style={styles.center}>
              <p style={{ color: 'var(--text-secondary)' }}>No pending contacts in this sheet.</p>
            </div>
          )}

          {!loading && !error && contacts.length > 0 && (
            <div>
              {contacts.map((c) => {
                const skip = excluded.has(c.id);
                const email = getEmail(c);
                const isExpanded = expandedId === c.id;
                const isEditing = editingId === c.id;
                const isModified = !!overrides[c.id];

                return (
                  <div
                    key={c.id}
                    style={{
                      ...styles.contactRow,
                      opacity: skip ? 0.35 : 1,
                      borderLeft: isModified ? '3px solid var(--accent)' : '3px solid transparent',
                    }}
                  >
                    {/* Summary row */}
                    <div
                      style={styles.contactSummary}
                      onClick={() => !skip && setExpandedId(isExpanded ? null : c.id)}
                    >
                      <input
                        type="checkbox"
                        checked={!skip}
                        onChange={() => toggleExclude(c.id)}
                        onClick={e => e.stopPropagation()}
                        style={{ accentColor: 'var(--accent)', width: 16, height: 16, flexShrink: 0 }}
                      />
                      <div style={styles.contactMain}>
                        <span style={styles.contactName}>
                          {c.firstName} {c.lastName}
                        </span>
                        <span style={styles.contactMeta}>{c.email}</span>
                      </div>
                      <div style={styles.contactCompany}>
                        <span style={{ fontWeight: 500 }}>{c.company}</span>
                        <span style={styles.industryTag}>{c.industry}</span>
                      </div>
                      <div style={styles.subjectPreview}>
                        {isModified && <span style={styles.modifiedDot} title="Edited">✏</span>}
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {email.subject}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        {!skip && (
                          <button
                            style={styles.editBtn}
                            onClick={e => {
                              e.stopPropagation();
                              setExpandedId(c.id);
                              setEditingId(isEditing ? null : c.id);
                            }}
                            title="Edit email"
                          >
                            ✏
                          </button>
                        )}
                        {!skip && (
                          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expanded email preview / editor */}
                    {isExpanded && !skip && (
                      <div style={styles.emailPreview}>
                        {isEditing ? (
                          <div style={styles.editor}>
                            <div style={styles.editorField}>
                              <label style={styles.editorLabel}>Subject</label>
                              <input
                                style={styles.editorInput}
                                value={email.subject}
                                onChange={e => updateOverride(c.id, 'subject', e.target.value)}
                                onClick={e => e.stopPropagation()}
                              />
                            </div>
                            <div style={styles.editorField}>
                              <label style={styles.editorLabel}>Body (HTML)</label>
                              <textarea
                                style={styles.editorTextarea}
                                value={email.body}
                                onChange={e => updateOverride(c.id, 'body', e.target.value)}
                                onClick={e => e.stopPropagation()}
                                rows={12}
                              />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                style={styles.doneBtn}
                                onClick={e => { e.stopPropagation(); setEditingId(null); }}
                              >
                                Done editing
                              </button>
                              {isModified && (
                                <button
                                  style={styles.resetBtn}
                                  onClick={e => { e.stopPropagation(); resetOverride(c.id); }}
                                >
                                  Reset to template
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div style={styles.emailView}>
                            <div style={styles.emailSubjectLine}>
                              <span style={styles.emailLabel}>Subject:</span>
                              <span style={{ fontWeight: 600 }}>{email.subject}</span>
                            </div>
                            <div
                              style={styles.emailBody}
                              dangerouslySetInnerHTML={{ __html: email.body }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && contacts.length > 0 && (
          <div style={styles.footer}>
            <div style={styles.footerInfo}>
              <span style={styles.sendCount}>{toSend.length}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                {toSend.length === 1 ? 'email' : 'emails'} will be sent
                {excluded.size > 0 && ` · ${excluded.size} skipped`}
                {hasOverrides && ` · ${Object.keys(overrides).length} edited`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button
                style={{
                  ...styles.confirmBtn,
                  opacity: toSend.length === 0 ? 0.4 : 1,
                  cursor: toSend.length === 0 ? 'not-allowed' : 'pointer',
                }}
                onClick={() => {
                  if (toSend.length > 0) onConfirm([...excluded], overrides);
                }}
                disabled={toSend.length === 0}
              >
                🚀 Send {toSend.length} Email{toSend.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  },
  modal: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    width: '100%',
    maxWidth: 860,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '24px 28px 16px',
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text)',
    margin: 0,
  },
  subtitle: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    margin: '4px 0 0',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 18,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1,
  },
  body: {
    flex: 1,
    overflowY: 'auto',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid var(--border)',
    borderTop: '3px solid var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  contactRow: {
    borderBottom: '1px solid var(--border)',
    transition: 'opacity 0.15s',
  },
  contactSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 20px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  contactMain: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    minWidth: 140,
  },
  contactName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text)',
  },
  contactMeta: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  contactCompany: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 130,
    fontSize: 12,
    color: 'var(--text)',
  },
  industryTag: {
    background: 'var(--accent)22',
    color: 'var(--accent)',
    borderRadius: 4,
    padding: '1px 6px',
    fontSize: 10,
    fontWeight: 600,
    display: 'inline-block',
    width: 'fit-content',
  },
  subjectPreview: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
    minWidth: 0,
  },
  modifiedDot: {
    fontSize: 11,
    color: 'var(--accent)',
    flexShrink: 0,
  },
  editBtn: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 12,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  emailPreview: {
    padding: '0 20px 16px 52px',
  },
  emailView: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 16,
  },
  emailSubjectLine: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottom: '1px solid var(--border)',
    fontSize: 13,
  },
  emailLabel: {
    color: 'var(--text-secondary)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    alignSelf: 'center',
    flexShrink: 0,
  },
  emailBody: {
    fontSize: 13,
    color: 'var(--text)',
    lineHeight: 1.6,
  },
  editor: {
    background: 'var(--bg)',
    border: '1px solid var(--accent)55',
    borderRadius: 8,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  editorField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  editorLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  editorInput: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    color: 'var(--text)',
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
  },
  editorTextarea: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 12,
    color: 'var(--text)',
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical',
  },
  doneBtn: {
    background: 'var(--accent)',
    color: 'white',
    border: 'none',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  resetBtn: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 28px',
    borderTop: '1px solid var(--border)',
    gap: 12,
  },
  footerInfo: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  sendCount: {
    fontSize: 28,
    fontWeight: 700,
    color: 'var(--accent)',
    lineHeight: 1,
  },
  cancelBtn: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  confirmBtn: {
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 8,
    color: 'white',
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'opacity 0.15s',
  },
};
