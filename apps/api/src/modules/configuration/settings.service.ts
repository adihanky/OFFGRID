import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  PreconditionFailedException,
  type OnModuleInit,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import type { SettingsView, SettingsRevision, SettingScope } from '@p2p/contracts';
import { AdminService } from '../admin/admin.service.js';
import { collectionSchema, long, oid, text, date } from '../accounts/schema.js';
import { objectId } from '../accounts/accounts.service.js';
import { toLong } from '../accounts/quantity.js';
import { parseInput } from '../assets/asset-input.js';
import { PolicyReader } from './policy-reader.js';
import {
  policyDefinitions,
  publicationInput,
  scopeSchema,
  settingsInput,
} from './policy-registry.js';

const identities = {
  PRODUCT: new ObjectId('000000000000000000000101'),
  SUPPORT: new ObjectId('000000000000000000000102'),
};
@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    @Inject(PolicyReader) readonly reader: PolicyReader,
    @Inject(AdminService) readonly admin: AdminService,
  ) {}
  async onModuleInit() {
    const db = this.reader.database.db;
    await collectionSchema(
      db,
      'productSettings',
      { scope: { enum: ['PRODUCT', 'SUPPORT'] }, revision: long, values: { bsonType: 'object' } },
      undefined,
      { additionalProperties: false },
    );
    await this.reader.collection.createIndex({ scope: 1 }, { unique: true });
    await collectionSchema(db, 'policyCommands', {
      actorId: oid,
      commandId: text,
      digest: text,
      scope: text,
      result: { bsonType: 'object' },
      createdAt: date,
    });
    await db
      .collection('policyCommands')
      .createIndex({ actorId: 1, commandId: 1 }, { unique: true });
    // Values are additive defaults, never inferred changes to balances or identities.
    for (const scope of ['PRODUCT', 'SUPPORT'] as const)
      await this.reader.collection.updateOne(
        { scope },
        {
          $setOnInsert: {
            _id: identities[scope],
            scope,
            revision: toLong(0n),
            values: policyDefinitions[scope].defaults,
          },
        },
        { upsert: true },
      );
  }
  async list(actor: string): Promise<{ settings: SettingsView[] }> {
    const { roles } = await this.admin.status(actor);
    const settings: SettingsView[] = [];
    for (const scope of ['PRODUCT', 'SUPPORT'] as const) {
      const definition = policyDefinitions[scope];
      if (!roles.includes(definition.ownerRole) && !roles.includes('AUDITOR')) continue;
      const row = await this.reader.read(scope);
      settings.push({
        scope,
        ...row,
        etag: JSON.stringify(row.revision),
        ...definition,
        applied: 'AUTHORITATIVE_READS',
      });
    }
    return { settings };
  }
  async validate(actor: string, input: unknown) {
    const parsed = parseInput(settingsInput, input);
    return this.admin.transaction(
      actor,
      policyDefinitions[parsed.scope].ownerRole,
      async (session) => {
        const current = await this.reader.read(parsed.scope, session);
        return {
          scope: parsed.scope,
          revision: current.revision,
          values: parsed.values,
          changes: Object.entries(parsed.values)
            .filter(([key, value]) => current.values[key as keyof typeof current.values] !== value)
            .map(([key, value]) => ({
              key,
              before: (current.values as unknown as Record<string, unknown>)[key],
              after: value,
            })),
          impact:
            parsed.scope === 'PRODUCT'
              ? 'Unsubmitted reviews require another review. Admitted outcomes and replay identities remain intact.'
              : 'Applies to new support requests. Existing requests remain trackable.',
        };
      },
    );
  }
  async publish(actor: string, expected: unknown, input: unknown) {
    if (typeof expected !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(expected))
      throw new BadRequestException('If-Match must contain the current decimal revision.');
    const parsed = parseInput(publicationInput, input);
    const digest = createHash('sha256')
      .update(JSON.stringify([parsed.scope, parsed.values, parsed.reason, expected]))
      .digest('hex');
    return this.admin.transaction(
      actor,
      policyDefinitions[parsed.scope].ownerRole,
      async (session) => {
        const db = this.reader.database.db;
        const key = { actorId: objectId(actor), commandId: parsed.commandId };
        const prior = await db.collection('policyCommands').findOne(key, { session });
        if (prior) {
          if (prior['digest'] !== digest)
            throw new ConflictException('Command ID belongs to another publication.');
          return prior['result'] as { scope: SettingScope; revision: string };
        }
        const current = await this.reader.collection.findOne({ scope: parsed.scope }, { session });
        if (!current || current.revision.toString() !== expected)
          throw new PreconditionFailedException(
            'Settings changed. Compare the latest values before publishing.',
          );
        const next = toLong(BigInt(expected) + 1n);
        const written = await this.reader.collection.updateOne(
          { _id: current._id, revision: current.revision },
          { $set: { values: parsed.values, revision: next } },
          { session },
        );
        if (written.modifiedCount !== 1)
          throw new PreconditionFailedException(
            'Settings changed. Compare the latest values before publishing.',
          );
        await db.collection('configurationRevisions').insertOne(
          {
            entityId: current._id,
            revision: next,
            value: { scope: parsed.scope, values: parsed.values },
            actorId: objectId(actor),
            reason: parsed.reason,
            createdAt: new Date(),
          },
          { session },
        );
        await this.admin.audit(
          actor,
          `SETTINGS_${parsed.scope}`,
          current._id,
          parsed.reason,
          session,
        );
        const result = { scope: parsed.scope, revision: next.toString() };
        await db.collection('policyCommands').insertOne(
          {
            _id: new ObjectId(),
            ...key,
            digest,
            scope: parsed.scope,
            result,
            createdAt: new Date(),
          },
          { session },
        );
        return result;
      },
    );
  }
  async revisions(actor: string, scopeValue: unknown, cursorValue?: unknown) {
    const scope = parseInput(scopeSchema, scopeValue);
    const roles = (await this.admin.status(actor)).roles;
    const owner = policyDefinitions[scope].ownerRole;
    return this.admin.transaction(
      actor,
      roles.includes(owner) ? owner : 'AUDITOR',
      async (session) => {
        const cursor = cursorValue === undefined ? undefined : objectId(cursorValue);
        const rows = await this.reader.database.db
          .collection('configurationRevisions', { promoteLongs: false })
          .find(
            { entityId: identities[scope], ...(cursor ? { _id: { $lt: cursor } } : {}) },
            { session },
          )
          .sort({ _id: -1 })
          .limit(21)
          .toArray();
        const revisions: SettingsRevision[] = rows.slice(0, 20).map((row) => ({
          id: row._id.toHexString(),
          scope,
          revision: row['revision'].toString(),
          values: row['value'].values,
          reason: row['reason'],
          createdAt: row['createdAt'].toISOString(),
        }));
        return { revisions, nextCursor: rows.length > 20 ? rows[19]!._id.toHexString() : null };
      },
    );
  }
}
