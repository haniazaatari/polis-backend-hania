import { jest } from '@jest/globals';

describe("Config", () => {
  beforeEach(() => {
    // reset module state so we can re-import with new env vars
    jest.resetModules();
  });

  afterEach(() => {
    // restore replaced properties
    jest.restoreAllMocks();
  });

  describe("getServerNameWithProtocol", () => {
    test('returns https://pol.is by default', async () => {
      jest.replaceProperty(process, 'env', {DEV_MODE: 'false'});

      const { default: Config } = await import('../src/config');
      // No req object needed
      expect(Config.getServerNameWithProtocol()).toBe('https://pol.is');
    });

    test('returns API_DEV_HOSTNAME when DEV_MODE is true', async () => {
      // Set API_DEV_HOSTNAME for the dev case
      jest.replaceProperty(process, 'env', {DEV_MODE: 'true', API_DEV_HOSTNAME: 'test.example.com:5001'});

      const { default: Config } = await import('../src/config');
      // No req object needed
      expect(Config.getServerNameWithProtocol()).toBe('http://test.example.com:5001');
    });

    test('returns API_DEV_HOSTNAME when DEV_MODE is true', async () => {
      jest.replaceProperty(process, 'env', {DEV_MODE: 'true', API_DEV_HOSTNAME: 'mydomain.xyz'});

      const { default: Config } = await import('../src/config');

      expect(Config.getServerNameWithProtocol()).toBe('http://mydomain.xyz');
    });
  });

  describe("whitelistItems", () => {
    test('returns an array of whitelisted items', async () => {
      jest.replaceProperty(process, 'env', {
        DOMAIN_WHITELIST_ITEM_01: 'item1',
        DOMAIN_WHITELIST_ITEM_02: '',
        DOMAIN_WHITELIST_ITEM_03: 'item3',
      });

      const { default: Config } = await import('../src/config');

      expect(Config.whitelistItems).toEqual(['item1', 'item3']);
    });
  });
});
