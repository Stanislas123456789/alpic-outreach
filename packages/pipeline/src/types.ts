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

// Google Sheets column mapping — Master Table tab of sales_pipe_master
// Data zone: A–V (cols 0–21) | Tracking zone: W–AE (cols 22–30)
export const SHEET_COLUMNS = {
  industry: 0,          // A
  subIndustry: 1,       // B
  company: 2,           // C
  website: 3,           // D
  contactName: 4,       // E
  role: 5,              // F
  linkedIn: 6,          // G
  email: 7,             // H
  profileGroup: 8,      // I — A/B/C profile tier
  country: 9,           // J
  region: 10,           // K
  estRevenue: 11,       // L
  estEmployees: 12,     // M
  competitorsLive: 13,  // N — "Competitors Already Live"
  techDNA: 14,          // O
  aiInitiatives: 15,    // P
  urgencyScore: 16,     // Q
  outreachAngle: 17,    // R
  competitors: 18,      // S — "Top 2 Competitors"
  emailSubject: 19,     // T — pre-filled subject
  emailBody: 20,        // U — pre-filled body HTML
  weekAdded: 21,        // V
  // Tracking zone (W–AE, cols 22–30)
  status: 22,           // W
  assignedTo: 23,       // X
  sentAt: 24,           // Y
  messageId: 25,        // Z
  threadId: 26,         // AA
  openCount: 27,        // AB
  firstOpenAt: 28,      // AC
  repliedAt: 29,        // AD
  bounceReason: 30,     // AE
} as const;
