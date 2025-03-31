import Config from '../config.js';
import { queryP, queryP_readOnly } from '../db/pg-query.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';

const devMode = Config.isDevMode;

const whitelistedCrossDomainRoutes = [/^\/api\/v[0-9]+\/launchPrep/, /^\/api\/v[0-9]+\/setFirstCookie/];

const whitelistedDomains = [
  Config.getServerHostname(),
  ...Config.whitelistItems,
  'localhost:5000',
  'localhost:5001',
  'localhost:5010',
  ''
];

function hasWhitelistMatches(host) {
  if (devMode) {
    return true;
  }
  let hostWithoutProtocol = host;
  if (host.startsWith('http://')) {
    hostWithoutProtocol = host.slice(7);
  } else if (host.startsWith('https://')) {
    hostWithoutProtocol = host.slice(8);
  }
  for (let i = 0; i < whitelistedDomains.length; i++) {
    const w = whitelistedDomains[i];
    if (hostWithoutProtocol.endsWith(w || '')) {
      if (hostWithoutProtocol === w) {
        return true;
      }
      if (hostWithoutProtocol[hostWithoutProtocol.length - ((w || '').length + 1)] === '.') {
        return true;
      }
    }
  }
  return false;
}

function addCorsHeader(req, res, next) {
  const origin = req.get('Origin') || req.get('Referer') || '';
  const sanitizedOrigin = origin.replace(/#.*$/, '').match(/^[^/]*\/\/[^/]*/)?.[0] || '';
  const routeIsWhitelistedForAnyDomain = whitelistedCrossDomainRoutes.some((regex) => regex.test(req.path));
  if (!hasWhitelistMatches(sanitizedOrigin) && !routeIsWhitelistedForAnyDomain) {
    logger.info('not whitelisted', { headers: req.headers, path: req.path });
    return next(`unauthorized domain: ${sanitizedOrigin}`);
  }
  if (sanitizedOrigin) {
    res.header('Access-Control-Allow-Origin', sanitizedOrigin);
    res.header(
      'Access-Control-Allow-Headers',
      'Cache-Control, Pragma, Origin, Authorization, Content-Type, X-Requested-With'
    );
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  return next();
}

function isParentDomainWhitelisted(domain, zid, isWithinIframe, domain_whitelist_override_key) {
  return queryP_readOnly(
    'select * from site_domain_whitelist where site_id = ' +
      '(select site_id from users where uid = ' +
      '(select owner from conversations where zid = ($1)));',
    [zid]
  ).then((rows) => {
    logger.silly('isParentDomainWhitelisted', {
      domain,
      zid,
      isWithinIframe
    });
    if (!rows || !rows.length || !rows[0].domain_whitelist.length) {
      logger.silly('isParentDomainWhitelisted : no whitelist');
      return true;
    }
    const whitelist = rows[0].domain_whitelist;
    const wdomains = whitelist.split(',');
    if (!isWithinIframe && wdomains.indexOf('*.pol.is') >= 0) {
      logger.silly('isParentDomainWhitelisted : *.pol.is');
      return true;
    }
    if (domain_whitelist_override_key && rows[0].domain_whitelist_override_key === domain_whitelist_override_key) {
      return true;
    }
    let ok = false;
    for (let i = 0; i < wdomains.length; i++) {
      const w = wdomains[i];
      let wParts = w.split('.');
      let parts = domain.split('.');
      if (wParts.length && wParts[0] === '*') {
        let bad = false;
        wParts = wParts.reverse();
        parts = parts.reverse();
        for (let p = 0; p < wParts.length - 1; p++) {
          if (wParts[p] !== parts[p]) {
            bad = true;
            break;
          }
        }
        ok = !bad;
      } else {
        let bad2 = false;
        if (wParts.length !== parts.length) {
          bad2 = true;
        }
        for (let p2 = 0; p2 < wParts.length; p2++) {
          if (wParts[p2] !== parts[p2]) {
            bad2 = true;
            break;
          }
        }
        ok = !bad2;
      }
      if (ok) {
        break;
      }
    }
    logger.debug(`isParentDomainWhitelisted : ${ok}`);
    return ok;
  });
}

function denyIfNotFromWhitelistedDomain(req, res, next) {
  const isWithinIframe = req.headers?.referrer?.includes('parent_url');
  const ref = req?.headers?.referrer;
  let refParts = [];
  let resultRef = '';
  if (isWithinIframe) {
    if (ref) {
      const decodedRefString = decodeURIComponent(ref.replace(/.*parent_url=/, '').replace(/&.*/, ''));
      if (decodedRefString?.length) refParts = decodedRefString.split('/');
      resultRef = (refParts && refParts.length >= 3 && refParts[2]) || '';
    }
  } else {
    if (ref?.length) refParts = ref.split('/');
    if (refParts && refParts.length >= 3) resultRef = refParts[2] || '';
  }
  const zid = req.p.zid;
  isParentDomainWhitelisted(resultRef, zid, isWithinIframe, req.p.domain_whitelist_override_key)
    .then((isOk) => {
      if (isOk) {
        next();
      } else {
        res.send(403, 'polis_err_domain');
        next('polis_err_domain');
      }
    })
    .catch((err) => {
      logger.error('error in isParentDomainWhitelisted', err);
      res.send(403, 'polis_err_domain');
      next('polis_err_domain_misc');
    });
}

function setDomainWhitelist(uid, newWhitelist) {
  return queryP('select * from site_domain_whitelist where site_id = (select site_id from users where uid = ($1));', [
    uid
  ]).then((rows) => {
    if (!rows || !rows.length) {
      return queryP(
        'insert into site_domain_whitelist (site_id, domain_whitelist) values ((select site_id from users where uid = ($1)), $2);',
        [uid, newWhitelist]
      );
    }
    return queryP(
      'update site_domain_whitelist set domain_whitelist = ($2) where site_id = (select site_id from users where uid = ($1));',
      [uid, newWhitelist]
    );
  });
}

function getDomainWhitelist(uid) {
  return queryP('select * from site_domain_whitelist where site_id = (select site_id from users where uid = ($1));', [
    uid
  ]).then((rows) => {
    if (!rows || !rows.length) {
      return '';
    }
    return rows[0].domain_whitelist;
  });
}

function handle_GET_domainWhitelist(req, res) {
  getDomainWhitelist(req.p.uid)
    .then((whitelist) => {
      res.json({
        domain_whitelist: whitelist
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_get_domainWhitelist_misc', err);
    });
}

function handle_POST_domainWhitelist(req, res) {
  setDomainWhitelist(req.p.uid, req.p.domain_whitelist)
    .then(() => {
      res.json({
        domain_whitelist: req.p.domain_whitelist
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_post_domainWhitelist_misc', err);
    });
}

export { addCorsHeader, denyIfNotFromWhitelistedDomain, handle_GET_domainWhitelist, handle_POST_domainWhitelist };
