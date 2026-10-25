export const workspaceLinks = [
  { hash: '#wallet-title', label: 'Wallet & send', section: 'wallet' },
  { hash: '#asset-catalogue-title', label: 'Assets', section: 'assets' },
  { hash: '#wallet-setup-title', label: 'Set up wallet', section: 'setup' },
  { hash: '#administration-title', label: 'Administration', section: 'admin' },
] as const;

export type WorkspaceSection = (typeof workspaceLinks)[number]['section'];

// Keep existing in-app links and bookmarks working. Unknown fragments never
// select arbitrary content or bypass the panels' existing API authorization.
export function workspaceSection(hash: string): WorkspaceSection {
  if (hash === '#admin-account-title') return 'admin';
  return workspaceLinks.find((link) => link.hash === hash)?.section ?? 'wallet';
}
