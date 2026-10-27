import { z } from 'zod';
import type { ProductPolicies, SupportPolicies, SettingScope, SettingsView } from '@p2p/contracts';

export const productDefaults: ProductPolicies = {
  lookupPerMinute: 120,
  readsPerMinute: 240,
  admissionsPerMinute: 60,
  reviewSeconds: 120,
};
export const supportDefaults: SupportPolicies = {
  helpUrl: '',
  accessRequests: true,
  allocationRequests: true,
};
export const scopeSchema = z.enum(['PRODUCT', 'SUPPORT']);
export const settingsEtag = z
  .string()
  .regex(/^"(0|[1-9][0-9]{0,17})"$/)
  .transform((value) => value.slice(1, -1));
export const policySchema = z.strictObject({
  lookupPerMinute: z.number().int().min(10).max(600),
  readsPerMinute: z.number().int().min(60).max(1200),
  admissionsPerMinute: z.number().int().min(1).max(120),
  reviewSeconds: z.number().int().min(30).max(600),
});
export const supportSchema = z.strictObject({
  helpUrl: z
    .string()
    .max(300)
    .refine((value) => {
      if (value === '') return true;
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
      } catch {
        return false;
      }
    }, 'Use an HTTPS help URL without credentials or a fragment, or leave empty.'),
  accessRequests: z.boolean(),
  allocationRequests: z.boolean(),
});
export const settingsInput = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('PRODUCT'), values: policySchema }),
  z.strictObject({ scope: z.literal('SUPPORT'), values: supportSchema }),
]);
export const publicationInput = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('PRODUCT'),
    values: policySchema,
    reason: z.string().trim().min(3).max(200),
    commandId: z.uuid(),
  }),
  z.strictObject({
    scope: z.literal('SUPPORT'),
    values: supportSchema,
    reason: z.string().trim().min(3).max(200),
    commandId: z.uuid(),
  }),
]);
export const policyDefinitions: Record<
  SettingScope,
  Pick<SettingsView, 'defaults' | 'ownerRole' | 'fields'>
> = {
  PRODUCT: {
    defaults: productDefaults,
    ownerRole: 'ASSET_ADMIN',
    fields: [
      {
        key: 'lookupPerMinute',
        label: 'Recipient lookups',
        type: 'integer',
        minimum: 10,
        maximum: 600,
        unit: 'per minute',
        impact: 'Applies to the next recipient lookup.',
      },
      {
        key: 'readsPerMinute',
        label: 'Wallet and activity reads',
        type: 'integer',
        minimum: 60,
        maximum: 1200,
        unit: 'per minute',
        impact: 'Applies to the next wallet or activity request.',
      },
      {
        key: 'admissionsPerMinute',
        label: 'New transfer submissions',
        type: 'integer',
        minimum: 1,
        maximum: 120,
        unit: 'per minute',
        impact: 'Applies to new submissions; checking admitted transfers stays available.',
      },
      {
        key: 'reviewSeconds',
        label: 'Recipient review lifetime',
        type: 'integer',
        minimum: 30,
        maximum: 600,
        unit: 'seconds',
        impact:
          'New reviews use this lifetime. Publishing product policy requires unsubmitted reviews to be checked again. Admitted transfers and terminal replays are unchanged.',
      },
    ],
  },
  SUPPORT: {
    defaults: supportDefaults,
    ownerRole: 'ACCESS_ADMIN',
    fields: [
      {
        key: 'helpUrl',
        label: 'Organization help page',
        type: 'url',
        impact: 'HTTPS destination shown in Help. Empty uses in-app guidance.',
      },
      {
        key: 'accessRequests',
        label: 'Access requests',
        type: 'boolean',
        impact: 'Allows new access requests. Existing requests remain trackable.',
      },
      {
        key: 'allocationRequests',
        label: 'Demo allocation requests',
        type: 'boolean',
        impact:
          'Allows new requests on guarded demo installations. Approval always requires an asset administrator.',
      },
    ],
  },
};
