import {
  RecoveryDelivery,
  type RecoveryMessage,
} from '../../apps/api/src/modules/auth/recovery-delivery.js';
export class ControlledRecoveryDelivery extends RecoveryDelivery {
  readonly enabled = true;
  messages: RecoveryMessage[] = [];
  failing = false;
  async send(message: RecoveryMessage) {
    if (this.failing) throw new Error('Controlled delivery outage');
    this.messages.push(message);
  }
}
