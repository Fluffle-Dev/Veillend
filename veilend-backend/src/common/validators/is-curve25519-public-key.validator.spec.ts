import { validate } from 'class-validator';
import nacl from 'tweetnacl';
import { IsCurve25519PublicKey } from './is-curve25519-public-key.validator';

class TestDto {
  @IsCurve25519PublicKey()
  publicKey: string;
}

async function errorsFor(publicKey: unknown): Promise<string[]> {
  const dto = new TestDto();
  dto.publicKey = publicKey as string;
  const errors = await validate(dto);
  if (errors.length === 0) return [];
  return Object.values(errors[0].constraints ?? {});
}

describe('IsCurve25519PublicKey', () => {
  const validKey = Buffer.from(nacl.box.keyPair().publicKey).toString('base64');

  it('accepts a valid 32-byte base64 public key', async () => {
    expect(await errorsFor(validKey)).toEqual([]);
  });

  it('rejects an empty string', async () => {
    expect(await errorsFor('')).toEqual([
      'Must be a base64-encoded 32-byte Curve25519 public key',
    ]);
  });

  it('rejects a key that decodes to fewer than 32 bytes', async () => {
    const short = Buffer.from(nacl.randomBytes(16)).toString('base64');
    expect(await errorsFor(short)).toEqual([
      'Must be a base64-encoded 32-byte Curve25519 public key',
    ]);
  });

  it('rejects a key that decodes to more than 32 bytes', async () => {
    const long = Buffer.from(nacl.randomBytes(64)).toString('base64');
    expect(await errorsFor(long)).toEqual([
      'Must be a base64-encoded 32-byte Curve25519 public key',
    ]);
  });

  it('rejects non-base64 characters', async () => {
    expect(await errorsFor('not-valid-base64!!! chars$$$')).toEqual([
      'Must be a base64-encoded 32-byte Curve25519 public key',
    ]);
  });

  it('rejects non-string values', async () => {
    expect(await errorsFor(12345)).toEqual([
      'Must be a base64-encoded 32-byte Curve25519 public key',
    ]);
  });
});
