import { useState } from 'react';

// ── Email template library (persisted in localStorage) ───────────────────────

const STORAGE_KEY = 'alpic_email_templates';
const ACTIVE_KEY  = 'alpic_active_template_id';

export interface EmailTemplate {
  id: string;
  name: string;
  senderName: string;
  subjectEn: string;
  subjectFr: string;
  bodyEn: string;
  bodyFr: string;
  closingEn: string;
  closingFr: string;
  createdAt: string;
  updatedAt: string;
}

function migrate(raw: any): EmailTemplate {
  // Merge old hookEn+ctaEn → bodyEn if template still has the old shape
  if (raw.hookEn !== undefined || raw.ctaEn !== undefined) {
    const bodyEn = [raw.hookEn, raw.ctaEn].filter(Boolean).join('\n\n');
    const bodyFr = [raw.hookFr, raw.ctaFr].filter(Boolean).join('\n\n');
    const { hookEn: _1, hookFr: _2, ctaEn: _3, ctaFr: _4, ...rest } = raw;
    return { ...rest, bodyEn: bodyEn || rest.bodyEn || '', bodyFr: bodyFr || rest.bodyFr || '' };
  }
  return raw;
}

function load(): EmailTemplate[] {
  try { return (JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as any[]).map(migrate); } catch { return []; }
}

export function useTemplates() {
  const [templates, setTemplatesState] = useState<EmailTemplate[]>(load);
  const [activeTemplateId, setActiveTemplateIdState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_KEY)
  );

  function persist(list: EmailTemplate[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    setTemplatesState(list);
  }

  function addTemplate(tpl: Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>): EmailTemplate {
    const now = new Date().toISOString();
    const newTpl: EmailTemplate = { ...tpl, id: Date.now().toString(36), createdAt: now, updatedAt: now };
    persist([...templates, newTpl]);
    return newTpl;
  }

  function updateTemplate(id: string, changes: Partial<Omit<EmailTemplate, 'id' | 'createdAt'>>) {
    persist(templates.map(t => t.id === id ? { ...t, ...changes, updatedAt: new Date().toISOString() } : t));
  }

  function deleteTemplate(id: string) {
    persist(templates.filter(t => t.id !== id));
    if (activeTemplateId === id) setActiveTemplate(null);
  }

  function setActiveTemplate(id: string | null) {
    setActiveTemplateIdState(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  }

  const activeTemplate = templates.find(t => t.id === activeTemplateId) ?? null;

  return { templates, activeTemplate, activeTemplateId, addTemplate, updateTemplate, deleteTemplate, setActiveTemplate };
}
