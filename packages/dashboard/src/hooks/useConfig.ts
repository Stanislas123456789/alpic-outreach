import { useState, useCallback } from 'react';

const STORAGE_KEY = 'alpic_sources';
const ACTIVE_KEY = 'alpic_active_source';

export interface SheetSource {
  id: string;
  name: string;
  sheetId: string;
  sheetTab: string;
}

function defaultSource(): SheetSource {
  return {
    id: 'default',
    name: 'Default',
    sheetId: import.meta.env.VITE_SHEET_ID || '',
    sheetTab: import.meta.env.VITE_SHEET_TAB || 'Sheet1',
  };
}

function loadSources(): SheetSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [defaultSource()];
}

function loadActiveId(sources: SheetSource[]): string {
  const saved = localStorage.getItem(ACTIVE_KEY);
  if (saved && sources.find(s => s.id === saved)) return saved;
  return sources[0].id;
}

export function useConfig() {
  const [sources, setSourcesState] = useState<SheetSource[]>(loadSources);
  const [activeId, setActiveIdState] = useState<string>(() => {
    const s = loadSources();
    return loadActiveId(s);
  });

  const activeSource = sources.find(s => s.id === activeId) ?? sources[0];

  const saveSources = useCallback((next: SheetSource[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSourcesState(next);
  }, []);

  const setActiveId = useCallback((id: string) => {
    localStorage.setItem(ACTIVE_KEY, id);
    setActiveIdState(id);
  }, []);

  const addSource = useCallback((source: Omit<SheetSource, 'id'>) => {
    const newSource: SheetSource = { ...source, id: crypto.randomUUID() };
    const next = [...sources, newSource];
    saveSources(next);
    return newSource;
  }, [sources, saveSources]);

  const updateSource = useCallback((id: string, patch: Partial<Omit<SheetSource, 'id'>>) => {
    const next = sources.map(s => s.id === id ? { ...s, ...patch } : s);
    saveSources(next);
  }, [sources, saveSources]);

  const deleteSource = useCallback((id: string) => {
    const next = sources.filter(s => s.id !== id);
    if (next.length === 0) next.push(defaultSource());
    saveSources(next);
    if (activeId === id) {
      const newActive = next[0].id;
      localStorage.setItem(ACTIVE_KEY, newActive);
      setActiveIdState(newActive);
    }
  }, [sources, saveSources, activeId]);

  return { sources, activeSource, activeId, setActiveId, addSource, updateSource, deleteSource };
}
