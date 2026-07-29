const ESC = '\x1b';
const BEL = '\x07';
const MAX_PENDING_SEQUENCE_CHARS = 8192;

// Cursor movement, line editing, SGR, and mode toggles are required for
// interactive shells such as PowerShell/PSReadLine to redraw their prompt.
// Device queries and window manipulation are deliberately excluded.
const SAFE_CSI_FINALS = new Set('@ABCDEFGHIJKLMPSUXZabdefghlmqrsu'.split(''));
const SAFE_ESC_FINALS = new Set(['7', '8', 'D', 'E', 'H', 'M', '=', '>', 'c']);
const CONTROL_STRING_INTRODUCERS = new Set([']', 'P', '_', '^', 'X']);

export class TerminalOutputSanitizer {
  private pending = '';

  push(chunk: string): string {
    const value = `${this.pending}${chunk}`;
    this.pending = '';
    let output = '';
    let index = 0;

    while (index < value.length) {
      const char = value[index];
      const code = value.charCodeAt(index);

      if (char === ESC) {
        if (index + 1 >= value.length) {
          this.keepPending(value.slice(index));
          break;
        }

        const next = value[index + 1];
        if (next === '[') {
          const parsed = readCsi(value, index);
          if (!parsed.complete) {
            this.keepPending(value.slice(index));
            break;
          }
          if (parsed.safe) output += value.slice(index, parsed.end);
          index = parsed.end;
          continue;
        }

        if (CONTROL_STRING_INTRODUCERS.has(next)) {
          const end = findControlStringEnd(value, index + 2);
          if (end === -1) {
            this.keepPending(value.slice(index));
            break;
          }
          index = end;
          continue;
        }

        if (SAFE_ESC_FINALS.has(next)) output += `${ESC}${next}`;
        index += 2;
        continue;
      }

      // Drop C1 controls and C0 controls other than terminal text layout and
      // editing characters. ESC is handled above.
      if ((code >= 0x80 && code <= 0x9f) || (code < 0x20 && !isAllowedC0(code)) || code === 0x7f) {
        index += 1;
        continue;
      }

      output += char;
      index += 1;
    }

    return output;
  }

  private keepPending(value: string): void {
    this.pending = value.length <= MAX_PENDING_SEQUENCE_CHARS ? value : '';
  }
}

export function stripTerminalFormatting(value: string): string {
  return value
    .replace(/\x1b(?:\]|P|_|\^|X)[\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    .replace(/\x1b[78DEHM=>c]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}

function readCsi(value: string, start: number): { complete: boolean; safe: boolean; end: number } {
  for (let index = start + 2; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      const parametersValid = value
        .slice(start + 2, index)
        .split('')
        .every((char) => {
          const parameterCode = char.charCodeAt(0);
          return parameterCode >= 0x20 && parameterCode <= 0x3f;
        });
      return {
        complete: true,
        safe: parametersValid && SAFE_CSI_FINALS.has(value[index]),
        end: index + 1,
      };
    }
    if (code < 0x20 || code > 0x3f) {
      return { complete: true, safe: false, end: index + 1 };
    }
  }
  return { complete: false, safe: false, end: value.length };
}

function findControlStringEnd(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === BEL) return index + 1;
    if (value[index] === ESC && value[index + 1] === '\\') return index + 2;
  }
  return -1;
}

function isAllowedC0(code: number): boolean {
  return code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0d;
}
