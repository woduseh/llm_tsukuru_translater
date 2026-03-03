import { describe, it, expect, afterEach } from 'vitest';
import { Encrypt, Decrypt, EncryptedExtensions, DecryptedExtensions } from '../../src/ts/libs/rpgencrypt';
import os from 'os';
import path from 'path';
import fs from 'fs';

describe('rpgencrypt', () => {
  const HEADER_MV = '5250474D5600000000030100000000000';
  const HEADER_BYTES = Buffer.from(
    ['52', '50', '47', '4D', '56', '00', '00', '00', '00', '03', '01', '00', '00', '00', '00', '00'].join(''),
    'hex'
  );
  const TEST_KEY = 'abcdef01';

  let tmpDirs: string[] = [];

  function makeTmpDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  // ─── Extension mappings ───────────────────────────────────────────

  describe('extension mappings', () => {
    it('has matching encrypted and decrypted extension arrays', () => {
      expect(EncryptedExtensions.length).toBe(DecryptedExtensions.length);
    });

    it('maps .png to .rpgmvp', () => {
      const idx = DecryptedExtensions.indexOf('.png');
      expect(EncryptedExtensions[idx]).toBe('.rpgmvp');
    });

    it('maps .ogg to .rpgmvo', () => {
      const idx = DecryptedExtensions.indexOf('.ogg');
      expect(EncryptedExtensions[idx]).toBe('.rpgmvo');
    });
  });

  // ─── Encrypt → Decrypt roundtrip ─────────────────────────────────

  describe('Encrypt → Decrypt roundtrip', () => {
    it('recovers original PNG data after encrypt then decrypt', async () => {
      const srcDir = makeTmpDir('crypto-src-');
      const encDir = makeTmpDir('crypto-enc-');
      const decDir = makeTmpDir('crypto-dec-');

      // Create a fake PNG file (just random bytes with .png extension)
      const originalData = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, // some data bytes
        0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
      ]);
      const srcFile = path.join(srcDir, 'test.png');
      fs.writeFileSync(srcFile, originalData);

      // Encrypt
      await Encrypt(srcFile, encDir, TEST_KEY);
      const encFile = path.join(encDir, 'test.rpgmvp');
      expect(fs.existsSync(encFile)).toBe(true);

      // Encrypted file should start with RPG Maker MV header
      const encData = fs.readFileSync(encFile);
      expect(encData.length).toBe(originalData.length + 16); // 16-byte header added
      expect(encData.subarray(0, 16).equals(HEADER_BYTES)).toBe(true);

      // Decrypt
      await Decrypt(encFile, decDir, TEST_KEY);
      const decFile = path.join(decDir, 'test.png');
      expect(fs.existsSync(decFile)).toBe(true);

      const recoveredData = fs.readFileSync(decFile);
      expect(recoveredData.equals(originalData)).toBe(true);
    });

    it('recovers original OGG data after encrypt then decrypt', async () => {
      const srcDir = makeTmpDir('crypto-ogg-src-');
      const encDir = makeTmpDir('crypto-ogg-enc-');
      const decDir = makeTmpDir('crypto-ogg-dec-');

      const originalData = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) originalData[i] = i;
      fs.writeFileSync(path.join(srcDir, 'sound.ogg'), originalData);

      await Encrypt(path.join(srcDir, 'sound.ogg'), encDir, TEST_KEY);
      const encFile = path.join(encDir, 'sound.rpgmvo');
      expect(fs.existsSync(encFile)).toBe(true);

      await Decrypt(encFile, decDir, TEST_KEY);
      const recovered = fs.readFileSync(path.join(decDir, 'sound.ogg'));
      expect(recovered.equals(originalData)).toBe(true);
    });
  });

  // ─── Encryption format ───────────────────────────────────────────

  describe('encryption format', () => {
    it('prepends 16-byte RPG Maker MV header', async () => {
      const srcDir = makeTmpDir('crypto-hdr-src-');
      const encDir = makeTmpDir('crypto-hdr-enc-');

      const data = Buffer.alloc(20, 0xFF);
      fs.writeFileSync(path.join(srcDir, 'img.png'), data);

      await Encrypt(path.join(srcDir, 'img.png'), encDir, TEST_KEY);
      const enc = fs.readFileSync(path.join(encDir, 'img.rpgmvp'));

      expect(enc.subarray(0, 4).toString('hex')).toBe('5250474d'); // "RPGM"
      expect(enc.length).toBe(20 + 16);
    });

    it('XORs first key-length bytes of the file data', async () => {
      const srcDir = makeTmpDir('crypto-xor-src-');
      const encDir = makeTmpDir('crypto-xor-enc-');

      const data = Buffer.alloc(16, 0x00);
      fs.writeFileSync(path.join(srcDir, 'x.png'), data);

      // Key "abcdef01" → 4 key bytes: 0xab, 0xcd, 0xef, 0x01
      await Encrypt(path.join(srcDir, 'x.png'), encDir, TEST_KEY);
      const enc = fs.readFileSync(path.join(encDir, 'x.rpgmvp'));
      const body = enc.subarray(16); // skip header

      // First 4 bytes should be XOR of 0x00 with key bytes
      expect(body[0]).toBe(0xAB);
      expect(body[1]).toBe(0xCD);
      expect(body[2]).toBe(0xEF);
      expect(body[3]).toBe(0x01);
      // Remaining bytes should be unchanged
      expect(body[4]).toBe(0x00);
    });
  });

  // ─── Skips unsupported extensions ─────────────────────────────────

  describe('unsupported extensions', () => {
    it('Encrypt skips files with non-RPG extensions', async () => {
      const srcDir = makeTmpDir('crypto-skip-src-');
      const outDir = makeTmpDir('crypto-skip-out-');

      fs.writeFileSync(path.join(srcDir, 'data.json'), '{}');
      await Encrypt(path.join(srcDir, 'data.json'), outDir, TEST_KEY);

      const files = fs.readdirSync(outDir);
      expect(files).toHaveLength(0);
    });

    it('Decrypt skips files with non-encrypted extensions', async () => {
      const srcDir = makeTmpDir('crypto-dskip-src-');
      const outDir = makeTmpDir('crypto-dskip-out-');

      fs.writeFileSync(path.join(srcDir, 'plain.png'), Buffer.alloc(32));
      await Decrypt(path.join(srcDir, 'plain.png'), outDir, TEST_KEY);

      const files = fs.readdirSync(outDir);
      expect(files).toHaveLength(0);
    });
  });

  // ─── Error cases ──────────────────────────────────────────────────

  describe('error cases', () => {
    it('Encrypt throws for non-existent file', async () => {
      const outDir = makeTmpDir('crypto-err-');
      await expect(Encrypt('/nonexistent/file.png', outDir, TEST_KEY)).rejects.toThrow();
    });

    it('Decrypt throws for non-existent file', async () => {
      const outDir = makeTmpDir('crypto-derr-');
      await expect(Decrypt('/nonexistent/file.rpgmvp', outDir, TEST_KEY)).rejects.toThrow();
    });
  });
});
