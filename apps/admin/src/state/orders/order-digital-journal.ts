import {
  digitalDeliveryMetadataSchema,
  readDigitalDeliveryResult,
  type DigitalDeliveryMetadata,
  type DigitalDeliveryResult,
} from '@sayman/web-shared/lib/orders/order-digital-contract.ts';

export type DigitalJournalEntry = {
  actor: string;
  metadata: DigitalDeliveryMetadata;
  state: 'pending' | 'unknown' | 'rejected' | 'done';
  result: DigitalDeliveryResult | null;
  failure: 'capacity' | 'metadata' | null;
};
export class OrderDigitalJournal {
  private actor: string | null = null;
  private entry: DigitalJournalEntry | null = null;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = (actor: string | null) => (actor !== null && actor === this.actor ? this.entry : null);
  private publish(entry: DigitalJournalEntry | null) {
    this.entry = entry ? structuredClone(entry) : null;
    if (this.entry) {
      this.entry.metadata.lines.forEach(Object.freeze);
      Object.freeze(this.entry.metadata.lines);
      Object.freeze(this.entry.metadata);
      Object.freeze(this.entry);
    }
    for (const f of this.listeners) f();
  }
  bind(actor: string | null) {
    if (actor !== this.actor) {
      this.actor = actor;
      this.publish(null);
    }
  }
  begin(actor: string, supplied: DigitalDeliveryMetadata) {
    if (actor !== this.actor || this.entry) throw Error('Resolve the previous digital command');
    this.publish({
      actor,
      metadata: digitalDeliveryMetadataSchema.parse(supplied),
      state: 'pending',
      result: null,
      failure: null,
    });
  }
  private matches(actor: string, metadata: DigitalDeliveryMetadata) {
    return (
      actor === this.actor &&
      !!this.entry &&
      JSON.stringify(this.entry.metadata) === JSON.stringify(metadata)
    );
  }
  finish(actor: string, metadata: DigitalDeliveryMetadata, raw: unknown) {
    if (!this.matches(actor, metadata)) return false;
    const result = readDigitalDeliveryResult(raw, metadata);
    this.publish({ ...this.entry!, state: 'done', result, failure: null });
    return true;
  }
  fail(actor: string, metadata: DigitalDeliveryMetadata, status: number, code: string) {
    if (!this.matches(actor, metadata) || this.entry?.state === 'done') return;
    const unknown =
      this.entry?.state === 'unknown' ||
      status < 400 ||
      status >= 500 ||
      status === 401 ||
      status === 403 ||
      code === 'idempotency_conflict';
    this.publish({
      ...this.entry!,
      state: unknown ? 'unknown' : 'rejected',
      result: null,
      failure:
        !unknown && code === 'digital_delivery_metadata_capacity_conflict'
          ? 'metadata'
          : !unknown &&
              ['fulfillment_capacity_conflict', 'digital_delivery_capacity_conflict'].includes(code)
            ? 'capacity'
            : null,
    });
  }
  interrupt() {
    if (this.entry?.state === 'pending') this.publish({ ...this.entry, state: 'unknown' });
  }
  clear(actor: string) {
    if (['done', 'rejected'].includes(this.snapshot(actor)?.state ?? '')) this.publish(null);
  }
}
export const orderDigitalJournal = new OrderDigitalJournal();
