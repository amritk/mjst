/**
 * Generates a best-guess default value from a regex pattern.
 * Recognizes common patterns and returns appropriate defaults.
 */
export const generateDefaultFromPattern = (pattern: string): string | null => {
  // Email pattern
  if (pattern.includes('@') || (pattern.includes('[a-zA-Z0-9]') && pattern.includes('\\.'))) {
    return '"user@example.com"'
  }

  // UUID pattern
  if ((pattern.includes('[0-9a-f]') && pattern.includes('{8}')) || pattern.includes('\\-')) {
    if (pattern.match(/[0-9a-f].*\{8\}/i) || pattern.match(/[0-9a-fA-F]{8}/)) {
      return '"00000000-0000-0000-0000-000000000000"'
    }
  }

  // URL pattern
  if (pattern.includes('https?') || pattern.includes('http')) {
    return '"https://example.com"'
  }

  // Semver pattern (3.1.x, x.y.z, etc)
  if (pattern.match(/\d.*\\\.\.*\d/)) {
    return '"1.0.0"'
  }

  // ISO date pattern
  if (pattern.includes('\\d{4}') && pattern.includes('\\d{2}')) {
    return '"2000-01-01"'
  }

  // Phone number patterns
  if (pattern.includes('\\d{3}') && (pattern.includes('\\d{4}') || pattern.includes('\\d{7}'))) {
    return '"+1234567890"'
  }

  return null
}
