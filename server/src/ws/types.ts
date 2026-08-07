import type WebSocket from 'ws';
import type { Market } from '../engine/types';

export type VenueSpec = {
  keepalive: {
    mode: 'server' | 'json' | 'text' | 'protocol';
    payload?: string;
    intervalMs: number;
    onlyWhenIdle: boolean;
  };
  chunk: {
    unit: 'chars' | 'bytes' | 'none';
    budget: number;
    scope: 'frame' | 'connection';
  };
  maxConnectionAgeMs?: number;
  firstSubscribeDeadlineMs?: number;
  unknownSymbolIsExpected: boolean;
  sign?(frame: object): object;
};

export type EndpointPlan = {
  url: string;
  markets: Market[];
};

export type VenueConnection = {
  id: string;
  socket: WebSocket;
  endpoint: EndpointPlan;
};

export type NormalizedQuote = {
  rawMarketId: string;
  bid: number;
  ask: number;
  receivedAtMs: number;
};
