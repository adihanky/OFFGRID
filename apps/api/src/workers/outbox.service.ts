import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { ObjectId, type ClientSession } from 'mongodb';
import { DatabaseService } from '../database/database.service.js';
import { collectionSchema, oid, text, date } from '../modules/accounts/schema.js';
import type { TransferRecord } from '../modules/transfers/transfers.models.js';
@Injectable()
export class OutboxService implements OnModuleInit {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async onModuleInit() {
    await collectionSchema(this.database.db, 'outboxEvents', {
      eventId: text,
      eventType: { enum: ['transfer.updated'] },
      aggregateId: oid,
      schemaVersion: { enum: [1] },
      payload: {
        bsonType: 'object',
        required: ['transferId', 'senderId', 'recipientId', 'status', 'at'],
        properties: {
          transferId: text,
          senderId: text,
          recipientId: text,
          status: { enum: ['COMMITTED'] },
          at: text,
        },
      },
      nextAttemptAt: date,
      attempts: { bsonType: 'int', minimum: 0 },
      deliveredAt: { bsonType: ['date', 'null'] },
    });
    await this.database.db
      .collection('outboxEvents')
      .createIndex({ eventId: 1 }, { unique: true, name: 'outbox_event' });
    await this.database.db
      .collection('outboxEvents')
      .createIndex({ deliveredAt: 1, nextAttemptAt: 1 }, { name: 'outbox_delivery' });
  }
  async committed(transfer: TransferRecord, at: Date, session: ClientSession) {
    await this.database.db.collection('outboxEvents').insertOne(
      {
        _id: new ObjectId(),
        eventId: `transfer:${transfer._id}:committed`,
        eventType: 'transfer.updated',
        aggregateId: transfer._id,
        schemaVersion: 1,
        payload: {
          transferId: transfer._id.toHexString(),
          senderId: transfer.senderId.toHexString(),
          recipientId: transfer.recipientId.toHexString(),
          status: 'COMMITTED',
          at: at.toISOString(),
        },
        nextAttemptAt: at,
        attempts: 0,
        deliveredAt: null,
      },
      { session },
    );
  }
}
@Module({ providers: [OutboxService], exports: [OutboxService] })
export class OutboxModule {}
