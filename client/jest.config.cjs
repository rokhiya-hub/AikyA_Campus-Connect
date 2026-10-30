module.exports = {
  testEnvironment: "jest-environment-jsdom",
  testMatch: ["<rootDir>/component-tests/**/*.test.jsx"],
  setupFilesAfterEnv: ["<rootDir>/component-tests/setup.cjs"],
  moduleNameMapper: { "\\.css$": "<rootDir>/component-tests/styleStub.cjs" },
  transform: { "^.+\\.[jt]sx?$": ["babel-jest", { presets: [["@babel/preset-env", { targets: { node: "current" } }], ["@babel/preset-react", { runtime: "automatic" }]] }] },
  clearMocks: true,
};
