import type WebSocket from 'ws';
import type { Market } from '../../engine/types';

export type EndpointPlan = {
  id: string; // 'bybit#linear#0'
  url: string;
  markets: Market[];
};

export type SingleSocketConnection = {
  id: string; // the plan's id
  plan: EndpointPlan;
  socket: WebSocket;

  // plan.markets when it opens
  accepted: Set<string>;

  lastMessageAt: number;
  attempt: number;

  reopenOnClose: boolean;

  timers: NodeJS.Timeout[];
};
