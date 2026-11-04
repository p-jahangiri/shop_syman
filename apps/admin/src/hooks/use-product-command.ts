import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/api';
import {
  beginProductCommand,
  finishProductCommand,
  interruptProductCommand,
  productCommandAttempt,
  productCommandRevision,
  productCommandTransport,
  subscribeProductCommands,
} from '../state/catalog/product-command-attempt';
import {
  productWorkspaceBase,
  readProductReceipt,
  type ProductReceipt,
} from '../api/contracts/catalog/product-workspace-contract';
export function useProductCommand(viewerId: string) {
  useSyncExternalStore(subscribeProductCommands, productCommandRevision, () => 0);
  const client = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [reading, setReading] = useState(false);
  const sending = useRef(false);
  const owned = useRef<string | null>(null);
  const attempt = productCommandAttempt(viewerId);
  const blocked = attempt?.phase === 'pending' || attempt?.phase === 'unknown';
  useEffect(
    () => () => {
      if (productCommandAttempt(viewerId)?.requestId === owned.current)
        interruptProductCommand(viewerId);
    },
    [viewerId],
  );
  async function deliver(
    expected: { requestId: string; kind: ProductReceipt['kind']; productId: string | null },
    request: { path: string; method: 'POST' | 'PUT'; body: unknown },
  ) {
    if (sending.current) throw new Error('ثبت تغییر کالا در جریان است.');
    sending.current = true;
    setError(undefined);
    try {
      const result = readProductReceipt(
        await api<unknown>(request.path, {
          method: request.method,
          body: JSON.stringify(request.body),
        }),
        expected,
      );
      finishProductCommand(viewerId, expected.requestId, 'confirmed');
      await client.invalidateQueries({ queryKey: ['admin'] });
      return result;
    } catch (failure) {
      const rejected =
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 408;
      finishProductCommand(viewerId, expected.requestId, rejected ? 'rejected' : 'unknown');
      setError(failure);
      throw failure;
    } finally {
      sending.current = false;
    }
  }
  async function send(
    kind: ProductReceipt['kind'],
    productId: string | null,
    body: Record<string, unknown>,
    endpoint: string = kind,
    method: 'POST' | 'PUT' = 'POST',
  ) {
    const requestId = crypto.randomUUID().replace(/-/g, ''),
      request = {
        path: productWorkspaceBase + '/' + endpoint,
        method,
        body: { ...body, requestId },
      };
    beginProductCommand({ viewerId, requestId, kind, productId }, request);
    owned.current = requestId;
    return deliver({ requestId, kind, productId }, request);
  }
  async function recover() {
    const pending = productCommandAttempt(viewerId);
    if (!pending || reading || sending.current) return null;
    setReading(true);
    setError(undefined);
    try {
      const receipt = readProductReceipt(
        await api<unknown>(productWorkspaceBase + '/commands/' + pending.requestId),
        pending,
      );
      finishProductCommand(viewerId, pending.requestId, 'confirmed');
      await client.invalidateQueries({ queryKey: ['admin'] });
      return receipt;
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 404
          ? new Error(
              'رسید هنوز در سرور پیدا نشد. ثبت‌نشدن قطعی نیست؛ دوباره بررسی کنید یا همان تلاش را صریحاً تکرار کنید.',
            )
          : failure,
      );
      return null;
    } finally {
      setReading(false);
    }
  }
  async function retrySame() {
    const pending = productCommandAttempt(viewerId),
      request = productCommandTransport(viewerId);
    if (!pending || !request || pending.phase !== 'unknown') return null;
    owned.current = pending.requestId;
    finishProductCommand(viewerId, pending.requestId, 'pending');
    return deliver(pending, request);
  }
  return { send, recover, retrySame, error, setError, attempt, blocked, reading };
}
