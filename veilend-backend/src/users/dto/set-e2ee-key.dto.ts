import { IsCurve25519PublicKey } from '../../common/validators/is-curve25519-public-key.validator';

export class SetE2eeKeyDto {
  @IsCurve25519PublicKey()
  publicKey: string;
}
