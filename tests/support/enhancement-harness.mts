import { createTransferHarness } from './transfer-harness.mjs';
import { AdminService } from '../../apps/api/src/modules/admin/admin.service.js';
export async function createEnhancementHarness() {
  const token = 'controlled-enhancement-setup-token-2026';
  const h = await createTransferHarness({ ADMIN_SETUP_TOKEN: token });
  try {
    const admin = await h.register('enhance_admin');
    const alice = await h.register('enhance_alice');
    const bob = await h.register('enhance_bob');
    await h.app.get(AdminService).setup(admin.id, { token });
    const asset = await h.accounts.createAsset({
      code: 'ENH',
      displayName: 'Enhancement demo',
      precision: 2,
    });
    await h.issue(alice, asset._id.toHexString(), 10000n);
    return {
      h,
      admin,
      alice,
      bob,
      asset,
      service: h.app.get(AdminService),
      close: () => h.close(),
    };
  } catch (error) {
    await h.close();
    throw error;
  }
}
export type EnhancementHarness = Awaited<ReturnType<typeof createEnhancementHarness>>;
