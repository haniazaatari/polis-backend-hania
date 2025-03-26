import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  setupFiles: ["<rootDir>/test/settings/env-setup.ts"],
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      isolatedModules: true,
      diagnostics: {
        warnOnly: true
      }
    }]
  },
  forceExit: true,
  detectOpenHandles: false
};

export default config;
