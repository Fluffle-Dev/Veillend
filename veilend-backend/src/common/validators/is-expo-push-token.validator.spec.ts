import { validate } from 'class-validator';
import { IsExpoPushToken } from './is-expo-push-token.validator';

class TestDto {
  @IsExpoPushToken()
  token: string;
}

async function errorsFor(token: unknown): Promise<string[]> {
  const dto = new TestDto();
  dto.token = token as string;
  const errors = await validate(dto);
  if (errors.length === 0) return [];
  return Object.values(errors[0].constraints ?? {});
}

describe('IsExpoPushToken', () => {
  it('accepts a valid Expo push token', async () => {
    expect(
      await errorsFor('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'),
    ).toEqual([]);
  });

  it('accepts a token id containing hyphens and underscores', async () => {
    expect(await errorsFor('ExponentPushToken[abc-DEF_123]')).toEqual([]);
  });

  it('rejects an empty string', async () => {
    expect(await errorsFor('')).toEqual([
      'Must be a valid Expo push token (ExponentPushToken[...])',
    ]);
  });

  it('rejects a token missing the brackets', async () => {
    expect(await errorsFor('ExponentPushTokenxxxxxxxxxxxxxxxxxxxxxx')).toEqual([
      'Must be a valid Expo push token (ExponentPushToken[...])',
    ]);
  });

  it('rejects an empty bracket body', async () => {
    expect(await errorsFor('ExponentPushToken[]')).toEqual([
      'Must be a valid Expo push token (ExponentPushToken[...])',
    ]);
  });

  it('rejects non-alphanumeric characters inside the brackets', async () => {
    expect(await errorsFor('ExponentPushToken[abc!def]')).toEqual([
      'Must be a valid Expo push token (ExponentPushToken[...])',
    ]);
  });

  it('rejects a different token prefix', async () => {
    expect(await errorsFor('SomeOtherToken[abcdef]')).toEqual([
      'Must be a valid Expo push token (ExponentPushToken[...])',
    ]);
  });

  it('rejects non-string values', async () => {
    expect(await errorsFor(12345)).toEqual([
      'Must be a valid Expo push token (ExponentPushToken[...])',
    ]);
  });
});
