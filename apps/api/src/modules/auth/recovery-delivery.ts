import { Injectable } from '@nestjs/common';
export interface RecoveryMessage {
  to: string;
  kind: 'RESET' | 'VERIFY';
  token: string;
  origin: string;
}
export abstract class RecoveryDelivery {
  abstract readonly enabled: boolean;
  abstract send(message: RecoveryMessage): Promise<void>;
}
// The user explicitly chose disabled live delivery. Tests override this boundary
// with a controlled in-memory inbox; no public endpoint exposes recovery tokens.
@Injectable()
export class DisabledRecoveryDelivery extends RecoveryDelivery {
  readonly enabled = false;
  async send(): Promise<void> {
    throw new Error('Recovery delivery is disabled.');
  }
}
