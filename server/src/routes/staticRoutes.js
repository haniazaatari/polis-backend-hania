import express from 'express';
import Config from '../config.js';
import {
  conditionalIndexFetcher,
  fetchIndexForConversation,
  fetchThirdPartyCookieTestPt1,
  fetchThirdPartyCookieTestPt2
} from '../staticFiles/controllers/indexController.js';
import {
  fetchIndexForAdminPage,
  fetchIndexForReportPage,
  makeFileFetcher
} from '../staticFiles/services/fileService.js';
import { proxy } from '../staticFiles/services/proxyService.js';
import { makeRedirectorTo, normalizeUrl } from '../staticFiles/utils/routeUtils.js';

const router = express();

// Apply URL normalization middleware before other routes
router.use(normalizeUrl);

// Conditional index fetching
router.get('/', conditionalIndexFetcher);

// Conversation-related routes
router.get(/^\/[0-9][0-9A-Za-z]+(\/.*)?/, fetchIndexForConversation);
router.get(/^\/demo\/[0-9][0-9A-Za-z]+/, fetchIndexForConversation);
router.get(/^\/explore\/[0-9][0-9A-Za-z]+(\/.*)?/, fetchIndexForConversation);
router.get(/^\/ot\/[0-9][0-9A-Za-z]+(\/.*)?/, fetchIndexForConversation);
router.get(/^\/share\/[0-9][0-9A-Za-z]+(\/.*)?/, fetchIndexForConversation);
router.get(/^\/summary\/[0-9][0-9A-Za-z]+(\/.*)?/, fetchIndexForConversation);

// Admin pages
router.get(/^\/account(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/bot(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/bot\/install(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/bot\/support(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/company$/, fetchIndexForAdminPage);
router.get(/^\/contrib(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/conversations(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/createuser(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/demo$/, fetchIndexForAdminPage);
router.get(/^\/gov(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/home(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/integrate(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/m\/[0-9][0-9A-Za-z]+(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/other-conversations(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/privacy$/, fetchIndexForAdminPage);
router.get(/^\/pwreset.*/, fetchIndexForAdminPage);
router.get(/^\/pwresetinit.*/, fetchIndexForAdminPage);
router.get(/^\/signin(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/signout(\/.*)?/, fetchIndexForAdminPage);
router.get(/^\/tos$/, fetchIndexForAdminPage);

// Report pages
router.get(/^\/narrativeReport\/r?[0-9][0-9A-Za-z]+(\/.*)?/, fetchIndexForReportPage);
router.get(/^\/report\/r?[0-9][0-9A-Za-z]+(\/.*)?/, fetchIndexForReportPage);

// Third-party cookie tests
router.get('/thirdPartyCookieTestPt1.html', fetchThirdPartyCookieTestPt1);
router.get('/thirdPartyCookieTestPt2.html', fetchThirdPartyCookieTestPt2);

const adminPort = Config.staticFilesAdminPort;
const participationPort = Config.staticFilesParticipationPort;

// Admin-related static files
router.get(
  '/dist/admin_bundle.js',
  makeFileFetcher('/dist/admin_bundle.js', { 'Content-Type': 'application/javascript' }, {}, adminPort)
);
router.get('/__webpack_hmr', makeFileFetcher('/__webpack_hmr', { 'Content-Type': 'eventsource' }, {}, adminPort));
router.get('/embed', makeFileFetcher('/embed.html', { 'Content-Type': 'text/html' }, {}, adminPort));
router.get('/embedPreprod', makeFileFetcher('/embedPreprod.html', { 'Content-Type': 'text/html' }, {}, adminPort));
router.get('/embedReport', makeFileFetcher('/embedReport.html', { 'Content-Type': 'text/html' }, {}, adminPort));
router.get(
  '/embedReportPreprod',
  makeFileFetcher('/embedReportPreprod.html', { 'Content-Type': 'text/html' }, {}, adminPort)
);

// Participation-related static files
router.get('/styleguide', makeFileFetcher('/styleguide.html', { 'Content-Type': 'text/html' }, {}, participationPort));
router.get('/s/CTE', makeFileFetcher('/football.html', { 'Content-Type': 'text/html' }, {}, participationPort));

// Redirects
router.get('/about', makeRedirectorTo('/home'));
router.get('/football', makeRedirectorTo('/2arcefpshi'));
router.get('/nabi', makeRedirectorTo('/8ufpzc6fkm'));
router.get('/pdf', makeRedirectorTo('/23mymwyhkn'));

// Catch-all for other static assets
router.get(/^\/cached\/.*/, proxy);
router.get(/^\/font\/.*/, proxy);
router.get(/^\/.*embed.*js\/.*/, proxy);

// Additional fetchIndexWithoutPreloadData endpoints
router.get('/settings', makeFileFetcher('/index.html', { 'Content-Type': 'text/html' }, {}, participationPort));
router.get(
  /^\/conversation\/create(\/.*)?/,
  makeFileFetcher('/index.html', { 'Content-Type': 'text/html' }, {}, participationPort)
);
router.get(/^\/inbox(\/.*)?$/, makeFileFetcher('/index.html', { 'Content-Type': 'text/html' }, {}, participationPort));
router.get(/^\/s\//, makeFileFetcher('/index.html', { 'Content-Type': 'text/html' }, {}, participationPort));
router.get(/^\/s$/, makeFileFetcher('/index.html', { 'Content-Type': 'text/html' }, {}, participationPort));
router.get(
  /^\/user\/create(\/.*)?$/,
  makeFileFetcher('/index.html', { 'Content-Type': 'text/html' }, {}, participationPort)
);
router.get(
  /^\/user\/login(\/.*)?$/,
  makeFileFetcher('/index.html', { 'Content-Type': 'text/html' }, {}, participationPort)
);
router.get(
  /^\/user\/logout(\/.*)?$/,
  makeFileFetcher('/index.html', { 'Content-Type': 'text/html' }, {}, participationPort)
);

// Proxy all unmatched routes
router.use(proxy);

export default router;
