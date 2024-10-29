import Utils from '../utils/common';
import cookies from '../utils/cookies';
import Session from '../session';
const COOKIES = cookies.COOKIES;

const setPermanentCookie = cookies.setPermanentCookie;
const setCookieTestCookie = cookies.setCookieTestCookie;
const makeSessionToken = Session.makeSessionToken;

function handle_GET_launchPrep(req, res) {
  if (!req.cookies[COOKIES.PERMANENT_COOKIE]) {
    setPermanentCookie(req, res, makeSessionToken());
  }
  setCookieTestCookie(req, res);
  cookies.setCookie(req, res, 'top', 'ok', {
    httpOnly: false
  });

  const dest = Utils.hexToStr(req.p.dest);
  const url = new URL(dest);
  res.redirect(url.pathname + url.search + url.hash);
}

export default handle_GET_launchPrep;
