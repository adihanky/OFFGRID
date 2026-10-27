import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, WalletV2, WorkspaceOverview } from '@p2p/contracts';
import { WalletsService } from '../wallets/wallets.service.js';
import { TransfersService } from '../transfers/transfers.service.js';
import { AdminService } from '../admin/admin.service.js';
import { PolicyReader } from '../configuration/policy-reader.js';
import { objectId } from '../accounts/accounts.service.js';

export function walletReadiness(
  wallet: WalletV2 | null,
  migrationRequired = false,
): WorkspaceOverview['readiness'] {
  if (!wallet)
    return {
      wallet: migrationRequired ? 'MIGRATION_REQUIRED' : 'UNAVAILABLE',
      assets: 'UNAVAILABLE',
      balance: 'UNAVAILABLE',
      recovery: 'UNAVAILABLE',
    };
  const usable = wallet.holdings.filter(
    (h) => h.status === 'AVAILABLE' && h.asset.mode === 'SIMULATED' && h.asset.custodyEnabled,
  );
  return {
    wallet: wallet.status === 'ACTIVE' ? 'READY' : 'SUSPENDED',
    assets: usable.length ? 'AVAILABLE' : 'EMPTY',
    balance: usable.some((h) => /[1-9]/.test(h.balance)) ? 'FUNDED' : 'EMPTY',
    recovery: 'READY',
  };
}
@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(WalletsService) readonly wallets: WalletsService,
    @Inject(TransfersService) readonly transfers: TransfersService,
    @Inject(AdminService) readonly admin: AdminService,
    @Inject(PolicyReader) readonly policies: PolicyReader,
  ) {}
  async overview(user: AuthUser): Promise<WorkspaceOverview> {
    const [wallet, pending, administration, support, policy] = await Promise.allSettled([
      this.wallets.own(user.id),
      this.transfers.transfers.countDocuments(
        { senderId: objectId(user.id), status: 'PENDING' },
        { maxTimeMS: 5000 },
      ),
      this.admin.status(user.id),
      this.policies.support(),
      this.policies.product(),
    ]);
    const own = wallet.status === 'fulfilled' ? wallet.value : null;
    const migration =
      wallet.status === 'rejected' &&
      wallet.reason?.getResponse?.()?.code === 'WALLET_MIGRATION_REQUIRED';
    const readiness = walletReadiness(own, migration);
    const pendingCount = pending.status === 'fulfilled' ? pending.value : null;
    readiness.recovery = pendingCount === null ? 'UNAVAILABLE' : 'READY';
    const settings = support.status === 'fulfilled' ? support.value.values : null;
    const demo = administration.status === 'fulfilled' && administration.value.demoEnabled;
    const canSend =
      readiness.wallet === 'READY' &&
      readiness.assets === 'AVAILABLE' &&
      readiness.balance === 'FUNDED' &&
      pendingCount === 0 &&
      policy.status === 'fulfilled';
    const nextAction = pendingCount
      ? 'ACTIVITY'
      : canSend
        ? 'SEND'
        : readiness.wallet === 'READY' &&
            readiness.assets === 'AVAILABLE' &&
            pendingCount === 0 &&
            policy.status === 'fulfilled'
          ? 'RECEIVE'
          : 'HELP';
    return {
      serverTime: new Date().toISOString(),
      mode: 'SIMULATED',
      roles: administration.status === 'fulfilled' ? administration.value.roles : [],
      readiness,
      pendingCount,
      receive: { publicHandle: user.publicHandle, ...(own ? { walletId: own.id } : {}) },
      helpUrl: settings?.helpUrl ?? '',
      policyRevision: policy.status === 'fulfilled' ? policy.value.revision : 'unavailable',
      nextAction,
      capabilities: {
        send: {
          enabled: canSend,
          action: pendingCount ? 'ACTIVITY' : canSend ? 'SEND' : 'HELP',
          reason: pendingCount
            ? 'Check your admitted transfer in Activity before starting another.'
            : pendingCount === null
              ? 'Transfer recovery is unavailable. Retry before starting a new send.'
              : readiness.wallet !== 'READY'
                ? 'Your wallet needs operator attention.'
                : policy.status !== 'fulfilled'
                  ? 'Transfer settings are unavailable. Open Help or retry the overview.'
                  : readiness.assets !== 'AVAILABLE'
                    ? 'No supported asset is available for sending.'
                    : readiness.balance !== 'FUNDED'
                      ? 'Receive demo units from a peer or request an allocation.'
                      : 'Review a recipient and send demo units.',
        },
        receive: {
          enabled: readiness.wallet === 'READY',
          reason:
            'Share your public handle or application wallet ID. You can receive while signed out.',
          action: 'RECEIVE',
        },
        accessRequest: {
          enabled: !!settings?.accessRequests,
          reason: settings?.accessRequests
            ? 'An access administrator reviews each request.'
            : 'New access requests are currently unavailable.',
          action: 'HELP',
        },
        allocationRequest: {
          enabled: !!settings?.allocationRequests && demo && readiness.assets === 'AVAILABLE',
          reason:
            'Demo units require an asset administrator approval. There is no automatic credit.',
          action: 'HELP',
        },
      },
    };
  }
}
