// One level of an OKX book, which is a positional array rather than an object.
// The third element is a deprecated field that OKX keeps at '0' on every derivative.
export type OkxBookLevel = [
  price: string,
  size: string,
  deprecated: string,
  orderCount: string,
];

// The bbo-tbt payload, which is complete top-of-book state on every message.
export type OkxBboData = {
  asks: OkxBookLevel[];
  bids: OkxBookLevel[];
  ts: string; // venue send time in milliseconds, as a decimal string
  seqId: number;
};

// One decoded frame off the public socket.
// Data, subscribe acknowledgements, errors, and notices all share the socket, so nothing here is guaranteed to be present.
export type OkxStreamFrame = {
  arg?: { channel: string; instId: string };
  data?: OkxBboData[];
  event?: string; // 'subscribe', 'error', or 'notice'
  code?: string;
  msg?: string;
  connId?: string;
  id?: string; // echoed back from the request that caused this frame
};
