// ============================================
// ALPIC OUTREACH - SHARED TYPES
// ============================================

export type EmailStatus =
  | 'pending'
  | 'validating'
  | 'invalid'
  | 'sending'
  | 'sent'
  | 'bounced'
  | 'opened'
  | 'replied'
  | 'skipped';

export type Industry =
  | 'Travel'
  | 'Insurance'
  | 'SaaS'
  | 'Ecommerce/Marketplace'
  | 'Real Estate'
  | string;

export type Language = 'EN' | 'FR' | 'DE' | 'ES';

// Row from Google Sheets pipeline
export interface Contact {
  rowIndex: number;         // Sheets row number (for updates)
  id: string;               // Unique ID (generated from email+company)

  // Contact info
  firstName: string;
  lastName?: string;
  email: string;
  role: string;
  linkedIn?: string;

  // Company info
  company: string;
  website?: string;
  industry: Industry;
  subIndustry?: string;
  country: string;
  region?: string;
  estRevenue?: number;
  estEmployees?: number;

  // Outreach data
  competitors: string;      // "Omio, Rome2Rio" - from sheet
  techDNA?: string;
  aiInitiatives?: string;
  urgencyScore?: number;
  outreachAngle?: string;
  language: Language;

  // Pipeline tracking
  status: EmailStatus;
  assignedTo?: string;      // sender email
  sentAt?: string;          // ISO timestamp
  messageId?: string;       // Gmail message ID
  threadId?: string;        // Gmail thread ID
  openCount?: number;
  firstOpenAt?: string;
  repliedAt?: string;
  bounceReason?: string;
}

// Sender account config
export interface Sender {
  email: string;
  name: string;
  refreshToken: string;
  dailyLimit: number;
  sentToday: number;
}

// Email send result
export interface SendResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  bounced?: boolean;
}

// Analytics aggregation
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

// Google Sheets column mapping
// IMPORTANT: Update these if your sheet columns change
export const SHEET_COLUMNS = {
  industry: 0,
  subIndustry: 1,
  company: 2,
  website: 3,
  contactName: 4,
  role: 5,
  linkedIn: 6,
  email: 7,
  country: 8,
  region: 9,
  estRevenue: 10,
  estEmployees: 11,
  competitors: 12,
  techDNA: 13,
  aiInitiatives: 14,
  urgencyScore: 15,
  outreachAngle: 16,
  // Pipeline tracking columns (appended)
  status: 17,
  assignedTo: 18,
  sentAt: 19,
  messageId: 20,
  threadId: 21,
  openCount: 22,
  firstOpenAt: 23,
  repliedAt: 24,
  bounceReason: 25,
  language: 26,
} as const;
