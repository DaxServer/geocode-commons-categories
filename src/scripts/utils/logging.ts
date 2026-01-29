/**
 * Logging utilities for consistent output formatting
 */

export function logSection(title: string): void {
  console.log(`\n▶ ${title}`)
  console.log('━'.repeat(60))
}

export function logHeader(title: string): void {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log(`║ ${title.padEnd(58)} ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
}

export function logSummary(label: string, value: string | number): void {
  console.log(`${label.padEnd(25)} ${value}`)
}
