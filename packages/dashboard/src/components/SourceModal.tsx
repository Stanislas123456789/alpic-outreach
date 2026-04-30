import { useState } from 'react';
import { SheetSource } from '../hooks/useConfig';

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

interface Props {
  sources: SheetSource[];
  activeId: string;
  onAdd: (s: Omit<SheetSource, 'id'>) => SheetSource | Promise<SheetSource>;
  onUpdate: (id: string, patch: Partial<Omit<SheetSource, 'id'>>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const EMPTY_FORM = { name: '', sheetId: '', sheetTab: 'Sheet1' };

function extractSheetId(input: string): string {
  // Accept full Google Sheets URL and extract just the ID
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return input.trim();
}

export default function SourceModal({ sources, activeId, onAdd, onUpdate, onDelete, onClose }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sheetIdParsed, setSheetIdParsed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function startEdit(s: SheetSource) {
    setEditingId(s.id);
    setForm({ name: s.name, sheetId: s.sheetId, sheetTab: s.sheetTab });
    setError('');
    setSheetIdParsed(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError('');
    setSheetIdParsed(false);
  }

  function handleSheetIdChange(raw: string) {
    const extracted = extractSheetId(raw);
    const wasParsed = extracted !== raw.trim() && raw.includes('spreadsheets/d/');
    setSheetIdParsed(wasParsed);
    setForm(f => ({ ...f, sheetId: extracted }));
  }

  function validate() {
    if (!form.name.trim()) return 'Name is required';
    if (!form.sheetId.trim()) return 'Sheet ID is required';
    if (!form.sheetTab.trim()) return 'Sheet tab name is required';
    return '';
  }

  async function testConnection() {
    const err = validate();
    if (err) { setError(err); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const safeTab = /[\s']/.test(form.sheetTab) ? `'${form.sheetTab}'` : form.sheetTab;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${form.sheetId.trim()}/values/${encodeURIComponent(safeTab + '!A1:B2')}?key=${API_KEY}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const rows = data.values?.length || 0;
        setTestResult({ ok: true, message: `Connected! Found ${rows} row(s) in header.` });
      } else if (res.status === 403) {
        setTestResult({ ok: false, message: 'Access denied. Make sure the sheet is shared as "Anyone with the link" (Viewer).' });
      } else if (res.status === 400) {
        setTestResult({ ok: false, message: `Tab "${form.sheetTab}" not found. Check the tab name at the bottom of your spreadsheet.` });
      } else {
        setTestResult({ ok: false, message: `Error ${res.status}. Check the Sheet ID and try again.` });
      }
    } catch {
      setTestResult({ ok: false, message: 'Network error. Check your connection.' });
    }
    setTesting(false);
  }

  function handleSave() {
    const err = validate();
    if (err) { setError(err); return; }
    if (editingId) {
      onUpdate(editingId, { name: form.name.trim(), sheetId: form.sheetId.trim(), sheetTab: form.sheetTab.trim() });
    } else {
      onAdd({ name: form.name.trim(), sheetId: form.sheetId.trim(), sheetTab: form.sheetTab.trim() });
    }
    cancelEdit();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Manage Campaign Sheets</h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
              Each sheet is a separate outreach campaign. You can switch between them in the header.
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Source list */}
          <div className="source-list">
            {sources.map(s => (
              <div key={s.id} className={`source-item ${s.id === activeId ? 'source-active' : ''}`}>
                <div className="source-info">
                  <span className="source-name">{s.name}</span>
                  <span className="source-meta">{s.sheetId.slice(0, 20)}{s.sheetId.length > 20 ? '…' : ''} · {s.sheetTab}</span>
                </div>
                <div className="source-actions">
                  {s.id === activeId && <span className="source-badge">Active</span>}
                  <button className="src-btn" onClick={() => startEdit(s)}>Edit</button>
                  <button
                    className="src-btn src-btn-danger"
                    onClick={() => onDelete(s.id)}
                    disabled={sources.length === 1}
                    title={sources.length === 1 ? 'Cannot delete the last source' : ''}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add / Edit form */}
          <div className="source-form">
            <h3>{editingId ? 'Edit Campaign Sheet' : 'Add New Campaign Sheet'}</h3>

            {/* Requirements checklist */}
            {!editingId && (
              <div style={{
                background: 'var(--accent-dim)', border: '1px solid var(--accent)33',
                borderRadius: 10, padding: '14px 18px', marginBottom: 16,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>Before you start</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                  {[
                    'Must be a native Google Sheet (File > Save as Google Sheets if imported from Excel)',
                    'Share the sheet: "Anyone with the link" > Viewer',
                    'Tab must follow the standard column layout (Industry, Company, Contact Name, etc.)',
                  ].map((text, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="form-error">{error}</div>}
            <div className="form-row">
              <label>Campaign Name</label>
              <input
                placeholder="e.g. Week 3 (05/05)"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="form-row">
              <label>Google Sheet URL or ID</label>
              <input
                placeholder="Paste the full Google Sheets URL or just the ID"
                value={form.sheetId}
                onChange={e => { handleSheetIdChange(e.target.value); setTestResult(null); }}
                className="mono"
              />
              {sheetIdParsed && (
                <span className="form-hint" style={{ color: 'var(--green)' }}>
                  Sheet ID extracted from URL
                </span>
              )}
              {!sheetIdParsed && (
                <span className="form-hint">
                  Paste the full Google Sheets URL or just the ID from:<br />
                  docs.google.com/spreadsheets/d/<strong>THIS_PART</strong>/edit
                </span>
              )}
            </div>
            <div className="form-row">
              <label>Tab Name</label>
              <input
                placeholder="Master Table"
                value={form.sheetTab}
                onChange={e => { setForm(f => ({ ...f, sheetTab: e.target.value })); setTestResult(null); }}
                className="mono"
              />
              <span className="form-hint">The name of the tab at the bottom of your spreadsheet</span>
            </div>

            {/* Test connection result */}
            {testResult && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                background: testResult.ok ? 'var(--green-dim)' : 'var(--red-dim)',
                border: `1px solid ${testResult.ok ? 'var(--green)' : 'var(--red)'}33`,
                color: testResult.ok ? 'var(--green)' : 'var(--red)',
                marginBottom: 8,
              }}>
                {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
              </div>
            )}

            <div className="form-btns">
              {editingId && <button className="btn-secondary" onClick={cancelEdit}>Cancel</button>}
              <button
                className="btn-secondary"
                onClick={testConnection}
                disabled={testing || !form.sheetId.trim()}
                style={{ opacity: testing ? 0.6 : 1 }}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button className="btn-primary" onClick={handleSave}>
                {editingId ? 'Save Changes' : '+ Add Campaign Sheet'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
