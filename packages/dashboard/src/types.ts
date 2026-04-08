// Shared types (mirrored from pipeline for dashboard use)
export type EmailStatus = 'pending' | 'validating' | 'invalid' | 'sending' | 'sent' | 'bounced' | 'opened' | 'replied' | 'skipped';
export type Industry = 'Travel' | 'Insurance' | 'SaaS' | 'Ecommerce/Marketplace' | 'Real Estate' | string;
export type Language = 'EN' | 'FR' | 'DE' | 'ES';

export interface Contact {
  rowIndex: number;
  id: string;
  firstName: string;
  email: string;
  role: string;
  company: string;
  website?: string;
  industry: Industry;
  subIndustry?: string;
  country: string;
  competitors: string;
  language: Language;
  status: EmailStatus;
  assignedTo?: string;
  sentAt?: string;
  messageId?: string;
  threadId?: string;
  openCount: number;
  firstOpenAt?: string;
  repliedAt?: string;
  bounceReason?: string;
}

export interface RepMetrics {
  repEmail: string;
  repName: string;
  sent: number;
  bounced: number;
  opened: number;
  replied: number;
  bounceRate: number;
  openRate: number;
  replyRate: number;
}

export interface IndustryMetrics {
  industry: Industry;
  sent: number;
  bounced: number;
  opened: number;
  replied: number;
  openRate: number;
  replyRate: number;
}

export const SHEET_COLUMNS = {
  industry: 0, subIndustry: 1, company: 2, website: 3, contactName: 4,
  role: 5, linkedIn: 6, email: 7, country: 8, region: 9,
  estRevenue: 10, estEmployees: 11, competitors: 12, techDNA: 13,
  aiInitiatives: 14, urgencyScore: 15, outreachAngle: 16,
  status: 17, assignedTo: 18, sentAt: 19, messageId: 20,
  threadId: 21, openCount: 22, firstOpenAt: 23, repliedAt: 24,
  bounceReason: 25, language: 26,
} as const;
