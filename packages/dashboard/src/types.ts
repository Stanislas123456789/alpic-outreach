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
  linkedIn?: string;
  company: string;
  website?: string;
  industry: Industry;
  subIndustry?: string;
  country: string;
  region?: string;
  profileGroup?: string;
  competitorsLive?: string;
  competitors: string;
  techDNA?: string;
  aiInitiatives?: string;
  urgencyScore?: number;
  outreachAngle?: string;
  emailSubject?: string;
  emailBody?: string;
  weekAdded?: string;
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

// Master Table tab of sales_pipe_master sheet
export const SHEET_COLUMNS = {
  industry: 0, subIndustry: 1, company: 2, website: 3, contactName: 4,
  role: 5, linkedIn: 6, email: 7, profileGroup: 8, country: 9, region: 10,
  estRevenue: 11, estEmployees: 12, competitorsLive: 13, techDNA: 14,
  aiInitiatives: 15, urgencyScore: 16, outreachAngle: 17,
  competitors: 18, emailSubject: 19, emailBody: 20, weekAdded: 21,
  status: 22, assignedTo: 23, sentAt: 24, messageId: 25,
  threadId: 26, openCount: 27, firstOpenAt: 28, repliedAt: 29,
  bounceReason: 30,
} as const;
