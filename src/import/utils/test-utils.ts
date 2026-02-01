/**
 * Shared test utilities for API client tests
 */

type MockedConsole = {
  log: typeof console.log
  warn: typeof console.warn
}

let originalConsole: MockedConsole | null = null

/**
 * Mock console methods to suppress test output
 * Call this in a beforeAll hook
 */
export function mockConsole(): void {
  originalConsole = { log: console.log, warn: console.warn }
  console.log = () => {}
  console.warn = () => {}
}

/**
 * Restore console methods
 * Call this in an afterAll hook if needed
 */
export function restoreConsole(): void {
  if (originalConsole) {
    console.log = originalConsole.log
    console.warn = originalConsole.warn
    originalConsole = null
  }
}

/**
 * Helper to get the request body from a mocked fetch call
 */
export function getMockedFetchBody(callIndex = 0): string | undefined {
  type MockCall = [string, { body?: string }]
  const fetchMock = globalThis.fetch as { mock?: { calls: MockCall[] } }
  return fetchMock?.mock?.calls?.[callIndex]?.[1]?.body
}
