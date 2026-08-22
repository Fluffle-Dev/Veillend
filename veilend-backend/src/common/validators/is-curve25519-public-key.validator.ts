import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const CURVE25519_KEY_LENGTH_BYTES = 32;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

// Validates a base64-encoded Curve25519 public key (nacl.box key): a
// well-formed base64 string that decodes to exactly 32 bytes.
export function isCurve25519PublicKey(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!BASE64_PATTERN.test(value)) return false;

  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch {
    return false;
  }

  return decoded.length === CURVE25519_KEY_LENGTH_BYTES;
}

export function IsCurve25519PublicKey(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCurve25519PublicKey',
      target: object.constructor,
      propertyName,
      options: {
        message: 'Must be a base64-encoded 32-byte Curve25519 public key',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, _args: ValidationArguments): boolean {
          return isCurve25519PublicKey(value);
        },
      },
    });
  };
}
