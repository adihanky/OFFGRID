export interface LivenessResponse {
  status: 'ok';
  service: 'p2p-api';
}

export interface ReadinessResponse {
  status: 'ready' | 'unavailable';
  checks: {
    mongodb: 'up' | 'down';
    replicaSet: 'ready' | 'unavailable';
  };
}
