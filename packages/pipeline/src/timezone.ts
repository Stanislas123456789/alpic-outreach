// ============================================
// COUNTRY → IANA TIMEZONE MAPPING
// Used for timezone-aware send windows
// ============================================

const COUNTRY_TIMEZONE_MAP: Record<string, string> = {
  // North America
  'united states': 'America/New_York',
  'usa': 'America/New_York',
  'us': 'America/New_York',
  'canada': 'America/Toronto',
  'mexico': 'America/Mexico_City',

  // Europe — Western
  'united kingdom': 'Europe/London',
  'uk': 'Europe/London',
  'ireland': 'Europe/Dublin',
  'portugal': 'Europe/Lisbon',
  'iceland': 'Atlantic/Reykjavik',

  // Europe — Central (CET)
  'france': 'Europe/Paris',
  'germany': 'Europe/Berlin',
  'austria': 'Europe/Vienna',
  'switzerland': 'Europe/Zurich',
  'netherlands': 'Europe/Amsterdam',
  'belgium': 'Europe/Brussels',
  'luxembourg': 'Europe/Luxembourg',
  'spain': 'Europe/Madrid',
  'italy': 'Europe/Rome',
  'poland': 'Europe/Warsaw',
  'czech republic': 'Europe/Prague',
  'czechia': 'Europe/Prague',
  'hungary': 'Europe/Budapest',
  'sweden': 'Europe/Stockholm',
  'norway': 'Europe/Oslo',
  'denmark': 'Europe/Copenhagen',
  'finland': 'Europe/Helsinki',
  'croatia': 'Europe/Zagreb',
  'slovakia': 'Europe/Bratislava',
  'slovenia': 'Europe/Ljubljana',
  'serbia': 'Europe/Belgrade',

  // Europe — Eastern (EET)
  'greece': 'Europe/Athens',
  'romania': 'Europe/Bucharest',
  'bulgaria': 'Europe/Sofia',
  'turkey': 'Europe/Istanbul',
  'ukraine': 'Europe/Kiev',
  'estonia': 'Europe/Tallinn',
  'latvia': 'Europe/Riga',
  'lithuania': 'Europe/Vilnius',

  // Middle East
  'israel': 'Asia/Jerusalem',
  'saudi arabia': 'Asia/Riyadh',
  'united arab emirates': 'Asia/Dubai',
  'uae': 'Asia/Dubai',
  'qatar': 'Asia/Qatar',
  'bahrain': 'Asia/Bahrain',
  'kuwait': 'Asia/Kuwait',
  'oman': 'Asia/Muscat',
  'jordan': 'Asia/Amman',
  'lebanon': 'Asia/Beirut',

  // Asia
  'india': 'Asia/Kolkata',
  'china': 'Asia/Shanghai',
  'japan': 'Asia/Tokyo',
  'south korea': 'Asia/Seoul',
  'korea': 'Asia/Seoul',
  'singapore': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  'taiwan': 'Asia/Taipei',
  'thailand': 'Asia/Bangkok',
  'vietnam': 'Asia/Ho_Chi_Minh',
  'indonesia': 'Asia/Jakarta',
  'malaysia': 'Asia/Kuala_Lumpur',
  'philippines': 'Asia/Manila',
  'pakistan': 'Asia/Karachi',
  'bangladesh': 'Asia/Dhaka',

  // Oceania
  'australia': 'Australia/Sydney',
  'new zealand': 'Pacific/Auckland',

  // South America
  'brazil': 'America/Sao_Paulo',
  'argentina': 'America/Argentina/Buenos_Aires',
  'chile': 'America/Santiago',
  'colombia': 'America/Bogota',
  'peru': 'America/Lima',

  // Africa
  'south africa': 'Africa/Johannesburg',
  'nigeria': 'Africa/Lagos',
  'egypt': 'Africa/Cairo',
  'kenya': 'Africa/Nairobi',
  'morocco': 'Africa/Casablanca',
  'ghana': 'Africa/Accra',
  'ethiopia': 'Africa/Addis_Ababa',
  'tanzania': 'Africa/Dar_es_Salaam',

  // Russia & CIS
  'russia': 'Europe/Moscow',
  'kazakhstan': 'Asia/Almaty',
  'georgia': 'Asia/Tbilisi',
};

/**
 * Maps a country name to an IANA timezone string.
 * Falls back to UTC for unknown countries.
 */
export function countryToTimezone(country: string): string {
  if (!country) return 'UTC';
  const key = country.toLowerCase().trim();
  return COUNTRY_TIMEZONE_MAP[key] || 'UTC';
}

/**
 * Gets the current hour (0-23) in the given IANA timezone.
 */
export function getCurrentHourInTimezone(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hourPart = parts.find(p => p.type === 'hour');
    return parseInt(hourPart?.value || '0', 10);
  } catch {
    // Invalid timezone — fall back to UTC
    return new Date().getUTCHours();
  }
}

/**
 * Checks if the current time in the contact's timezone falls within the send window.
 * Returns true if sending is allowed.
 */
export function isWithinSendWindow(
  country: string,
  startHour: number,
  endHour: number,
): boolean {
  const tz = countryToTimezone(country);
  const currentHour = getCurrentHourInTimezone(tz);

  // Handle same-day windows (e.g. 9-17)
  if (startHour <= endHour) {
    return currentHour >= startHour && currentHour < endHour;
  }
  // Handle overnight windows (e.g. 22-6) — unlikely but supported
  return currentHour >= startHour || currentHour < endHour;
}

/**
 * Gets the current day of week (0=Sunday, 1=Monday, ..., 6=Saturday) in the given timezone.
 */
export function getCurrentDayInTimezone(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });
    const dayStr = formatter.format(new Date());
    const dayMap: Record<string, number> = {
      'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
    };
    return dayMap[dayStr] ?? new Date().getDay();
  } catch {
    return new Date().getDay();
  }
}
