/* eslint-env node, jest */
// Global test setup
process.env['NODE_ENV'] = 'test';

// Define console interface for better type safety
interface MockConsole extends Console {
  log: jest.MockedFunction<typeof console.log>;
  debug: jest.MockedFunction<typeof console.debug>;
  info: jest.MockedFunction<typeof console.info>;
  warn: jest.MockedFunction<typeof console.warn>;
  error: jest.MockedFunction<typeof console.error>;
}

// Suppress console output during tests unless needed
if (process.env['VERBOSE_TESTS'] === undefined) {
  (global.console as MockConsole) = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// Set default test timeout
jest.setTimeout(10000);

// Global test utilities can be added here
// declare global {
//   namespace jest {
//     interface Matchers<R> {
//       // Add custom matchers if needed
//     }
//   }
// }