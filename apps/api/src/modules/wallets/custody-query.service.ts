import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ActivityPage, CustodyActivity } from '@p2p/contracts';
import { WalletsService } from './wallets.service.js';
import { objectId } from '../accounts/accounts.service.js';
import { formatQuantity, units } from '../accounts/quantity.js';

@Injectable()
export class CustodyQueryService {
  constructor(@Inject(WalletsService) readonly wallets: WalletsService) {}
  async page(caller: string, query: unknown, eventId?: string): Promise<ActivityPage> {
    if (
      !query ||
      typeof query !== 'object' ||
      Array.isArray(query) ||
      Object.keys(query).some((key) => key !== 'cursor')
    )
      throw new BadRequestException('Invalid query.');
    const cursor = 'cursor' in query ? objectId(query.cursor) : undefined;
    await this.wallets.accounts.throttle(caller, 'v2-read', 240);
    const wallet = await this.wallets.wallets.findOne({ userId: objectId(caller) });
    if (!wallet) throw new NotFoundException('Wallet unavailable.');
    const custody = this.wallets.accounts.custody;
    const rows = await custody.events
      .find({
        walletIds: wallet._id,
        ...(eventId ? { _id: objectId(eventId) } : cursor ? { _id: { $lt: cursor } } : {}),
      })
      .sort({ _id: -1 })
      .limit(eventId ? 1 : 21)
      .toArray();
    if (eventId && !rows.length) throw new NotFoundException('Activity unavailable.');
    const events: CustodyActivity[] = [];
    for (const row of rows.slice(0, 20)) {
      const asset = await this.wallets.accounts.assets.findOne({ _id: row.assetId });
      if (!asset) throw new NotFoundException('Activity asset unavailable.');
      const lots = await custody.lots
        .find({ $or: [{ createdEventId: row._id }, { spentEventId: row._id }] })
        .sort({ _id: 1 })
        .toArray();
      const allocations = await custody.edges.find({ eventId: row._id }).sort({ _id: 1 }).toArray();
      const reference = await this.wallets.database.db
        .collection(row.kind === 'ISSUE' ? 'demoIssuances' : 'transfers', { promoteLongs: false })
        .findOne({ _id: row.referenceId });
      if (!reference) throw new NotFoundException('Activity reference unavailable.');
      events.push({
        id: row._id.toHexString(),
        kind: row.kind,
        asset: { id: asset._id.toHexString(), code: asset.code, precision: asset.precision },
        quantity: formatQuantity(units(reference['quantityUnits']), asset.precision),
        direction:
          row.kind === 'ISSUE'
            ? 'ISSUED'
            : row.walletIds[0]!.equals(wallet._id)
              ? 'SENT'
              : 'RECEIVED',
        referenceId: row.referenceId.toHexString(),
        createdAt: row.createdAt.toISOString(),
        sequence: row.sequence.toString(),
        hash: row.hash,
        previousHash: row.previousHash,
        provenance: row.provenance ?? 'OBSERVED',
        inputs: lots
          .filter((lot) => lot.spentEventId?.equals(row._id))
          .map((lot) => ({
            id: lot._id.toHexString(),
            quantity: formatQuantity(units(lot.quantityUnits), asset.precision),
          })),
        outputs: lots
          .filter((lot) => lot.createdEventId.equals(row._id))
          .map((lot) => ({
            id: lot._id.toHexString(),
            quantity: formatQuantity(units(lot.quantityUnits), asset.precision),
            owner: lot.walletId.equals(wallet._id) ? 'YOU' : 'COUNTERPARTY',
            status: lot.status,
          })),
        allocations: allocations.map((edge) => ({
          inputId: edge.inputLotId.toHexString(),
          outputId: edge.outputLotId.toHexString(),
          quantity: formatQuantity(units(edge.quantityUnits), asset.precision),
        })),
      });
    }
    return { events, nextCursor: rows.length > 20 ? rows[19]!._id.toHexString() : null };
  }
}
