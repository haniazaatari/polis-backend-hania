export default {
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js', '!**/__tests__/setup/**/*'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['app.js', 'src/**/*.js', '!src/**/*.test.js', '!**/node_modules/**'],
  coverageReporters: ['lcov', 'clover'],
  verbose: false
  // setupFilesAfterEnv: ['./__tests__/setup.js'], // Uncomment if needed
};
