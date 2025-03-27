import cookies from '../utils/cookies.js';

const { COOKIES, setCookie } = cookies;

function handle_GET_tryCookie(req, res) {
  if (!req.cookies[COOKIES.TRY_COOKIE]) {
    setCookie(req, res, COOKIES.TRY_COOKIE, 'ok', {
      httpOnly: false
    });
  }
  res.status(200).json({});
}

function fetchThirdPartyCookieTestPt1(_req, res) {
  res.set({ 'Content-Type': 'text/html' });
  res.send(
    Buffer.from(
      '<body>\n' +
        '<script>\n' +
        '  document.cookie="thirdparty=yes; Max-Age=3600; SameSite=None; Secure";\n' +
        '  document.location="thirdPartyCookieTestPt2.html";\n' +
        '</script>\n' +
        '</body>'
    )
  );
}

function fetchThirdPartyCookieTestPt2(_req, res) {
  res.set({ 'Content-Type': 'text/html' });
  res.send(
    Buffer.from(
      '<body>\n' +
        '<script>\n' +
        '  if (window.parent) {\n' +
        '   if (/thirdparty=yes/.test(document.cookie)) {\n' +
        "     window.parent.postMessage('MM:3PCsupported', '*');\n" +
        '   } else {\n' +
        "     window.parent.postMessage('MM:3PCunsupported', '*');\n" +
        '   }\n' +
        "   document.cookie = 'thirdparty=; expires=Thu, 01 Jan 1970 00:00:01 GMT;';\n" +
        '  }\n' +
        '</script>\n' +
        '</body>'
    )
  );
}

export default {
  fetchThirdPartyCookieTestPt1,
  fetchThirdPartyCookieTestPt2,
  handle_GET_tryCookie
};
