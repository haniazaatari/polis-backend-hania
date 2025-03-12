/**
 * Cookie constants
 */
export const COOKIES = {
  COOKIE_TEST: 'ct',
  HAS_EMAIL: 'e',
  TOKEN: 'token2',
  UID: 'uid2',
  REFERRER: 'ref',
  PARENT_REFERRER: 'referrer',
  PARENT_URL: 'parent_url',
  USER_CREATED_TIMESTAMP: 'uc',
  PERMANENT_COOKIE: 'pc',
  TRY_COOKIE: 'tryCookie'
};

/**
 * Cookies that should be cleared during logout
 */
export const COOKIES_TO_CLEAR = {
  [COOKIES.HAS_EMAIL]: true,
  [COOKIES.TOKEN]: true,
  [COOKIES.UID]: true,
  [COOKIES.USER_CREATED_TIMESTAMP]: true,
  [COOKIES.PARENT_REFERRER]: true,
  [COOKIES.PARENT_URL]: true
};
