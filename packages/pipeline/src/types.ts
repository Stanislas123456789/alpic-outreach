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
  profileGroup?: string;    // Profile group (A/B/C)

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
  competitorsLive?: string; // "Competitors Already Live"
  competitors: string;      // "Top 2 Competitors"
  techDNA?: string;
  aiInitiatives?: string;
  urgencyScore?: number;
  outreachAngle?: string;
  language: Language;

  // Pre-filled email content (from sheet)
  emailSubject?: string;
  emailBody?: string;
  weekAdded?: string;

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

// Google Sheets column mapping — matches actual sheet layout (verified 2026-04-14)
// Data zone: A–Q (cols 0–16) | Tracking zone: R–AA (cols 17–26)
export const SHEET_COLUMNS = {
  industry: 0,         // A
  subIndustry: 1,      // B
  company: 2,          // C
  website: 3,          // D
  contactName: 4,      // E
  role: 5,             // F
  linkedIn: 6,         // G
  email: 7,            // H
  country: 8,          // I
  region: 9,           // J
  estRevenue: 10,      // K
  estEmployees: 11,    // L
  competitors: 12,     // M — "Competitors Already Live"
  competitorsLive: 12, // M — alias
  techDNA: 13,         // N
  aiInitiatives: 14,   // O
  urgencyScore: 15,    // P
  outreachAngle: 16,   // Q
  // Tracking zone
  status: 17,          // R
  assignedTo: 18,      // S
  sentAt: 19,          // T
  messageId: 20,       // U
  threadId: 21,        // V
  openCount: 22,       // W
  firstOpenAt: 23,     // X
  repliedAt: 24,       // Y
  bounceReason: 25,    // Z
  language: 26,        // AA
} as const;
