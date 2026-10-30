export const consumerLinks = [
  { hash: '#/home', label: 'Home', section: 'home' },
  { hash: '#/wallet', label: 'Wallet', section: 'wallet' },
  { hash: '#/send', label: 'Send', section: 'send' },
  { hash: '#/activity', label: 'Activity', section: 'activity' },
  { hash: '#/chat', label: 'Chat', section: 'chat' },
  { hash: '#/settings', label: 'Settings', section: 'setup' },
  { hash: '#/assets', label: 'Assets', section: 'assets' },
  { hash: '#/help', label: 'Help', section: 'help' },
  { hash: '#/admin', label: 'Administration', section: 'admin' },
] as const;
export type ConsumerSection =
  (typeof consumerLinks)[number]['section'] | 'security' | 'notifications';
const legacy: Record<string, ConsumerSection> = {
  '#wallet-title': 'wallet',
  '#asset-catalogue-title': 'assets',
  '#wallet-setup-title': 'setup',
  '#administration-title': 'admin',
  '#admin-account-title': 'admin',
  '#transfer-history-title': 'activity',
};
export function consumerSection(hash: string): ConsumerSection {
  if (hash.length > 2048) return 'home';
  if (Object.hasOwn(legacy, hash)) return legacy[hash]!;
  if (hash === '#/settings/security') return 'security';
  if (hash === '#/notifications') return 'notifications';
  if (/^#\/chat\/[a-f0-9]{24}$/.test(hash)) return 'chat';
  if (/^#\/activity(?:\/[a-f0-9]{24}|\?[^#]*)?$/.test(hash)) return 'activity';
  if (
    /^#\/admin\/(assets|networks|policies|requests|demo|access|audit|operations)$/.test(hash) ||
    /^#\/admin\/operations\?job=[a-f0-9]{24}$/.test(hash)
  )
    return 'admin';
  return consumerLinks.find((link) => link.hash === hash)?.section ?? 'home';
}
export function adminDestination(fragment: string) {
  return (
    /^#\/admin\/(assets|networks|policies|requests|demo|access|audit|operations)(?:\?job=[a-f0-9]{24})?$/.exec(
      fragment,
    )?.[1] ?? null
  );
}
