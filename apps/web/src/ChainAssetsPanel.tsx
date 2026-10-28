import { useEffect, useRef, useState } from 'react';
import { formatUnits, Interface } from 'ethers';
import type { ChainHistory, ChainToken, ChainTransactionPlan, WalletNetwork } from '@p2p/contracts';
import { walletRequest, walletWrite } from './wallet-v2-client';
import { ethereumProvider } from './external-wallet-client';
import { submitChainTransaction } from './chain-wallet-client';
import { testTokenBytecode } from './test-token-artifact';

export function ChainAssetsPanel({
  bindingId,
  network,
  userId,
  address,
}: {
  bindingId: string;
  network: WalletNetwork;
  userId: string;
  address: string;
}) {
  const base = `v2/wallet/bindings/${bindingId}/chain`,
    key = `chain-wallet:${userId}:${bindingId}`;
  const [tokens, setTokens] = useState<ChainToken[]>([]),
    [history, setHistory] = useState<ChainHistory | null>(null);
  const [contract, setContract] = useState(''),
    [selected, setSelected] = useState(''),
    [recipient, setRecipient] = useState(''),
    [quantity, setQuantity] = useState('');
  const [pending, setPending] = useState(() => localStorage.getItem(key) ?? ''),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const running = useRef(false),
    lifetime = useRef<AbortController | null>(null);
  async function load(signal: AbortSignal) {
    const [assets, activity] = await Promise.allSettled([
      walletRequest<{ tokens: ChainToken[] }>(`${base}/tokens`, { signal }, 120000),
      walletRequest<ChainHistory>(`${base}/history`, { signal }, 20000),
    ]);
    if (signal.aborted) return;
    if (activity.status === 'fulfilled') setHistory(activity.value);
    if (assets.status === 'fulfilled') {
      const assetResult = assets.value;
      setTokens(assetResult.tokens);
      setSelected((old) =>
        assetResult.tokens.some((token) => token.address === old)
          ? old
          : (assetResult.tokens[0]?.address ?? ''),
      );
    } else {
      setTokens([]);
      setError(
        assets.reason instanceof Error
          ? assets.reason.message
          : 'Token balances unavailable. Stored history remains available.',
      );
    }
    if (activity.status === 'rejected') throw activity.reason;
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void load(controller.signal).catch((e: unknown) => {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Chain data unavailable.');
    });
    return () => controller.abort();
  }, [bindingId]);
  async function work(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if (!lifetime.current?.signal.aborted)
        setError(e instanceof Error ? e.message : 'Chain operation failed.');
    } finally {
      running.current = false;
      if (!lifetime.current?.signal.aborted) setBusy(false);
    }
  }
  const write = <T,>(route: string, body: unknown) =>
    walletWrite<T>(userId, `${base}/${route}`, body, {
      signal: lifetime.current!.signal,
      timeout: 120000,
    });
  async function record(hash: string) {
    await write('transactions', { hash });
    setNotice('Transaction recorded. Refresh chain history to check its receipt.');
  }
  async function submit(plan: ChainTransactionPlan) {
    if (pending)
      throw new Error('Check the previous wallet request before submitting another transaction.');
    const hash = await submitChainTransaction(
      ethereumProvider(),
      plan,
      lifetime.current!.signal,
      () => {
        localStorage.setItem(key, 'unknown');
        setPending('unknown');
      },
    );
    localStorage.setItem(key, hash);
    setPending(hash);
    await record(hash);
  }
  const chainId = `0x${BigInt(network.chainId).toString(16)}`;
  const token = tokens.find((row) => row.address === selected);
  return (
    <section aria-label="On-chain assets and history" className="admin-form">
      <h3>ERC-20 test tokens</h3>
      <p>
        Import an existing testnet contract or deploy OFFGRID Test Token. Deployment and transfers
        require test ETH for gas. Token names and symbols are supplied by the contract.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void work(async () => {
            await write('tokens', { address: contract });
            await load(lifetime.current!.signal);
            setNotice('Token imported from the verified network.');
          });
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Token contract address
            <input
              value={contract}
              required
              maxLength={42}
              onChange={(e) => setContract(e.target.value)}
            />
          </label>
          <button>Import ERC-20 token</button>
        </fieldset>
      </form>
      <button
        disabled={busy || !!pending}
        onClick={() =>
          void work(() => submit({ from: address, value: '0x0', data: testTokenBytecode, chainId }))
        }
      >
        Deploy test faucet token
      </button>
      <p>
        After deployment is mined, use its contract address from chain history to import it. The
        deployer receives 1000 OGT. Anyone can claim 1000 more OGT once per minute using the OFFGRID
        test contract; all units are test-only.
      </p>
      <ul>
        {tokens.map((row) => (
          <li key={row.address}>
            <strong>
              {row.name} ({row.symbol})
            </strong>{' '}
            · {formatUnits(row.balanceUnits, row.decimals)} <code>{row.address}</code>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void work(async () => {
            const result = await write<{ transaction: ChainTransactionPlan }>('prepare', {
              token: selected,
              recipient,
              quantity,
            });
            await submit(result.transaction);
          });
        }}
      >
        <fieldset disabled={busy || !!pending || !token}>
          <legend>Send ERC-20 test tokens</legend>
          <label>
            Token to send
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select token</option>
              {tokens.map((row) => (
                <option value={row.address} key={row.address}>
                  {row.symbol} · {row.address}
                </option>
              ))}
            </select>
          </label>
          <label>
            Token recipient address
            <input
              required
              maxLength={42}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          <label>
            Token amount
            <input
              required
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <button>Review token transfer in wallet</button>
        </fieldset>
      </form>
      <button
        disabled={busy || !!pending || !token}
        onClick={() =>
          void work(() =>
            submit({
              from: address,
              to: selected,
              value: '0x0',
              data: new Interface(['function claim()']).encodeFunctionData('claim'),
              chainId,
            }),
          )
        }
      >
        Claim from selected OFFGRID faucet token
      </button>
      <p>
        Only use Claim with an OFFGRID Test Token you recognize. Your wallet simulates and approves
        the call; other ERC-20 contracts may not implement this function.
      </p>
      {pending && (
        <div role="status">
          <p>
            {pending === 'unknown'
              ? 'Wallet submission outcome is unknown. Check wallet activity before sending again.'
              : `Submitted hash: ${pending}`}
          </p>
          {pending !== 'unknown' && (
            <button disabled={busy} onClick={() => void work(() => record(pending))}>
              Record this hash again
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => {
              localStorage.removeItem(key);
              setPending('');
            }}
          >
            I checked wallet activity; allow a new transaction
          </button>
        </div>
      )}
      <h3>Indexed on-chain history</h3>
      <p>
        History covers imported tokens and direct native transfers from the displayed starting
        block. Internal contract ETH transfers are not included. Mined is provisional; confirmed
        means at least 12 blocks. Refresh checks for reorganizations.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void work(async () => {
            const result = await write<{ indexedThrough: number; more: boolean }>('sync', {});
            await load(lifetime.current!.signal);
            setNotice(
              result.more
                ? 'More blocks remain. Refresh again to continue indexing.'
                : `Indexed through block ${result.indexedThrough}.`,
            );
          })
        }
      >
        Refresh chain history and balances
      </button>
      {history && (
        <>
          {history.lastError && <p role="alert">{history.lastError}</p>}
          <p>
            Last synchronized:{' '}
            {history.lastSyncedAt ? new Date(history.lastSyncedAt).toLocaleString() : 'not yet'}
          </p>
          <p>
            Start block: {history.startBlock ?? 'Not started'} · Indexed through:{' '}
            {history.indexedThrough ?? 'Not started'}
          </p>
          <ul>
            {history.entries.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {entry.kind} · {entry.status}
                </strong>{' '}
                · {formatUnits(entry.amountUnits, entry.decimals)} {entry.symbol}
                <br />
                <code>{entry.hash}</code>
                <p>
                  {entry.from} → {entry.to ?? 'Contract deployment'} · {entry.confirmations}{' '}
                  confirmations
                </p>
                {entry.contractAddress && (
                  <button onClick={() => setContract(entry.contractAddress!)}>
                    Use deployed token address {entry.contractAddress}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {history.nextCursor && (
            <button
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  const page = await walletRequest<ChainHistory>(
                    `${base}/history?cursor=${history.nextCursor}`,
                    { signal: lifetime.current!.signal },
                  );
                  setHistory({ ...page, entries: [...history.entries, ...page.entries] });
                })
              }
            >
              Load older chain activity
            </button>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Checking the chain…</p>}
    </section>
  );
}
