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
  'ca': 'America/Toronto',
  'mexico': 'America/Mexico_City',
  'mx': 'America/Mexico_City',

  // Europe — Western
  'united kingdom': 'Europe/London',
  'uk': 'Europe/London',
  'gb': 'Europe/London',
  'ireland': 'Europe/Dublin',
  'ie': 'Europe/Dublin',
  'portugal': 'Europe/Lisbon',
  'pt': 'Europe/Lisbon',
  'iceland': 'Atlantic/Reykjavik',
  'is': 'Atlantic/Reykjavik',

  // Europe — Central (CET)
  'france': 'Europe/Paris',
  'fr': 'Europe/Paris',
  'germany': 'Europe/Berlin',
  'de': 'Europe/Berlin',
  'austria': 'Europe/Vienna',
  'at': 'Europe/Vienna',
  'switzerland': 'Europe/Zurich',
  'ch': 'Europe/Zurich',
  'netherlands': 'Europe/Amsterdam',
  'nl': 'Europe/Amsterdam',
  'belgium': 'Europe/Brussels',
  'be': 'Europe/Brussels',
  'luxembourg': 'Europe/Luxembourg',
  'lu': 'Europe/Luxembourg',
  'spain': 'Europe/Madrid',
  'es': 'Europe/Madrid',
  'italy': 'Europe/Rome',
  'it': 'Europe/Rome',
  'poland': 'Europe/Warsaw',
  'pl': 'Europe/Warsaw',
  'czech republic': 'Europe/Prague',
  'czechia': 'Europe/Prague',
  'cz': 'Europe/Prague',
  'hungary': 'Europe/Budapest',
  'hu': 'Europe/Budapest',
  'sweden': 'Europe/Stockholm',
  'se': 'Europe/Stockholm',
  'norway': 'Europe/Oslo',
  'no': 'Europe/Oslo',
  'denmark': 'Europe/Copenhagen',
  'dk': 'Europe/Copenhagen',
  'finland': 'Europe/Helsinki',
  'fi': 'Europe/Helsinki',
  'croatia': 'Europe/Zagreb',
  'hr': 'Europe/Zagreb',
  'slovakia': 'Europe/Bratislava',
  'sk': 'Europe/Bratislava',
  'slovenia': 'Europe/Ljubljana',
  'si': 'Europe/Ljubljana',
  'serbia': 'Europe/Belgrade',
  'rs': 'Europe/Belgrade',

  // Europe — Eastern (EET)
  'greece': 'Europe/Athens',
  'gr': 'Europe/Athens',
  'romania': 'Europe/Bucharest',
  'ro': 'Europe/Bucharest',
  'bulgaria': 'Europe/Sofia',
  'bg': 'Europe/Sofia',
  'turkey': 'Europe/Istanbul',
  'tr': 'Europe/Istanbul',
  'ukraine': 'Europe/Kiev',
  'ua': 'Europe/Kiev',
  'estonia': 'Europe/Tallinn',
  'ee': 'Europe/Tallinn',
  'latvia': 'Europe/Riga',
  'lv': 'Europe/Riga',
  'lithuania': 'Europe/Vilnius',
  'lt': 'Europe/Vilnius',

  // Middle East
  'israel': 'Asia/Jerusalem',
  'il': 'Asia/Jerusalem',
  'saudi arabia': 'Asia/Riyadh',
  'sa': 'Asia/Riyadh',
  'united arab emirates': 'Asia/Dubai',
  'uae': 'Asia/Dubai',
  'ae': 'Asia/Dubai',
  'qatar': 'Asia/Qatar',
  'qa': 'Asia/Qatar',
  'bahrain': 'Asia/Bahrain',
  'bh': 'Asia/Bahrain',
  'kuwait': 'Asia/Kuwait',
  'kw': 'Asia/Kuwait',
  'oman': 'Asia/Muscat',
  'om': 'Asia/Muscat',
  'jordan': 'Asia/Amman',
  'jo': 'Asia/Amman',
  'lebanon': 'Asia/Beirut',
  'lb': 'Asia/Beirut',

  // Asia
  'india': 'Asia/Kolkata',
  'in': 'Asia/Kolkata',
  'china': 'Asia/Shanghai',
  'cn': 'Asia/Shanghai',
  'japan': 'Asia/Tokyo',
  'jp': 'Asia/Tokyo',
  'south korea': 'Asia/Seoul',
  'korea': 'Asia/Seoul',
  'kr': 'Asia/Seoul',
  'singapore': 'Asia/Singapore',
  'sg': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  'hk': 'Asia/Hong_Kong',
  'taiwan': 'Asia/Taipei',
  'tw': 'Asia/Taipei',
  'thailand': 'Asia/Bangkok',
  'th': 'Asia/Bangkok',
  'vietnam': 'Asia/Ho_Chi_Minh',
  'vn': 'Asia/Ho_Chi_Minh',
  'indonesia': 'Asia/Jakarta',
  'id': 'Asia/Jakarta',
  'malaysia': 'Asia/Kuala_Lumpur',
  'my': 'Asia/Kuala_Lumpur',
  'philippines': 'Asia/Manila',
  'ph': 'Asia/Manila',
  'pakistan': 'Asia/Karachi',
  'pk': 'Asia/Karachi',
  'bangladesh': 'Asia/Dhaka',
  'bd': 'Asia/Dhaka',

  // Oceania
  'australia': 'Australia/Sydney',
  'au': 'Australia/Sydney',
  'new zealand': 'Pacific/Auckland',
  'nz': 'Pacific/Auckland',

  // South America
  'brazil': 'America/Sao_Paulo',
  'br': 'America/Sao_Paulo',
  'argentina': 'America/Argentina/Buenos_Aires',
  'ar': 'America/Argentina/Buenos_Aires',
  'chile': 'America/Santiago',
  'cl': 'America/Santiago',
  'colombia': 'America/Bogota',
  'co': 'America/Bogota',
  'peru': 'America/Lima',
  'pe': 'America/Lima',

  // Africa
  'south africa': 'Africa/Johannesburg',
  'za': 'Africa/Johannesburg',
  'nigeria': 'Africa/Lagos',
  'ng': 'Africa/Lagos',
  'egypt': 'Africa/Cairo',
  'eg': 'Africa/Cairo',
  'kenya': 'Africa/Nairobi',
  'ke': 'Africa/Nairobi',
  'morocco': 'Africa/Casablanca',
  'ma': 'Africa/Casablanca',
  'ghana': 'Africa/Accra',
  'gh': 'Africa/Accra',
  'ethiopia': 'Africa/Addis_Ababa',
  'et': 'Africa/Addis_Ababa',
  'tanzania': 'Africa/Dar_es_Salaam',
  'tz': 'Africa/Dar_es_Salaam',

  // Russia & CIS
  'russia': 'Europe/Moscow',
  'ru': 'Europe/Moscow',
  'kazakhstan': 'Asia/Almaty',
  'kz': 'Asia/Almaty',
  'georgia': 'Asia/Tbilisi',
  'ge': 'Asia/Tbilisi',
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
