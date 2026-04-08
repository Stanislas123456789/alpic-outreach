import { useState } from 'react';
import { SheetSource } from '../hooks/useConfig';

interface Props {
  sources: SheetSource[];
  activeId: string;
  onAdd: (s: Omit<SheetSource, 'id'>) => SheetSource;
  onUpdate: (id: string, patch: Partial<Omit<SheetSource, 'id'>>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const EMPTY_FORM = { name: '', sheetId: '', sheetTab: 'Sheet1' };

export default function SourceModal({ sources, activeId, onAdd, onUpdate, onDelete, onClose }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  function startEdit(s: SheetSource) {
    setEditingId(s.id);
    setForm({ name: s.name, sheetId: s.sheetId, sheetTab: s.sheetTab });
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError('');
  }

  function validate() {
    if (!form.name.trim()) return 'Name is required';
    if (!form.sheetId.trim()) return 'Sheet ID is required';
    if (!form.sheetTab.trim()) return 'Sheet tab name is required';
    return '';
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
          <h2>Manage Data Sources</h2>
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
            <h3>{editingId ? 'Edit Source' : 'Add New Source'}</h3>
            {error && <div className="form-error">{error}</div>}
            <div className="form-row">
              <label>Name</label>
              <input
                placeholder="e.g. Travel Campaign Q2"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="form-row">
              <label>Sheet ID</label>
              <input
                placeholder="Paste from Google Sheets URL"
                value={form.sheetId}
                onChange={e => setForm(f => ({ ...f, sheetId: e.target.value }))}
                className="mono"
              />
              <span className="form-hint">docs.google.com/spreadsheets/d/<strong>THIS_PART</strong>/edit</span>
            </div>
            <div className="form-row">
              <label>Tab Name</label>
              <input
                placeholder="Sheet1"
                value={form.sheetTab}
                onChange={e => setForm(f => ({ ...f, sheetTab: e.target.value }))}
                className="mono"
              />
            </div>
            <div className="form-btns">
              {editingId && <button className="btn-secondary" onClick={cancelEdit}>Cancel</button>}
              <button className="btn-primary" onClick={handleSave}>
                {editingId ? 'Save Changes' : 'Add Source'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
