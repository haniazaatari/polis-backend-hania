/**
 * Checks if the requesting browser is unsupported (older IE versions)
 *
 * @param {Object} req - Express request object
 * @returns {boolean} - True if the browser is unsupported
 */
export function isUnsupportedBrowser(req) {
  const userAgent = req?.headers?.['user-agent'] || '';
  return /MSIE [234567]/.test(userAgent);
}

/**
 * Checks if the requesting browser supports HTML5 history push state
 * Used to determine whether to redirect or serve the application
 *
 * @param {Object} req - Express request object
 * @returns {boolean} - True if the browser supports push state
 */
export function browserSupportsPushState(req) {
  const userAgent = req?.headers?.['user-agent'] || '';
  return !/MSIE [23456789]/.test(userAgent);
}
