import { Global, Inject, Injectable, Module, ServiceUnavailableException } from '@nestjs/common';
import type { ClientSession, Long, ObjectId } from 'mongodb';
import type { ProductPolicies, SupportPolicies, SettingScope } from '@p2p/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { policyDefinitions } from './policy-registry.js';
import { productDefaults, policySchema, supportSchema } from './policy-registry.js';

export async function productPolicy(reader?: PolicyReader) {
  return reader ? reader.product() : { revision: '0', values: productDefaults };
}

export interface PolicyRecord {
  _id: ObjectId;
  scope: SettingScope;
  revision: Long;
  values: ProductPolicies | SupportPolicies;
}
@Injectable()
export class PolicyReader {
  constructor(@Inject(DatabaseService) readonly database: DatabaseService) {}
  get collection() {
    return this.database.db.collection<PolicyRecord>('productSettings', { promoteLongs: false });
  }
  async read(scope: SettingScope, session?: ClientSession) {
    // No process cache: API and recovery callers always see the published revision.
    const row = await this.collection.findOne({ scope }, { session });
    const parsed = (scope === 'PRODUCT' ? policySchema : supportSchema).safeParse(
      row?.values ?? policyDefinitions[scope].defaults,
    );
    if (!parsed.success)
      throw new ServiceUnavailableException(
        'Published settings are invalid. Ask the installation operator to investigate.',
      );
    return { revision: row?.revision.toString() ?? '0', values: parsed.data };
  }
  async product() {
    const row = await this.read('PRODUCT');
    return { revision: row.revision, values: row.values as ProductPolicies };
  }
  async support() {
    const row = await this.read('SUPPORT');
    return { revision: row.revision, values: row.values as SupportPolicies };
  }
}
@Global()
@Module({ providers: [PolicyReader], exports: [PolicyReader] })
export class PolicyModule {}
