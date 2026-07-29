import { describe, expect, it } from 'vitest';
import { TerminalOutputSanitizer, stripTerminalFormatting } from '../../src/terminalOutput';

describe('terminal output sanitization', () => {
  it('preserves VT sequences required for interactive line editing', () => {
    const sanitizer = new TerminalOutputSanitizer();
    const value = [
      'abcdef',
      '\x1b[2K',
      '\x1b[1G',
      '\x1b[3D',
      '\x1b[2P',
      '\x1b[?25l',
      'abc',
      '\x1b[?25h',
    ].join('');

    expect(sanitizer.push(value)).toBe(value);
  });

  it('removes clipboard, control-string, device-query, and window manipulation sequences', () => {
    const sanitizer = new TerminalOutputSanitizer();
    const value = [
      'before',
      '\x1b]52;c;dGVzdA==\x07',
      '\x1bPignored\x1b\\',
      '\x1b[6n',
      '\x1b[8;40;120t',
      'after',
    ].join('');

    expect(sanitizer.push(value)).toBe('beforeafter');
  });

  it('blocks unsafe control strings split across PTY chunks', () => {
    const sanitizer = new TerminalOutputSanitizer();

    expect(sanitizer.push('safe\x1b]52;c;partial')).toBe('safe');
    expect(sanitizer.push('-payload\x07after')).toBe('after');
  });

  it('strips safe terminal formatting from copied or persisted text', () => {
    const value = '\x1b[?25l\x1b[2K\x1b[1Ghello\x1b[31m red\x1b[0m\x1b[?25h';

    expect(stripTerminalFormatting(value)).toBe('hello red');
  });
});
