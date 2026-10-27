import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  HistoricalTransfer,
  TransferHistoryPage,
  TransferReceipt,
  TransferChainEvidence,
} from '@p2p/contracts';
import { objectId } from '../accounts/accounts.service.js';
import { TransfersService, transferView } from './transfers.service.js';
import type { TransferRecord } from './transfers.models.js';
import { historyCursor, historyQuery } from './transfer-history-query.js';

export function historicalTransfer(record: TransferRecord): HistoricalTransfer {
  return {
    ...transferView(record),
    payloadVersion: record.payloadVersion,
    mode: 'SIMULATED',
    ...(record.senderWalletId ? { senderWalletId: record.senderWalletId.toHexString() } : {}),
    ...(record.recipientWalletId
      ? { recipientWalletId: record.recipientWalletId.toHexString() }
      : {}),
  };
}

@Injectable()
export class TransferHistoryService {
  constructor(@Inject(TransfersService) readonly transfers: TransfersService) {}

  async list(caller: string, input: unknown): Promise<TransferHistoryPage> {
    const { filter, limit, digest } = historyQuery(caller, input);
    const records = await this.transfers.transfers
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .maxTimeMS(5000)
      .toArray();
    return {
      transfers: records.slice(0, limit).map(historicalTransfer),
      nextCursor: records.length > limit ? historyCursor(digest, records[limit - 1]!) : null,
    };
  }

  private async committed(caller: string, id: string) {
    // Use the established detail authorization, including recipient terminal-only visibility.
    const { transfer } = await this.transfers.detailV2(caller, id);
    if (transfer.status !== 'COMMITTED')
      throw new NotFoundException('Committed transfer unavailable.');
    return transfer;
  }

  async receipt(caller: string, id: string): Promise<TransferReceipt> {
    const transfer = await this.committed(caller, id);
    const record = await this.transfers.transfers.findOne({
      _id: objectId(id),
      status: 'COMMITTED',
    });
    if (!record?.committedAt) throw new NotFoundException('Receipt unavailable.');
    return {
      transfer,
      committedAt: record.committedAt.toISOString(),
      identitySource: 'ADMISSION_SNAPSHOT',
      notice:
        'Demo units have no monetary value. Public participant and asset labels were captured at admission. This is an application receipt.',
    };
  }

  async evidence(caller: string, id: string): Promise<TransferChainEvidence> {
    const transfer = await this.committed(caller, id);
    const entry = await this.transfers.chain.entries.findOne({ transferId: objectId(id) });
    if (!entry) throw new NotFoundException('Transfer evidence unavailable.');
    return {
      transferId: id,
      assetId: transfer.asset.id,
      sequence: entry.sequence.toString(),
      entryHash: entry.entryHash,
      previousHash: entry.previousHash,
      canonicalVersion: entry.canonicalVersion,
      committedAt: entry.createdAt.toISOString(),
      notice:
        'Application audit-chain evidence. The predecessor hash does not grant access to another transfer. Full integrity verification requires retained checkpoints.',
    };
  }
}
