export function fixtureMongoUri(port = process.env.P2P_TEST_MONGODB_PORT ?? '27017') {
  if (port !== '27017' && port !== '27018')
    throw new Error('P2P_TEST_MONGODB_PORT must be 27017 or 27018 on loopback.');
  return `mongodb://127.0.0.1:${port}/?replicaSet=rs0&directConnection=true`;
}
