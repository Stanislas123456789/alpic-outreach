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
          // Server has sources — use them as the shared truth
          setSourcesState(data);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          const currentActive = localStorage.getItem(ACTIVE_KEY);
          if (!currentActive || !data.find(s => s.id === currentActive)) {
            // Default to the most recently added source
            const latest = data[data.length - 1];
            localStorage.setItem(ACTIVE_KEY, latest.id);
            setActiveIdState(latest.id);
          }
        } else {
          // Server is empty — seed it with this user's localStorage sources
          const local = loadLocalSources();
          const validLocal = local.filter(s => s.sheetId); // skip empty defaults
          if (validLocal.length > 0) {
            for (const s of validLocal) {
              try {
                await fetch(`${API_URL}/api/sources`, {
                  method: 'POST',
                  headers: getAuthHeaders(),
                  body: JSON.stringify({ name: s.name, sheetId: s.sheetId, sheetTab: s.sheetTab }),
                });
              } catch {}
            }
            // Re-fetch to get server-generated IDs
            try {
              const res2 = await fetch(`${API_URL}/api/sources`, { headers: getAuthHeaders() });
              if (res2.ok) {
                const seeded: SheetSource[] = await res2.json();
                if (!cancelled && seeded.length > 0) {
                  setSourcesState(seeded);
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
                  const latest = seeded[seeded.length - 1];
                  localStorage.setItem(ACTIVE_KEY, latest.id);
                  setActiveIdState(latest.id);
                }
              }
            } catch {}
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

  return { sources, activeSource, activeId, setActiveId, addSource, updateSource, deleteSource, synced };
}
