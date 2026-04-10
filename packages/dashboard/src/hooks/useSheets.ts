// ============================================
// GOOGLE SHEETS DATA HOOK FOR DASHBOARD
// Uses Sheets API v4 with API key (read-only)
// ============================================
import { useState, useEffect, useCallback } from 'react';
import { Contact, RepMetrics, IndustryMetrics, SHEET_COLUMNS } from '../types';

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

async function fetchSheetData(sheetId: string, sheetTab: string): Promise<Contact[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetTab}!A2:AE?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
  const json = await res.json();
  const rows: string[][] = json.values || [];

  return rows
    .filter(row => row[SHEET_COLUMNS.email])
    .map((row, i) => ({
      rowIndex: i + 2,
      id: row[SHEET_COLUMNS.email] || '',
      firstName: (row[SHEET_COLUMNS.contactName] || '').split(' ')[0] || '',
      email: row[SHEET_COLUMNS.email] || '',
      role: row[SHEET_COLUMNS.role] || '',
      linkedIn: row[SHEET_COLUMNS.linkedIn] || '',
      company: row[SHEET_COLUMNS.company] || '',
      website: row[SHEET_COLUMNS.website] || '',
      industry: row[SHEET_COLUMNS.industry] || '',
      subIndustry: row[SHEET_COLUMNS.subIndustry] || '',
      country: row[SHEET_COLUMNS.country] || '',
      region: row[SHEET_COLUMNS.region] || '',
      profileGroup: row[SHEET_COLUMNS.profileGroup] || '',
      competitorsLive: row[SHEET_COLUMNS.competitorsLive] || '',
      competitors: row[SHEET_COLUMNS.competitors] || '',
      emailSubject: row[SHEET_COLUMNS.emailSubject] || '',
      emailBody: row[SHEET_COLUMNS.emailBody] || '',
      weekAdded: row[SHEET_COLUMNS.weekAdded] || '',
      language: 'EN' as const,
      status: (row[SHEET_COLUMNS.status] as any) || 'pending',
      assignedTo: row[SHEET_COLUMNS.assignedTo] || '',
      sentAt: row[SHEET_COLUMNS.sentAt] || '',
      messageId: row[SHEET_COLUMNS.messageId] || '',
      threadId: row[SHEET_COLUMNS.threadId] || '',
      openCount: parseInt(row[SHEET_COLUMNS.openCount]) || 0,
      firstOpenAt: row[SHEET_COLUMNS.firstOpenAt] || '',
      repliedAt: row[SHEET_COLUMNS.repliedAt] || '',
      bounceReason: row[SHEET_COLUMNS.bounceReason] || '',
    }));
}

// ─── Aggregations ─────────────────────────────────────────────────────────────

export function computeRepMetrics(contacts: Contact[]): RepMetrics[] {
  const repMap = new Map<string, RepMetrics>();

  for (const c of contacts) {
    if (!c.assignedTo || c.status === 'pending' || c.status === 'invalid') continue;

    if (!repMap.has(c.assignedTo)) {
      repMap.set(c.assignedTo, {
        repEmail: c.assignedTo,
        repName: c.assignedTo.split('@')[0],
        sent: 0, bounced: 0, opened: 0, replied: 0,
        bounceRate: 0, openRate: 0, replyRate: 0,
      });
    }

    const m = repMap.get(c.assignedTo)!;
    m.sent++;
    if (c.status === 'bounced') m.bounced++;
    if (c.status === 'opened' || c.openCount > 0) m.opened++;
    if (c.status === 'replied') m.replied++;
  }

  return Array.from(repMap.values()).map(m => ({
    ...m,
    bounceRate: m.sent > 0 ? Math.round((m.bounced / m.sent) * 100) : 0,
    openRate: m.sent > 0 ? Math.round((m.opened / m.sent) * 100) : 0,
    replyRate: m.sent > 0 ? Math.round((m.replied / m.sent) * 100) : 0,
  })).sort((a, b) => b.replyRate - a.replyRate);
}

export function computeIndustryMetrics(contacts: Contact[]): IndustryMetrics[] {
  const industryMap = new Map<string, IndustryMetrics>();

  for (const c of contacts) {
    if (!c.industry || c.status === 'pending' || c.status === 'invalid') continue;

    if (!industryMap.has(c.industry)) {
      industryMap.set(c.industry, {
        industry: c.industry,
        sent: 0, bounced: 0, opened: 0, replied: 0,
        openRate: 0, replyRate: 0,
      });
    }

    const m = industryMap.get(c.industry)!;
    m.sent++;
    if (c.status === 'bounced') m.bounced++;
    if (c.status === 'opened' || c.openCount > 0) m.opened++;
    if (c.status === 'replied') m.replied++;
  }

  return Array.from(industryMap.values()).map(m => ({
    ...m,
    openRate: m.sent > 0 ? Math.round((m.opened / m.sent) * 100) : 0,
    replyRate: m.sent > 0 ? Math.round((m.replied / m.sent) * 100) : 0,
  })).sort((a, b) => b.sent - a.sent);
}

export function computeFunnel(contacts: Contact[]) {
  const sent = contacts.filter(c => c.status !== 'pending' && c.status !== 'invalid').length;
  const delivered = contacts.filter(c => c.status !== 'bounced' && c.status !== 'pending' && c.status !== 'invalid').length;
  const opened = contacts.filter(c => c.openCount > 0 || c.status === 'opened' || c.status === 'replied').length;
  const replied = contacts.filter(c => c.status === 'replied').length;

  return [
    { stage: 'Sent', value: sent, color: '#6366f1' },
    { stage: 'Delivered', value: delivered, color: '#8b5cf6' },
    { stage: 'Opened', value: opened, color: '#a78bfa' },
    { stage: 'Replied', value: replied, color: '#34d399' },
  ];
}

// ─── Multi-sheet aggregate hook ───────────────────────────────────────────────

import type { SheetSource } from './useConfig';

export function useAllSheets(sources: SheetSource[], refreshInterval = 30000) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const all: Contact[] = [];
    await Promise.allSettled(
      sources
        .filter(s => s.sheetId)
        .map(async s => {
          try {
            const data = await fetchSheetData(s.sheetId, s.sheetTab);
            all.push(...data);
          } catch {
            // individual sheet failure is silent — don't break the whole view
          }
        })
    );
    setContacts(all);
    setLastUpdated(new Date());
    setLoading(false);
  }, [sources.map(s => s.id + s.sheetId + s.sheetTab).join(',')]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  const repMetrics = computeRepMetrics(contacts);
  const industryMetrics = computeIndustryMetrics(contacts);
  const funnel = computeFunnel(contacts);
  const totalSent = contacts.filter(c => c.status !== 'pending' && c.status !== 'invalid').length;
  const totalPending = contacts.filter(c => c.status === 'pending').length;
  const bounceRate = totalSent > 0 ? Math.round((contacts.filter(c => c.status === 'bounced').length / totalSent) * 100) : 0;
  const openRate = totalSent > 0 ? Math.round((contacts.filter(c => c.openCount > 0 || c.status === 'opened' || c.status === 'replied').length / totalSent) * 100) : 0;
  const replyRate = totalSent > 0 ? Math.round((contacts.filter(c => c.status === 'replied').length / totalSent) * 100) : 0;

  return {
    contacts, loading, lastUpdated, refresh,
    repMetrics, industryMetrics, funnel,
    stats: { totalSent, totalPending, bounceRate, openRate, replyRate },
  };
}

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useSheets(sheetId: string, sheetTab: string, refreshInterval = 60000) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!sheetId) {
      setError('No Sheet ID configured. Add a source in Settings.');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      setLoading(true);
      const data = await fetchSheetData(sheetId, sheetTab);
      setContacts(data);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sheetId, sheetTab]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  const repMetrics = computeRepMetrics(contacts);
  const industryMetrics = computeIndustryMetrics(contacts);
  const funnel = computeFunnel(contacts);

  const totalSent = contacts.filter(c => c.status !== 'pending' && c.status !== 'invalid').length;
  const totalPending = contacts.filter(c => c.status === 'pending').length;
  const bounceRate = totalSent > 0
    ? Math.round((contacts.filter(c => c.status === 'bounced').length / totalSent) * 100)
    : 0;
  const openRate = totalSent > 0
    ? Math.round((contacts.filter(c => c.openCount > 0 || c.status === 'opened' || c.status === 'replied').length / totalSent) * 100)
    : 0;
  const replyRate = totalSent > 0
    ? Math.round((contacts.filter(c => c.status === 'replied').length / totalSent) * 100)
    : 0;

  return {
    contacts, loading, error, lastUpdated, refresh,
    repMetrics, industryMetrics, funnel,
    stats: { totalSent, totalPending, bounceRate, openRate, replyRate },
  };
}
