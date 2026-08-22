import { Injectable, Logger } from '@nestjs/common';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { AppConfigService } from '../config/app-config.service';

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  ephemeralPublicKey: string;
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface SendResult {
  tickets: ExpoPushTicket[];
  staleTokens: string[];
}

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly expo: Expo;

  constructor(private readonly config: AppConfigService) {
    this.expo = new Expo({
      accessToken: this.config.notifications.expoAccessToken,
    });
  }

  /**
   * Sends `message` to every token, chunked to Expo's per-request limit
   * (`Expo.chunkPushNotifications` caps chunks at 100 messages). Tokens
   * that fail with `DeviceNotRegistered` are returned in `staleTokens` so
   * the caller can purge them and stop wasting sends on dead devices.
   */
  async send(tokens: string[], message: PushMessage): Promise<SendResult> {
    const validTokens = tokens.filter((token) => Expo.isExpoPushToken(token));

    const messages: ExpoPushMessage[] = validTokens.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data,
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const chunkTickets = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...chunkTickets);
      } catch (error) {
        this.logger.error(
          `Expo push chunk send failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const staleTokens: string[] = [];
    tickets.forEach((ticket, index) => {
      if (
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
      ) {
        staleTokens.push(validTokens[index]);
      }
    });

    return { tickets, staleTokens };
  }

  /**
   * Encrypts `payload` to `pubKeyBase64` (the recipient's Curve25519 public
   * key) using an ephemeral nacl.box keypair, so the ciphertext can only be
   * opened by the holder of the matching private key (the mobile app's
   * SecureStore) and never needs the server to retain a long-lived secret
   * key of its own.
   */
  encryptForUser(
    pubKeyBase64: string,
    payload: Record<string, unknown>,
  ): EncryptedPayload {
    const theirPublicKey = naclUtil.decodeBase64(pubKeyBase64);
    const ephemeral = nacl.box.keyPair();
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const message = naclUtil.decodeUTF8(JSON.stringify(payload));
    const ciphertext = nacl.box(
      message,
      nonce,
      theirPublicKey,
      ephemeral.secretKey,
    );

    return {
      ciphertext: naclUtil.encodeBase64(ciphertext),
      nonce: naclUtil.encodeBase64(nonce),
      ephemeralPublicKey: naclUtil.encodeBase64(ephemeral.publicKey),
    };
  }
}
