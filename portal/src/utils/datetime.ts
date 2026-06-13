// Compact "Jun 12, 2:30 PM" timestamp for commit lists etc. Falls back to the
// raw string if it isn't a parseable date.
export function shortDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
