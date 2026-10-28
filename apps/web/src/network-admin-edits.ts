export function resumeNetworkEdits(
  network: { id: string; status: 'ACTIVE' | 'PAUSED' },
  editing: { id: string } | null,
  draft: { rpcUrl: string; displayName: string },
) {
  return network.status === 'PAUSED' && editing?.id === network.id
    ? { rpcUrl: draft.rpcUrl, displayName: draft.displayName }
    : {};
}
