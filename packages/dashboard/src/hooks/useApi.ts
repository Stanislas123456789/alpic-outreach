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
  competitorsLive?: string;
  profileGroup?: string;
  weekAdded?: string;
  subject: string;
  body: string;
  alreadySent?: boolean;
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
  campaignId?: string;
  sent?: number;
  status?: string;
}

export interface PipelineStatus {
  running: boolean;
  lastRunAt: string | null;
  lastRunResult: 'success' | 'error' | null;
  lastRunError: string | null;
  senders: { email: string; name: string; sentToday: number; dailyLimit: number; remaining: number }[];
}

export interface Campaign {
  id: string;
  name?: string;
  sheetId: string;
  sheetTab: string;
  startedAt: string | null;
  scheduledAt: string | null;
  status: 'scheduled' | 'running' | 'done' | 'error' | 'cancelled';
  sent: number;
  total: number;
  log: ProgressEvent[];
  error?: string;
  sentEmails?: string[];  // emails sent in this campaign (from Postgres)
  senderEmail?: string;   // who launched this campaign
  templateId?: string;
  followUp?: { enabled: boolean; delayDays: number; subjectEn: string; subjectFr: string; bodyEn: string; bodyFr: string };
  followUp2?: { enabled: boolean; delayDays: number; subjectEn: string; subjectFr: string; bodyEn: string; bodyFr: string };
  sendWindow?: { enabled: boolean; startHour: number; endHour: number };
  weekSchedule?: { activeDays: boolean[]; distributionMode: string; customWeights?: number[] };
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

  const previewContacts = useCallback(async (sheetId?: string, tab?: string, limit = 10, includeSent = false) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (sheetId) params.set('sheetId', sheetId);
    if (tab) params.set('tab', tab);
    if (includeSent) params.set('includeSent', 'true');
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
    maxEmails?: number;
    speedMode?: 'slow' | 'normal' | 'fast';
    draftMode?: boolean;
    scheduledAt?: string;
    senderEmail?: string;
    unsubscribeEnabled?: boolean;
    followUpUnsubscribeEnabled?: boolean;
    sendWindow?: { enabled: boolean; startHour: number; endHour: number };
    weekSchedule?: { activeDays: boolean[]; distributionMode: string; customWeights?: number[] };
    followUp?: {
      enabled: boolean;
      delayDays: number;
      subjectEn: string;
      subjectFr: string;
      bodyEn: string;
      bodyFr: string;
    };
    followUp2?: {
      enabled: boolean;
      delayDays: number;
      subjectEn: string;
      subjectFr: string;
      bodyEn: string;
      bodyFr: string;
    };
  }): Promise<{ campaignId?: string }> => {
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
        return { campaignId: data.campaignId };
      } else {
        setApiError(data.error || 'Failed to start pipeline');
        return {};
      }
    } catch (err: any) {
      setApiError('API unreachable. Is the API server running?');
      return {};
    } finally {
      setLoading(false);
    }
  }, [user?.email, fetchPipelineStatus]);

  const scheduleCampaign = useCallback(async (opts: {
    excludeIds?: string[];
    sheetId?: string;
    tab?: string;
    emailOverrides?: Record<string, { subject: string; body: string }>;
    scheduledAt: string;
  }): Promise<{ campaignId?: string }> => {
    setLoading(true);
    setRunMessage(null);
    setApiError(null);
    try {
      const res = await fetch(`${API_URL}/api/pipeline/run`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (res.ok) {
        setRunMessage(data.message || 'Campaign scheduled!');
        return { campaignId: data.campaignId };
      } else {
        setApiError(data.error || 'Failed to schedule campaign');
        return {};
      }
    } catch (err: any) {
      setApiError('API unreachable. Is the API server running?');
      return {};
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  const pollProgress = useCallback(async (campaignId?: string): Promise<PipelineProgress> => {
    const params = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
    const res = await fetch(`${API_URL}/api/pipeline/progress${params}`, { headers: authHeaders });
    if (!res.ok) throw new Error('Failed to fetch progress');
    return res.json();
  }, [user?.email]);

  const getConnectUrl = useCallback((email: string) => {
    return `${API_URL}/api/senders/auth?email=${encodeURIComponent(email)}`;
  }, []);

  const disconnectSender = useCallback(async (email: string) => {
    await fetch(`${API_URL}/api/senders/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    fetchSenders();
  }, [user?.email]);

  const updateSenderLimit = useCallback(async (email: string, dailyLimit: number): Promise<void> => {
    await fetch(`${API_URL}/api/senders/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ dailyLimit }),
    });
    fetchSenders();
  }, [user?.email]);

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
    scheduleCampaign,
    previewContacts,
    pollProgress,
    getConnectUrl,
    disconnectSender,
    updateSenderLimit,
    refresh: () => { fetchSenders(); fetchPipelineStatus(); },
  };
}

export function useCampaigns(user: AuthUser | null) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(user?.email ? { 'X-Auth-Email': user.email } : {}),
  };

  const fetchCampaigns = useCallback(async () => {
    if (!user?.email?.endsWith('@alpic.ai')) return;
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_URL || 'http://localhost:4001')}/api/pipeline/campaigns`, { headers: authHeaders });
      if (res.ok) setCampaigns(await res.json());
    } catch {
      // silent
    }
  }, [user?.email]);

  const cancelCampaign = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_URL || 'http://localhost:4001')}/api/pipeline/campaigns/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.ok) {
        setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: 'cancelled' as const } : c));
      }
    } catch {
      // silent
    }
  }, [user?.email]);

  useEffect(() => {
    fetchCampaigns();
    const interval = setInterval(fetchCampaigns, 5000);
    return () => clearInterval(interval);
  }, [fetchCampaigns]);

  const fetchCampaignDetails = useCallback(async (id: string): Promise<Campaign | null> => {
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_URL || 'http://localhost:4001')}/api/pipeline/campaigns/${id}`, { headers: authHeaders });
      if (res.ok) return await res.json();
    } catch {}
    return null;
  }, [user?.email]);

  return { campaigns, cancelCampaign, fetchCampaignDetails, refetch: fetchCampaigns };
}
