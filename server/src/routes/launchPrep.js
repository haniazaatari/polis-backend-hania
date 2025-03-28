import { makeSessionToken } from '../session.js';
import { hexToStr } from '../utils/common.js';
import { COOKIES, setCookie, setCookieTestCookie, setPermanentCookie } from '../utils/cookies.js';

function handle_GET_launchPrep(req, res) {
  if (!req.cookies[COOKIES.PERMANENT_COOKIE]) {
    setPermanentCookie(req, res, makeSessionToken());
  }
  setCookieTestCookie(req, res);
  setCookie(req, res, 'top', 'ok', {
    httpOnly: false
  });
  const dest = hexToStr(req.p.dest);
  const url = new URL(dest);
  res.redirect(url.pathname + url.search + url.hash);
}

export { handle_GET_launchPrep };
