import { useState, useCallback, useEffect } from 'react';
import type { AuthUser } from './useAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4001';

export interface SenderStatus {
  email: string;
  name: string;
  dailyLimit: number;
  sentToday: number;
  remaining: number;
  connected: boolean;
}

export interface PreviewContact {
  id: string;
  rowIndex: number;
  firstName: string;
  lastName?: string;
  email: string;
  company: string;
  industry: string;
  country: string;
  role: string;
  language: string;
  competitors: string;
  subject: string;
  body: string;
}

export interface ProgressEvent {
  type: 'start' | 'sending' | 'sent' | 'failed' | 'invalid' | 'skipped' | 'done';
  contactId?: string;
  email?: string;
  firstName?: string;
  company?: string;
  via?: string;
  error?: string;
  total?: number;
  index?: number;
  timestamp: string;
}

export interface PipelineProgress {
  running: boolean;
  total: number;
  log: ProgressEvent[];
}

export interface PipelineStatus {
  running: boolean;
  lastRunAt: string | null;
  lastRunResult: 'success' | 'error' | null;
  lastRunError: string | null;
  senders: { email: string; name: string; sentToday: number; dailyLimit: number; remaining: number }[];
}

export function useApi(user: AuthUser | null) {
  const [senders, setSenders] = useState<SenderStatus[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(user?.email ? { 'X-Auth-Email': user.email } : {}),
  };

  const fetchSenders = useCallback(async () => {
    if (!user?.email?.endsWith('@alpic.ai')) return;
    try {
      const res = await fetch(`${API_URL}/api/senders`, { headers: authHeaders });
      if (res.ok) setSenders(await res.json());
    } catch {
      // API not running locally — silent failure
    }
  }, [user?.email]);

  const fetchPipelineStatus = useCallback(async () => {
    if (!user?.email?.endsWith('@alpic.ai')) return;
    try {
      const res = await fetch(`${API_URL}/api/pipeline/status`, { headers: authHeaders });
      if (res.ok) setPipelineStatus(await res.json());
    } catch {
      // silent
    }
  }, [user?.email]);

  const previewContacts = useCallback(async (sheetId?: string, tab?: string, limit = 10) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (sheetId) params.set('sheetId', sheetId);
    if (tab) params.set('tab', tab);
    const res = await fetch(`${API_URL}/api/pipeline/preview?${params}`, { headers: authHeaders });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to fetch preview');
    }
    return res.json() as Promise<PreviewContact[]>;
  }, [user?.email]);

  const runPipeline = useCallback(async (opts?: {
    excludeIds?: string[];
    sheetId?: string;
    tab?: string;
    emailOverrides?: Record<string, { subject: string; body: string }>;
  }) => {
    setLoading(true);
    setRunMessage(null);
    setApiError(null);
    try {
      const res = await fetch(`${API_URL}/api/pipeline/run`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(opts || {}),
      });
      const data = await res.json();
      if (res.ok) {
        setRunMessage(data.message || 'Batch started!');
        setTimeout(fetchPipelineStatus, 2000);
      } else {
        setApiError(data.error || 'Failed to start pipeline');
      }
    } catch (err: any) {
      setApiError('API unreachable. Is the API server running?');
    } finally {
      setLoading(false);
    }
  }, [user?.email, fetchPipelineStatus]);

  const pollProgress = useCallback(async (): Promise<PipelineProgress> => {
    const res = await fetch(`${API_URL}/api/pipeline/progress`, { headers: authHeaders });
    if (!res.ok) throw new Error('Failed to fetch progress');
    return res.json();
  }, [user?.email]);

  const getConnectUrl = useCallback((email: string) => {
    return `${API_URL}/api/senders/auth?email=${encodeURIComponent(email)}`;
  }, []);

  // Load on mount and when user changes
  useEffect(() => {
    if (user?.email?.endsWith('@alpic.ai')) {
      fetchSenders();
      fetchPipelineStatus();
    }
  }, [user?.email]);

  return {
    senders,
    pipelineStatus,
    loading,
    runMessage,
    apiError,
    runPipeline,
    previewContacts,
    pollProgress,
    getConnectUrl,
    refresh: () => { fetchSenders(); fetchPipelineStatus(); },
  };
}
