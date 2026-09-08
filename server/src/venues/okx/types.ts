// One level of an OKX book, which is a positional array rather than an object.
export type OkxBookLevel = [
  price: string,
  size: string,
  deprecated: string,
  orderCount: string,
];

export type OkxBooksData = {
  asks: OkxBookLevel[];
  bids: OkxBookLevel[];
  ts: string; // venue send time in milliseconds, as a decimal string
  checksum: number; // retired 2026-06-23, always 0
  prevSeqId: number; // -1 on a snapshot, otherwise the seqId of the message this one follows
  seqId: number;
};

// One decoded frame off the public socket.
// Data, subscribe acknowledgements, errors, and notices all share the socket, so nothing here is guaranteed to be present.
export type OkxStreamFrame = {
  arg?: { channel: string; instId: string };
  action?: string; // 'snapshot' or 'update' on a books frame
  data?: OkxBooksData[];
  event?: string; // 'subscribe', 'error', or 'notice'
  code?: string;
  msg?: string;
  connId?: string;
  id?: string; // echoed back from the request that caused this frame
};
