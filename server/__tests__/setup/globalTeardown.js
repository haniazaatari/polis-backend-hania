/**
 * Global teardown for Jest tests
 * This file is executed once after all test files have been run
 */

export default async () => {
  console.log('Starting global test teardown...');

  // Close the server if it exists
  if (global.__SERVER__) {
    try {
      // Using a promise to ensure server is closed before continuing
      await new Promise((resolve) => {
        global.__SERVER__.close(() => {
          console.log(`Test server on port ${global.__SERVER_PORT__} shut down`);
          resolve();
        });
      });
      global.__SERVER__ = null;
      global.__SERVER_PORT__ = null;
    } catch (err) {
      console.warn('Warning: Error during server cleanup:', err.message);
    }
  }

  // Clean up API URL globals
  global.__API_URL__ = null;
  global.__API_PREFIX__ = null;

  // Note: We're deliberately NOT clearing the agent instances
  // This allows them to be reused across test suites
  // global.__TEST_AGENT__ = null;
  // global.__TEXT_AGENT__ = null;

  console.log('Global test teardown completed');
};
