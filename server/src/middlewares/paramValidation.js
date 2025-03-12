import _ from 'underscore';
import { fail } from '../utils/responseHandlers.js';

/**
 * Middleware to validate and parse request parameters
 * @param {Object} spec - Validation specification
 * @returns {Function} Express middleware
 */
function paramValidation(spec) {
  return (req, res, next) => {
    const missing = [];
    const params = {};

    // Initialize req.p if it doesn't exist
    req.p = req.p || {};

    // Process each parameter in the spec
    _.each(spec, (paramSpec, paramName) => {
      const isRequired = paramSpec.required;
      let val = undefined;

      // Check all possible sources for the parameter
      if (paramName in req.body) {
        val = req.body[paramName];
      } else if (paramName in req.query) {
        val = req.query[paramName];
      } else if (paramName in req.params) {
        val = req.params[paramName];
      }

      // Handle required parameters
      if (isRequired && val === undefined) {
        missing.push(paramName);
        return;
      }

      // Skip optional parameters that are not provided
      if (val === undefined) {
        return;
      }

      // Type conversion
      if (paramSpec.type === 'int') {
        val = Number.parseInt(val);
        if (Number.isNaN(val)) {
          return fail(res, 400, `param ${paramName} should be an integer`);
        }
      } else if (paramSpec.type === 'boolean') {
        if (val === 'true') {
          val = true;
        } else if (val === 'false') {
          val = false;
        }
        if (typeof val !== 'boolean') {
          return fail(res, 400, `param ${paramName} should be a boolean`);
        }
      }

      // Store the validated parameter
      params[paramName] = val;
      req.p[paramName] = val;
    });

    // Handle missing required parameters
    if (missing.length) {
      return fail(res, 400, `missing required parameters: ${missing.join(', ')}`);
    }

    next();
  };
}

export default paramValidation;
