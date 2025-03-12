import cookies from '../utils/cookies.js';
const COOKIES = cookies.COOKIES;
function handle_GET_tryCookie(req, res) {
  if (!req.cookies[COOKIES.TRY_COOKIE]) {
    cookies.setCookie(req, res, COOKIES.TRY_COOKIE, 'ok', {
      httpOnly: false
    });
  }
  res.status(200).json({});
}
export default handle_GET_tryCookie;
