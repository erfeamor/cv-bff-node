/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Type-check the whole project (src + test) via the base tsconfig.
  testMatch: ['**/test/**/*.test.ts'],
};
