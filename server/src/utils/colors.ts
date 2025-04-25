import { validateHTMLColorHex, validateHTMLColorRgb, validateHTMLColorName } from 'validate-color';

/**
 * Validates if a string is a valid CSS color (hex or rgb format).
 * Does not support named colors, hsl, or alpha values.
 * @param color The string to validate.
 * @returns True if the string is a valid hex or rgb color, false otherwise.
 */
export function isValidColor(color: string): boolean {
  if (color == undefined) {
    return true;
  }

  if (typeof color !== 'string') {
    return false;
  }

  const trimmedColor = color.trim();

  // Empty string is valid
  if (trimmedColor.length === 0) {
    return true;
  }

  if (validateHTMLColorHex(trimmedColor) || validateHTMLColorRgb(trimmedColor) || validateHTMLColorName(trimmedColor)) {
    return true;
  }

  return false;
}
