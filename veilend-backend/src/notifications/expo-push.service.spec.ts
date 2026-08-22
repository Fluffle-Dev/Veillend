import { Test, TestingModule } from '@nestjs/testing';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { ExpoPushService } from './expo-push.service';
import { AppConfigService } from '../config/app-config.service';

describe('ExpoPushService', () => {
  let service: ExpoPushService;
  let sendSpy: jest.SpyInstance<Promise<ExpoPushTicket[]>, [ExpoPushMessage[]]>;

  const mockAppConfigService = {
    notifications: { expoAccessToken: undefined },
  };

  beforeEach(async () => {
    sendSpy = jest.spyOn(Expo.prototype, 'sendPushNotificationsAsync');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpoPushService,
        { provide: AppConfigService, useValue: mockAppConfigService },
      ],
    }).compile();

    service = module.get<ExpoPushService>(ExpoPushService);
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  it('filters out malformed tokens before sending', async () => {
    sendSpy.mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);

    const result = await service.send(
      ['not-a-real-token', 'ExponentPushToken[abc]'],
      { title: 'Hi', body: 'There' },
    );

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [sentMessages] = sendSpy.mock.calls[0];
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].to).toBe('ExponentPushToken[abc]');
    expect(result.tickets).toHaveLength(1);
  });

  it('identifies DeviceNotRegistered tickets as stale tokens', async () => {
    sendSpy.mockResolvedValue([
      {
        status: 'error',
        message: 'gone',
        details: { error: 'DeviceNotRegistered' },
      },
    ]);

    const result = await service.send(['ExponentPushToken[dead]'], {
      title: 'Hi',
      body: 'There',
    });

    expect(result.staleTokens).toEqual(['ExponentPushToken[dead]']);
  });

  it('does not flag a non-DeviceNotRegistered error as stale', async () => {
    sendSpy.mockResolvedValue([
      {
        status: 'error',
        message: 'rate limited',
        details: { error: 'MessageRateExceeded' },
      },
    ]);

    const result = await service.send(['ExponentPushToken[abc]'], {
      title: 'Hi',
      body: 'There',
    });

    expect(result.staleTokens).toEqual([]);
  });

  it('encrypts a payload that only the holder of the matching private key can decrypt', () => {
    const recipient = nacl.box.keyPair();
    const plaintext = {
      title: 'Liquidation risk alert',
      body: 'HF=0.97, shortfall $34',
    };

    const encrypted = service.encryptForUser(
      naclUtil.encodeBase64(recipient.publicKey),
      plaintext,
    );

    // Sanity: the wire payload never contains the plaintext.
    expect(JSON.stringify(encrypted)).not.toMatch(/0\.97/);
    expect(JSON.stringify(encrypted)).not.toMatch(/HF=/);

    // Round-trip via the mobile-side decrypt primitive (nacl.box.open).
    const opened = nacl.box.open(
      naclUtil.decodeBase64(encrypted.ciphertext),
      naclUtil.decodeBase64(encrypted.nonce),
      naclUtil.decodeBase64(encrypted.ephemeralPublicKey),
      recipient.secretKey,
    );
    expect(opened).not.toBeNull();
    expect(JSON.parse(naclUtil.encodeUTF8(opened as Uint8Array))).toEqual(
      plaintext,
    );
  });
});
