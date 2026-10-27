/** Validate the explicit development fixture target before opening any connection. */
export function assertDemoTarget(environment: {
  NODE_ENV: string;
  MONGODB_URI: string;
  MONGODB_DB: string;
}): void {
  if (!['development', 'test'].includes(environment.NODE_ENV)) {
    throw new Error('Demo fixtures require development or test mode.');
  }
  let target: URL;
  try {
    target = new URL(environment.MONGODB_URI);
  } catch {
    throw new Error('Demo fixtures require the local MongoDB instance.');
  }
  const generatedTestDatabase = /^p2p_transfer_test_[a-f0-9]{32}$/.test(environment.MONGODB_DB);
  const isolatedTestPort =
    environment.NODE_ENV === 'test' && generatedTestDatabase && target.port === '27018';
  if (
    target.protocol !== 'mongodb:' ||
    !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    (!['', '27017'].includes(target.port) && !isolatedTestPort) ||
    target.username ||
    target.password ||
    !['', '/', `/${environment.MONGODB_DB}`].includes(target.pathname) ||
    target.hash ||
    new Set(target.searchParams.keys()).size !== [...target.searchParams.keys()].length ||
    [...target.searchParams.keys()].some(
      (key) => !['replicaSet', 'directConnection'].includes(key),
    ) ||
    (target.searchParams.has('replicaSet') && target.searchParams.get('replicaSet') !== 'rs0') ||
    (target.searchParams.has('directConnection') &&
      target.searchParams.get('directConnection') !== 'true')
  ) {
    throw new Error('Demo fixtures require the local MongoDB instance.');
  }
  if (
    !['p2p_offgrid', 'p2p_offgrid_demo'].includes(environment.MONGODB_DB) &&
    !generatedTestDatabase
  ) {
    throw new Error('Database is not allowlisted for demo fixtures.');
  }
}

export function validateDemoPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new Error('Set DEMO_PASSWORD to a local demo password of 12–128 characters.');
  }
  return value;
}
