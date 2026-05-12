import { useState, useEffect, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4001';

export interface GlobalStats {
  totalUniqueContacts: number;
  totalContacted: number;
  totalPending: number;
  totalOpened: number;
  totalReplied: number;
  totalBounced: number;
  totalUnsubscribed: number;
  byIndustry: Record<string, { contacted: number; total: number }>;
  byStatus?: Record<string, number>;
  byIndustryDetailed?: Record<string, { contacted: number; total: number; opened: number; replied: number; bounced: number }>;
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

export function useGlobalStats(enabled: boolean, refreshInterval = 30000) {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/pipeline/global-stats`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GlobalStats = await res.json();
      setStats(data);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch global stats');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setStats(null);
      return;
    }
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval, enabled]);

  return { stats, loading, error, lastUpdated, refresh };
}
