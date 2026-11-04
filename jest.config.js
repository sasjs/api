module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // sources import './x.js' so the ESM build is valid node ESM; the test run
  // compiles them to CommonJS, where the extension has to come off again
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  roots: ['<rootDir>/spec'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'json-summary', 'lcov'],
  // The package is small and every branch is a decision a consumer depends on
  // (a status code, a path rule), so the floor is high rather than a formality.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90
    }
  }
}
