import {
  realtimePulseSchema,
  isPrivateRealtimePath,
  realtimeNegotiationSchema,
  validRealtimeServerFrames,
  type RealtimeScope,
} from './realtime-contract.ts';
import { boundedRealtimeBody } from './realtime-stream.ts';
import type { HttpRequest } from '@microsoft/signalr';
export type PrivateRealtimeStatus =
  'connecting' | 'connected' | 'reconnecting' | 'offline' | 'stopped';
export type PrivateRealtimeTransport = (path: string, init: RequestInit) => Promise<Response>;
export type PrivateRealtimeConnection = {
  on: (name: string, callback: (raw: unknown) => void) => void;
  onclose: (callback: () => void) => void;
  onreconnecting: (callback: () => void) => void;
  onreconnected: (callback: () => void) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
export type PrivateRealtimeFactory = (
  base: string,
  transport: PrivateRealtimeTransport,
) => Promise<PrivateRealtimeConnection>;
export async function signalRPrivateFactory(
  base: string,
  transport: PrivateRealtimeTransport,
): Promise<PrivateRealtimeConnection> {
  const signalR = await import('@microsoft/signalr');
  const origin = location.origin,
    staff = base === '/api/admin/realtime';
  class ScopedHttpClient extends signalR.HttpClient {
    async send(request: HttpRequest) {
      if (!request.url || !request.method) throw Error('Private realtime request');
      const url = new URL(request.url, origin),
        path = url.pathname + url.search,
        method = request.method.toUpperCase();
      if (
        url.origin !== origin ||
        !isPrivateRealtimePath(path, method, staff) ||
        request.content instanceof ArrayBuffer
      )
        throw Error('Private realtime path');
      const abort = new AbortController(),
        previous = request.abortSignal?.onabort,
        stop = () => {
          previous?.();
          abort.abort();
        };
      if (request.abortSignal) {
        if (request.abortSignal.aborted) abort.abort();
        request.abortSignal.onabort = stop;
      }
      const headers = new Headers(request.headers);
      for (const name of ['Authorization', 'Cookie', 'Origin']) headers.delete(name);
      if (typeof request.content === 'string')
        headers.set('Content-Type', 'text/plain;charset=UTF-8');
      try {
        const response = await transport(path, {
          method,
          headers,
          body: request.content,
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
          cache: 'no-store',
        });
        const raw = await boundedRealtimeBody(response.body, 65536);
        if (response.ok) {
          if (url.pathname.endsWith('/negotiate')) realtimeNegotiationSchema.parse(JSON.parse(raw));
          else if (!validRealtimeServerFrames(raw)) throw Error('Private realtime frames');
        }
        return new signalR.HttpResponse(response.status, response.statusText, raw);
      } finally {
        if (request.abortSignal?.onabort === stop) request.abortSignal.onabort = previous ?? null;
      }
    }
  }
  return new signalR.HubConnectionBuilder()
    .withUrl(origin + base, {
      transport: signalR.HttpTransportType.LongPolling,
      httpClient: new ScopedHttpClient(),
      withCredentials: false,
      skipNegotiation: false,
      logMessageContent: false,
      logger: signalR.LogLevel.None,
      timeout: 15000,
    })
    .configureLogging(signalR.LogLevel.None)
    .withAutomaticReconnect([0, 1000, 3000, 10000])
    .build();
}
export class PrivateRealtimeClient {
  private revision = 0;
  private active = false;
  private connection: PrivateRealtimeConnection | null = null;
  private status: PrivateRealtimeStatus = 'stopped';
  private observers = new Set<() => void>();
  private listeners = new Set<(scope: RealtimeScope) => void>();
  private base: '/api/realtime' | '/api/admin/realtime';
  private transport: PrivateRealtimeTransport;
  private factory: PrivateRealtimeFactory;
  constructor(
    base: '/api/realtime' | '/api/admin/realtime',
    transport: PrivateRealtimeTransport,
    factory: PrivateRealtimeFactory = signalRPrivateFactory,
  ) {
    this.base = base;
    this.transport = transport;
    this.factory = factory;
  }
  snapshot = () => this.status;
  subscribe = (listener: () => void) => {
    this.observers.add(listener);
    return () => {
      this.observers.delete(listener);
    };
  };
  listen = (listener: (scope: RealtimeScope) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(value: PrivateRealtimeStatus) {
    if (this.status === value) return;
    this.status = value;
    for (const observer of this.observers) observer();
  }
  private fresh() {
    for (const scope of ['support', 'notifications'] as const)
      for (const listener of this.listeners) listener(scope);
  }
  async start() {
    const revision = ++this.revision;
    this.active = true;
    const old = this.connection;
    this.connection = null;
    this.set('connecting');
    if (old) await old.stop().catch(() => {});
    let connection: PrivateRealtimeConnection | null = null;
    try {
      connection = await this.factory(this.base, this.transport);
      if (!this.active || revision !== this.revision) {
        await connection.stop().catch(() => {});
        return;
      }
      this.connection = connection;
      const current = () => this.active && revision === this.revision;
      connection.on('Changed', (raw) => {
        if (!current()) return;
        const value = realtimePulseSchema.safeParse(raw);
        if (!value.success) {
          this.revision++;
          this.set('offline');
          void connection!.stop().catch(() => {});
          return;
        }
        for (const listener of this.listeners) listener(value.data.scope);
      });
      connection.onreconnecting(() => {
        if (current()) this.set('reconnecting');
      });
      connection.onreconnected(() => {
        if (current()) {
          this.set('connected');
          this.fresh();
        }
      });
      connection.onclose(() => {
        if (current()) this.set('offline');
      });
      await connection.start();
      if (!current()) {
        await connection.stop().catch(() => {});
        return;
      }
      this.set('connected');
      this.fresh();
    } catch {
      if (this.active && revision === this.revision) this.set('offline');
      if (connection) await connection.stop().catch(() => {});
    }
  }
  retry = () => (this.status === 'offline' ? this.start() : Promise.resolve());
  async stop() {
    this.active = false;
    this.revision++;
    const connection = this.connection;
    this.connection = null;
    this.set('stopped');
    if (connection) await connection.stop().catch(() => {});
  }
}
export function bindRealtimeTransport(
  send: PrivateRealtimeTransport,
  allowed: () => boolean,
): PrivateRealtimeTransport {
  return async (path, init) => {
    if (!allowed()) throw Error('Private view changed.');
    const response = await send(path, init);
    if (!allowed()) {
      await response.body?.cancel();
      throw Error('Private view changed.');
    }
    return response;
  };
}
