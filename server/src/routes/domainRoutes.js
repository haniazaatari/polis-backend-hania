/**
 * Domain Routes
 * Defines API routes for domain-related operations
 */
import express from 'express';
import { handleGetDomainWhitelist, handlePostDomainWhitelist } from '../controllers/domainController.js';
import { auth, moveToBody } from '../middlewares/index.js';
import { assignToP, getOptionalStringLimitLength, need } from '../utils/parameter.js';

const router = express();

/**
 * @api {get} /api/v3/domainWhitelist Get domain whitelist
 * @apiName GetDomainWhitelist
 * @apiGroup Domain
 * @apiDescription Get the domain whitelist for the authenticated user
 *
 * @apiSuccess {String} domain_whitelist Comma-separated list of whitelisted domains
 */
router.get('/', moveToBody, auth(assignToP), handleGetDomainWhitelist);

/**
 * @api {post} /api/v3/domainWhitelist Update domain whitelist
 * @apiName PostDomainWhitelist
 * @apiGroup Domain
 * @apiDescription Update the domain whitelist for the authenticated user
 *
 * @apiParam {String} [domain_whitelist] Comma-separated list of domains to whitelist
 *
 * @apiSuccess {String} domain_whitelist The updated domain whitelist
 */
router.post(
  '/',
  auth(assignToP),
  need('domain_whitelist', getOptionalStringLimitLength(999), assignToP, ''),
  handlePostDomainWhitelist
);

export default router;
