module.exports = {
  preset: "jest-puppeteer",
  testMatch: ["<rootDir>/tests/e2e/**/*.test.cjs"],
  testTimeout: 90000,
  setupFilesAfterEnv: ["<rootDir>/tests/e2e/setup.cjs"],
};
