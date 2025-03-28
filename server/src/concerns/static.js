import { encode } from 'html-entities';
import httpProxy from 'http-proxy';
import replaceStream from 'replacestream';
import request from 'request-promise';
import _ from 'underscore';
import Config from '../config.js';
import { COOKIES, setCookieTestCookie } from '../utils/cookies.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';

const hostname = Config.staticFilesHost;
const staticFilesParticipationPort = Config.staticFilesParticipationPort;
const staticFilesAdminPort = Config.staticFilesAdminPort;
const devMode = Config.isDevMode;
const routingProxy = new httpProxy.createProxyServer();
const serverUrl = Config.getServerUrl();

function makeFileFetcher(_hostname, port, path, headers, preloadData) {
  return (req, res) => {
    const hostname = Config.staticFilesHost;
    if (!hostname) {
      fail(res, 500, 'polis_err_file_fetcher_serving_to_domain');
      return;
    }
    const url = `http://${hostname}:${port}${path}`;
    logger.info(`fetch file from ${url}`);
    let x = request(url);
    req.pipe(x);
    if (!_.isUndefined(preloadData)) {
      x = x.pipe(replaceStream('"REPLACE_THIS_WITH_PRELOAD_DATA"', JSON.stringify(preloadData)));
    }
    let fbMetaTagsString = '<meta property="og:image" content="https://s3.amazonaws.com/pol.is/polis_logo.png" />\n';
    if (preloadData?.conversation) {
      fbMetaTagsString += `    <meta property="og:title" content="${encode(preloadData.conversation.topic)}" />\n`;
      fbMetaTagsString += `    <meta property="og:description" content="${encode(preloadData.conversation.description)}" />\n`;
    }
    x = x.pipe(replaceStream('<!-- REPLACE_THIS_WITH_FB_META_TAGS -->', fbMetaTagsString));
    res.set(headers);
    x.pipe(res);
    x.on('error', (err) => {
      fail(res, 500, `polis_err_finding_file ${path}`, err);
    });
  };
}

function isUnsupportedBrowser(req) {
  return /MSIE [234567]/.test(req?.headers?.['user-agent'] || '');
}

function browserSupportsPushState(req) {
  return !/MSIE [23456789]/.test(req?.headers?.['user-agent'] || '');
}

const fetchUnsupportedBrowserPage = makeFileFetcher(
  hostname,
  staticFilesParticipationPort,
  '/unsupportedBrowser.html',
  {
    'Content-Type': 'text/html'
  }
);

function fetchIndex(req, res, preloadData, port) {
  const headers = {
    'Content-Type': 'text/html'
  };
  if (!devMode) {
    Object.assign(headers, {
      'Cache-Control': 'no-cache'
    });
  }
  setCookieTestCookie(req, res);
  const indexPath = '/index.html';
  const doFetch = makeFileFetcher(hostname, port, indexPath, headers, preloadData);
  if (isUnsupportedBrowser(req)) {
    return fetchUnsupportedBrowserPage(req, res);
  }
  if (!browserSupportsPushState(req) && req.path.length > 1 && !/^\/api/.exec(req.path)) {
    res.writeHead(302, {
      Location: `https://${req?.headers?.host}/#${req.path}`
    });
    return res.end();
  }
  return doFetch(req, res);
}

function fetchIndexWithoutPreloadData(req, res, port) {
  return fetchIndex(req, res, {}, port);
}

function hasAuthToken(req) {
  return !!req.cookies[COOKIES.TOKEN];
}

const fetchIndexForAdminPage = makeFileFetcher(hostname, staticFilesAdminPort, '/index_admin.html', {
  'Content-Type': 'text/html'
});

const fetchIndexForReportPage = makeFileFetcher(hostname, staticFilesAdminPort, '/index_report.html', {
  'Content-Type': 'text/html'
});

const handle_GET_conditionalIndexFetcher = (() => (req, res) => {
  if (hasAuthToken(req)) {
    return fetchIndexForAdminPage(req, res);
  }
  if (!browserSupportsPushState(req)) {
    return fetchIndexForAdminPage(req, res);
  }
  const url = `${serverUrl}/home`;
  res.redirect(url);
})();

function addStaticFileHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', 0);
}

function proxy(req, res) {
  const hostname = Config.staticFilesHost;
  if (!hostname) {
    const host = req?.headers?.host || '';
    const re = new RegExp(`${Config.getServerHostname()}$`);
    if (host.match(re)) {
      fail(res, 500, 'polis_err_proxy_serving_to_domain', new Error(host));
    } else {
      fail(res, 500, 'polis_err_proxy_serving_to_domain', new Error(host));
    }
    return;
  }
  if (devMode) {
    addStaticFileHeaders(res);
  }
  const port = Config.staticFilesParticipationPort;
  if (req?.headers?.host) req.headers.host = hostname;
  routingProxy.web(req, res, {
    target: {
      host: hostname,
      port: port
    }
  });
}

export {
  fetchIndex,
  fetchIndexForAdminPage,
  fetchIndexForReportPage,
  fetchIndexWithoutPreloadData,
  handle_GET_conditionalIndexFetcher,
  makeFileFetcher,
  proxy
};
