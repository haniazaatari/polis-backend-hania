import Config from '../config';
import logger from './logger';

/**
 * Validates if a font family name exists in the Google Fonts library.
 * Considers null, undefined, or empty strings as valid (representing default).
 * @param fontFamilyName The font family name to validate (e.g., "Roboto", "Open Sans").
 * @returns A promise that resolves to true if the font is valid or the input is empty/null/undefined, false otherwise.
 */
export async function isValidFont(fontFamilyName: string | null | undefined): Promise<boolean> {
    // 1. Check for API Key
    if (!Config.googleApiKey) {
        logger.error("Google Fonts API Key (GOOGLE_API_KEY) is not configured. Cannot validate fonts.");
        // Depending on requirements, you might want to throw an error or handle this differently.
        // For now, we'll consider it an invalid state for validation.
        return false;
    }

    // 2. Handle null, undefined, or empty string inputs as valid (default)
    if (fontFamilyName === null || fontFamilyName === undefined) {
        logger.debug("isValidFont: Input is null or undefined, considered valid (default).");
        return true;
    }
    if (typeof fontFamilyName !== 'string') {
         logger.warn(`isValidFont: Input is not a string (${typeof fontFamilyName}), considered invalid.`);
         return false; // Or handle non-string types as needed
    }

    const trimmedFontFamilyName = fontFamilyName.trim();
    if (trimmedFontFamilyName === '') {
        logger.debug("isValidFont: Input trims to an empty string, considered valid (default).");
        return true;
    }

    // 3. Query Google Fonts API
    const encodedFontFamily = encodeURIComponent(trimmedFontFamilyName);
    // Using the 'family' query parameter acts as a filter
    const apiUrl = `https://www.googleapis.com/webfonts/v1/webfonts?key=${Config.googleApiKey}&family=${encodedFontFamily}`;

    logger.debug(`isValidFont: Checking Google Fonts API for family: ${trimmedFontFamilyName}`);
    // Avoid logging keys in production if possible
    // logger.debug(`isValidFont: Request URL: ${apiUrl}`); 

    try {
        const response = await fetch(apiUrl);

        // Check for network/server errors reported by fetch
        if (!response.ok) {
            logger.error(`isValidFont: Error fetching font data from Google API: ${response.status} ${response.statusText}`);
            try {
                 const errorBody = await response.text();
                 logger.error(`isValidFont: Google API Error details: ${errorBody}`);
            } catch (e) {
                 logger.error("isValidFont: Could not parse error response body.");
            }
            return false;
        }

        const data = await response.json();

        // Check if the API returned exactly one match for the filtered family name
        if (data.items && Array.isArray(data.items) && data.items.length === 1) {
            // Optional: Double-check the family name matches if needed, though the API filter should handle this.
             if (data.items[0].family === trimmedFontFamilyName) {
                 logger.debug(`isValidFont: Font family '${trimmedFontFamilyName}' is valid.`);
                 return true;
            } else {
                // This case is unlikely if the API filter should handle this
                logger.warn(`isValidFont: API returned a font, but the family name '${data.items[0].family}' doesn't exactly match requested '${trimmedFontFamilyName}'. Considering invalid.`);
                return false;
            }
        } else {
            // If items array is empty or has unexpected content, the font is not found
            logger.warn(`isValidFont: Font family '${trimmedFontFamilyName}' not found via Google Fonts API.`);
            return false;
        }

    } catch (error) {
        // Handle network errors, JSON parsing errors, etc.
        logger.error('isValidFont: An unexpected error occurred during the font validation API call:', error);
        return false;
    }
}
