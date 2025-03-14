export default {
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js', '!**/__tests__/(debug|setup)/**/*'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['app.js', 'src/**/*.js', '!src/**/*.test.js', '!**/node_modules/**'],
  coverageReporters: ['lcov', 'clover'],
  // detectOpenHandles: true,
  forceExit: true,
  verbose: true,
  setupFilesAfterEnv: ['./__tests__/setup/jest.setup.js'],
  reporters: ['default', './__tests__/setup/custom-jest-reporter.js']
};
