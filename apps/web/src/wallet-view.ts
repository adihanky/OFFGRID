export type WalletView = 'network' | 'legacy';
export interface WalletSelection {
  userId: string;
  view: WalletView;
  legacyOpened: boolean;
}
export function walletSelectionFor(
  selection: WalletSelection | null,
  userId: string,
): WalletSelection {
  return selection?.userId === userId
    ? selection
    : { userId, view: 'network', legacyOpened: false };
}
export function chooseWalletView(
  selection: WalletSelection | null,
  userId: string,
  view: WalletView,
): WalletSelection {
  const current = walletSelectionFor(selection, userId);
  return { userId, view, legacyOpened: current.legacyOpened || view === 'legacy' };
}
