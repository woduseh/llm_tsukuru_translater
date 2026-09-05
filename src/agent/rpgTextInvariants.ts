/** Shared text invariants for patch inspection and approval-time validation. */
export function isRpgSeparatorLine(line: string): boolean {
  return /^---\s*[^-]+?\s*---$/.test(line);
}

export function extractRpgControlCodes(line: string): string[] {
  return line.match(/\\{1,2}[A-Za-z]+(?:\[[^\]\r\n]{0,24}\])?|\\[{}$|.!<>^]/g) ?? [];
}
