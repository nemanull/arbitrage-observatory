import type WebSocket from 'ws';
import type { Market } from '../engine/types';

export type EndpointPlan = {
  id: string; // 'bybit#linear#0'
  url: string;
  markets: Market[];
};

export type SingleSocketConnection = {
  id: string; // the plan's id, so the logs read the same across reconnects
  plan: EndpointPlan;
  socket: WebSocket;

  lastMessageAt: number;
  attempt: number;

  reopenOnClose: boolean;

  //timers like ping/ 24h refresh and any repetative stuff that we need to account for
  timers: NodeJS.Timeout[];
};

export type NormalizedQuote = {
  rawMarketId: string;
  bid: number;
  ask: number;
  recvTs: number;
};
