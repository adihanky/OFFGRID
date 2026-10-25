import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createServer } from 'node:http';
import { Wallet, verifyMessage } from 'ethers';
import {
  normalizedEvmAddress,
  ownershipMessage,
} from '../../apps/api/src/modules/wallets/external-wallet.service.js';
import { publicAddress, rpcUrl, rpcTransport } from '../../apps/api/src/modules/networks/rpc.js';
import { testEnvironment } from '../support/auth-fixture.mjs';
import {
  connectExternalWallet,
  type EthereumProvider,
} from '../../apps/web/src/external-wallet-client.js';
import type { WalletChallenge, WalletNetwork } from '@p2p/contracts';
describe('External wallet ownership proof inputs', () => {
  it('[happy/edge] normalizes real addresses while retaining checksum validation', () => {
    const address = Wallet.createRandom().address;
    assert.equal(normalizedEvmAddress(address), address.toLowerCase());
    assert.equal(normalizedEvmAddress(address.toLowerCase()), address.toLowerCase());
    assert.throws(() => normalizedEvmAddress(`0x${'0'.repeat(40)}`));
    assert.throws(() => normalizedEvmAddress('0x1234'));
    assert.throws(() => normalizedEvmAddress('0x8Ba1f109551bD432803012645Ac136ddd64DBA72'));
  });
  it('[happy/negative] signs exact domain, chain, wallet, session and expiry with standard EVM recovery', async () => {
    const signer = Wallet.createRandom();
    const input = {
      origin: 'https://wallet.example',
      address: signer.address,
      chainId: '11155111',
      nonce: 'a'.repeat(48),
      issuedAt: new Date('2026-10-25T00:00:00Z'),
      expiresAt: new Date('2026-10-25T00:05:00Z'),
      id: '1'.repeat(24),
      walletId: '2'.repeat(24),
      sessionHash: '3'.repeat(64),
    };
    const message = ownershipMessage(input);
    const signature = await signer.signMessage(message);
    assert.equal(verifyMessage(message, signature), signer.address);
    assert.match(message, /This does not authorize spending/);
    assert.match(message, /Chain ID: 11155111/);
    for (const change of [
      { origin: 'https://attacker.example' },
      { chainId: '1' },
      { walletId: '4'.repeat(24) },
      { sessionHash: '5'.repeat(64) },
    ])
      assert.notEqual(
        verifyMessage(ownershipMessage({ ...input, ...change }), signature),
        signer.address,
      );
  });
});
describe('RPC egress restrictions', () => {
  const environment = testEnvironment({
    MONGODB_DB: `p2p_transfer_test_${'1'.repeat(32)}`,
    EVM_RPC_ALLOWED_HOSTS: 'ethereum-sepolia-rpc.publicnode.com',
  });
  it('[happy/edge] accepts approved HTTPS and guarded local development RPC', () => {
    assert.equal(
      rpcUrl('https://ethereum-sepolia-rpc.publicnode.com/', environment, false).protocol,
      'https:',
    );
    assert.equal(rpcUrl('http://127.0.0.1:8545/', environment, true).port, '8545');
    assert.equal(publicAddress('8.8.8.8'), true);
    assert.equal(publicAddress('2606:4700::1111'), true);
  });
  it('[negative] refuses credentials, paths, redirects to private space, unapproved hosts and production local RPC', () => {
    for (const value of [
      'https://evil.example/',
      'https://user:secret@ethereum-sepolia-rpc.publicnode.com/',
      'https://ethereum-sepolia-rpc.publicnode.com/key',
      'https://ethereum-sepolia-rpc.publicnode.com/?key=secret',
      'http://169.254.169.254/',
    ])
      assert.throws(() => rpcUrl(value, environment, false));
    assert.throws(() =>
      rpcUrl('http://127.0.0.1:8545/', { ...environment, NODE_ENV: 'production' }, true),
    );
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '172.16.0.1',
      '100.64.0.1',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      '2001:db8::1',
    ])
      assert.equal(publicAddress(address), false, address);
  });
  it('[negative/edge] real HTTP transport refuses redirects and oversized RPC responses', async () => {
    let mode = 'redirect';
    let followed = false;
    const server = createServer((request, response) => {
      if (request.url !== '/') followed = true;
      if (mode === 'redirect') {
        response.writeHead(302, { Location: '/followed' });
        response.end();
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('x'.repeat(70000));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = new URL(`http://127.0.0.1:${address.port}/`);
    try {
      await assert.rejects(() => rpcTransport(url, 'eth_chainId', [], true));
      assert.equal(followed, false);
      mode = 'oversized';
      await assert.rejects(() => rpcTransport(url, 'eth_chainId', [], true));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
describe('Browser external-wallet lifecycle', () => {
  const signer = Wallet.createRandom();
  const network: WalletNetwork = {
    id: '1'.repeat(24),
    displayName: 'Controlled local EVM',
    chainId: '31337',
    genesisHash: `0x${'12'.repeat(32)}`,
    environment: 'LOCAL',
    status: 'ACTIVE',
    revision: '0',
  };
  const challenge: WalletChallenge = {
    id: '2'.repeat(24),
    message: 'Controlled exact ownership message',
    address: signer.address,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    networkId: network.id,
  };
  function provider(changeAccount = false): EthereumProvider {
    return {
      async request({ method }) {
        if (method === 'eth_requestAccounts') return [signer.address];
        if (method === 'eth_accounts')
          return [changeAccount ? Wallet.createRandom().address : signer.address];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'personal_sign') return signer.signMessage(challenge.message);
        throw new Error('Unexpected wallet method');
      },
    };
  }
  it('[happy] verifies one signed challenge without requesting a transaction', async () => {
    let verifies = 0;
    await connectExternalWallet(
      provider(),
      network,
      async (address) => {
        assert.equal(address, signer.address);
        return challenge;
      },
      async (id, signature) => {
        assert.equal(id, challenge.id);
        assert.equal(verifyMessage(challenge.message, signature), signer.address);
        verifies++;
      },
      new AbortController().signal,
    );
    assert.equal(verifies, 1);
  });
  it('[negative/edge] missing providers, refusal, account switch and unmount cannot persist a link', async () => {
    let verifies = 0;
    const verify = async () => {
      verifies++;
    };
    await assert.rejects(
      () =>
        connectExternalWallet(
          undefined,
          network,
          async () => challenge,
          verify,
          new AbortController().signal,
        ),
      /No EVM wallet/,
    );
    await assert.rejects(
      () =>
        connectExternalWallet(
          {
            request: async () => {
              throw { code: 4001 };
            },
          },
          network,
          async () => challenge,
          verify,
          new AbortController().signal,
        ),
      /declined/,
    );
    await assert.rejects(
      () =>
        connectExternalWallet(
          provider(true),
          network,
          async () => challenge,
          verify,
          new AbortController().signal,
        ),
      /changed/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        connectExternalWallet(
          provider(),
          network,
          async () => challenge,
          verify,
          controller.signal,
        ),
      /cancelled/,
    );
    assert.equal(verifies, 0);
  });
});
