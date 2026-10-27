export interface ProductPolicies {
  lookupPerMinute: number;
  readsPerMinute: number;
  admissionsPerMinute: number;
  reviewSeconds: number;
}
export interface SupportPolicies {
  helpUrl: string;
  accessRequests: boolean;
  allocationRequests: boolean;
}
export type SettingScope = 'PRODUCT' | 'SUPPORT';
export interface SettingsView {
  scope: SettingScope;
  revision: string;
  etag: string;
  values: ProductPolicies | SupportPolicies;
  defaults: ProductPolicies | SupportPolicies;
  ownerRole: 'ASSET_ADMIN' | 'ACCESS_ADMIN';
  applied: 'AUTHORITATIVE_READS';
  fields: Array<{
    key: string;
    label: string;
    type: 'integer' | 'boolean' | 'url';
    minimum?: number;
    maximum?: number;
    unit?: string;
    impact: string;
  }>;
}
export interface SettingsRevision {
  id: string;
  scope: SettingScope;
  revision: string;
  values: ProductPolicies | SupportPolicies;
  reason: string;
  createdAt: string;
}
