import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { Environment } from '../../config/environment.js';
import { assertDemoTarget } from '../accounts/demo-target.js';

export const RPC_TRANSPORT = Symbol('RPC_TRANSPORT');
export type RpcMethod = 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode';
export type RpcTransport = (
  url: URL,
  method: RpcMethod,
  params: unknown[],
  local: boolean,
) => Promise<unknown>;
export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Only ordinary global unicast IPv6; exclude mapped IPv4, link-local and documentation ranges.
  if (isIP(address) !== 6) return false;
  try {
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    return /^[23][0-9a-f]{3}:/i.test(normalized) && !/^2001:(?:db8:|0:|:)|^2002:/i.test(normalized);
  } catch {
    return false;
  }
}
export function rpcUrl(value: string, environment: Environment, local: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Invalid RPC URL.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new BadRequestException('Use a public RPC root URL without credentials, query or path.');
  if (local) {
    try {
      assertDemoTarget(environment);
    } catch {
      throw new BadRequestException('Local RPC is available only on guarded development targets.');
    }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new BadRequestException('Local RPC must use loopback HTTP.');
  } else {
    const allowed = environment.EVM_RPC_ALLOWED_HOSTS.split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (
      url.protocol !== 'https:' ||
      (url.port && url.port !== '443') ||
      !allowed.includes(url.hostname)
    )
      throw new BadRequestException('RPC host is not approved by this installation.');
  }
  return url;
}
/** Pins the validated DNS result, limits responses, and never follows redirects. */
export const rpcTransport: RpcTransport = async (url, method, params, local) => {
  const deadline = AbortSignal.timeout(5000);
  let addresses;
  try {
    addresses = local
      ? [{ address: '127.0.0.1', family: 4 }]
      : await Promise.race([
          lookup(url.hostname, { all: true }),
          new Promise<never>((_resolve, reject) =>
            deadline.addEventListener('abort', () => reject(new Error('RPC lookup timeout')), {
              once: true,
            }),
          ),
        ]);
  } catch {
    throw new ServiceUnavailableException('Network provider DNS is unavailable.');
  }
  if (!addresses.length || (!local && addresses.some((entry) => !publicAddress(entry.address))))
    throw new BadRequestException('RPC resolved to an unavailable address.');
  const target = addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
  const id = randomUUID();
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        {
          hostname: target.address,
          family: target.family,
          servername: url.hostname,
          port: url.port || (local ? 80 : 443),
          path: '/',
          method: 'POST',
          agent: false,
          signal: deadline,
          headers: {
            Host: url.host,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (response) => {
          const buffers: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 65536) response.destroy(new Error('RPC response limit'));
            else buffers.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            try {
              if (response.statusCode !== 200) throw new Error('RPC HTTP failure');
              const value: unknown = JSON.parse(Buffer.concat(buffers).toString('utf8'));
              if (
                !value ||
                typeof value !== 'object' ||
                !('id' in value) ||
                value.id !== id ||
                !('result' in value) ||
                'error' in value
              )
                throw new Error('Invalid RPC response');
              resolve(value.result);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on('error', reject);
      request.end(body);
    });
  } catch {
    throw new ServiceUnavailableException('Network provider is unavailable. No wallet was linked.');
  }
};
