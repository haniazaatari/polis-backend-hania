/**
 * Middleware to move query and path parameters to the request body
 * This is useful for standardizing parameter access across different HTTP methods
 *
 * @param {Object} req - Express request object
 * @param {Object} _res - Express response object
 * @param {Function} next - Express next function
 */

export function moveToBody(req, _res, next) {
  if (req.query) {
    req.body = req.body || {};
    Object.assign(req.body, req.query);
  }
  if (req.params) {
    req.body = req.body || {};
    Object.assign(req.body, req.params);
  }
  req.p = req.p || {};
  next();
}
