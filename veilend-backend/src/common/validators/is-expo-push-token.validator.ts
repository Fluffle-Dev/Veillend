import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const EXPO_PUSH_TOKEN_PATTERN = /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/;

export function isExpoPushToken(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return EXPO_PUSH_TOKEN_PATTERN.test(value);
}

// Validates an Expo push token: "ExponentPushToken[...]" wrapping a
// non-empty alphanumeric (plus -/_) id. Rejects empty strings and any
// value missing the brackets so a malformed token never reaches the DB.
export function IsExpoPushToken(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isExpoPushToken',
      target: object.constructor,
      propertyName,
      options: {
        message: 'Must be a valid Expo push token (ExponentPushToken[...])',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, _args: ValidationArguments): boolean {
          return isExpoPushToken(value);
        },
      },
    });
  };
}
