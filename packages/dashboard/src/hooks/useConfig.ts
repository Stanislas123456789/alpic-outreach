import { useState, useCallback, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4001';
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

// Fallback: load from localStorage if API is unavailable
function loadLocalSources(): SheetSource[] {
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
  return sources[0]?.id || 'default';
}

function getAuthHeaders(): Record<string, string> {
  try {
    const stored = localStorage.getItem('alpic_auth_v1');
    if (stored) {
      const user = JSON.parse(stored);
      if (user?.email) return { 'Content-Type': 'application/json', 'X-Auth-Email': user.email };
    }
  } catch {}
  return { 'Content-Type': 'application/json' };
}

export function useConfig() {
  const [sources, setSourcesState] = useState<SheetSource[]>(loadLocalSources);
  const [activeId, setActiveIdState] = useState<string>(() => loadActiveId(loadLocalSources()));
  const [synced, setSynced] = useState(false);

  const activeSource = sources.find(s => s.id === activeId) ?? sources[0] ?? defaultSource();

  // On mount: fetch shared sources from API
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/sources`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SheetSource[] = await res.json();
        if (cancelled) return;
        if (data.length > 0) {
          setSourcesState(data);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          // If current activeId doesn't exist in server sources, pick first
          const currentActive = localStorage.getItem(ACTIVE_KEY);
          if (!currentActive || !data.find(s => s.id === currentActive)) {
            localStorage.setItem(ACTIVE_KEY, data[0].id);
            setActiveIdState(data[0].id);
          }
        }
        setSynced(true);
      } catch {
        // API unavailable — keep using localStorage sources
        setSynced(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setActiveId = useCallback((id: string) => {
    localStorage.setItem(ACTIVE_KEY, id);
    setActiveIdState(id);
  }, []);

  const addSource = useCallback(async (source: Omit<SheetSource, 'id'>) => {
    try {
      const res = await fetch(`${API_URL}/api/sources`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(source),
      });
      if (res.ok) {
        const created: SheetSource = await res.json();
        setSourcesState(prev => {
          const next = [...prev, created];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        return created;
      }
    } catch {}
    // Fallback: create locally
    const newSource: SheetSource = { ...source, id: crypto.randomUUID() };
    setSourcesState(prev => {
      const next = [...prev, newSource];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    return newSource;
  }, []);

  const updateSource = useCallback(async (id: string, patch: Partial<Omit<SheetSource, 'id'>>) => {
    setSourcesState(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...patch } : s);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      // Fire API call in background
      const updated = next.find(s => s.id === id);
      if (updated) {
        fetch(`${API_URL}/api/sources/${id}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(updated),
        }).catch(() => {});
      }
      return next;
    });
  }, []);

  const deleteSource = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/api/sources/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error) console.warn('[sources]', data.error);
      }
    } catch {}
    setSourcesState(prev => {
      let next = prev.filter(s => s.id !== id);
      if (next.length === 0) next = [defaultSource()];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (activeId === id) {
        const newActive = next[0].id;
        localStorage.setItem(ACTIVE_KEY, newActive);
        setActiveIdState(newActive);
      }
      return next;
    });
  }, [activeId]);

  return { sources, activeSource, activeId, setActiveId, addSource, updateSource, deleteSource };
}
