import {
  rmaCreateInputSchema,
  rmaWithdrawInputSchema,
  rmaReviewInputSchema,
  rmaPolicyInputSchema,
  readRmaCommandResult,
  readRmaPolicyResult,
  type RmaCommandResult,
  type RmaPolicyResult,
} from './rma-contract.ts';
export type RmaCommand = {
  commandId: string;
  path: string;
  receiptPath: string;
  kind: 'create' | 'withdraw' | 'review' | 'policy';
  orderId?: string;
  caseId?: string;
  ownerId?: string;
  body: unknown;
};
export type RmaEntry = {
  actor: string;
  command: RmaCommand;
  state: 'pending' | 'unknown' | 'done' | 'rejected';
  result: RmaCommandResult | RmaPolicyResult | null;
  code: string | null;
};
// The private canonical request exists only in this authenticated actor's RAM.
// Only opaque command metadata may survive in sessionStorage; private text, result bodies and content hashes never do. Mutations are not automatically retried.
type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class RmaJournal {
  private storageKey: string | null;
  private suppliedStorage: MarkerStorage | undefined;
  constructor(storageKey: string | null = null, suppliedStorage?: MarkerStorage) {
    this.storageKey = storageKey;
    this.suppliedStorage = suppliedStorage;
  }
  private storage() {
    try {
      return (
        this.suppliedStorage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined)
      );
    } catch {
      return undefined;
    }
  }
  private persist() {
    if (!this.storageKey) return;
    try {
      const storage = this.storage();
      if (this.entry && ['pending', 'unknown'].includes(this.entry.state)) {
        const { body: _private, ...command } = this.entry.command;
        void _private;
        storage?.setItem(this.storageKey, JSON.stringify({ actor: this.actor, command }));
      } else storage?.removeItem(this.storageKey);
    } catch {
      /* Receipt lookup and beforeunload remain available when storage is blocked. */
    }
  }

  private actor: string | null = null;
  private entry: RmaEntry | null = null;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  isBound = (actor: string) => actor === this.actor;
  hasUnresolved = () => this.entry?.state === 'pending' || this.entry?.state === 'unknown';
  snapshot = (actor: string | null) => (actor !== null && actor === this.actor ? this.entry : null);
  bind(actor: string | null) {
    if (this.actor !== actor || actor === null) {
      this.actor = actor;
      this.entry = null;
      if (actor && this.storageKey)
        try {
          const raw = this.storage()?.getItem(this.storageKey);
          if (raw && raw.length <= 4096) {
            const marker = JSON.parse(raw);
            if (
              marker.actor === actor &&
              marker.command &&
              Object.keys(marker).sort().join(',') === 'actor,command'
            ) {
              const c = marker.command as RmaCommand;
              const expected = rmaCommand(
                c.kind,
                null,
                { orderId: c.orderId, caseId: c.caseId, ownerId: c.ownerId },
                c.commandId,
              );
              const allowed = [
                'kind',
                'commandId',
                'path',
                'receiptPath',
                'orderId',
                'caseId',
                'ownerId',
              ];
              if (
                Object.keys(c).every((k) => allowed.includes(k)) &&
                ['create', 'withdraw', 'review', 'policy'].includes(c.kind) &&
                /^[a-f0-9]{32}$/.test(c.commandId) &&
                !/^0+$/.test(c.commandId) &&
                c.path === expected.path &&
                c.receiptPath === expected.receiptPath &&
                [c.orderId, c.caseId, c.ownerId].every(
                  (x) => x === undefined || /^[A-Za-z0-9_-]{1,64}$/.test(x),
                )
              )
                this.entry = {
                  actor,
                  command: { ...c, body: null },
                  state: 'unknown',
                  result: null,
                  code: null,
                };
            }
          }
        } catch {
          /* Invalid markers are discarded without displaying their contents. */
        }
      this.publish(this.entry);
    }
  }
  private publish(entry: RmaEntry | null) {
    this.entry = entry ? structuredClone(entry) : null;
    if (this.entry) {
      const freeze = (v: unknown) => {
        if (v && typeof v === 'object') {
          Object.values(v).forEach(freeze);
          Object.freeze(v);
        }
      };
      freeze(this.entry);
    }
    this.persist();
    for (const listener of this.listeners) listener();
  }
  begin(actor: string, command: RmaCommand) {
    if (actor !== this.actor || this.entry) throw Error('Resolve the previous return command');
    if (!/^[a-f0-9]{32}$/.test(command.commandId) || /^0+$/.test(command.commandId))
      throw Error('invalid_rma');
    if (
      (command.kind === 'create' && !/^[a-f0-9]{32}$/.test(command.orderId ?? '')) ||
      (['withdraw', 'review'].includes(command.kind) &&
        !/^[a-f0-9]{32}$/.test(command.caseId ?? '')) ||
      (command.kind === 'review' && !/^[A-Za-z0-9_-]{1,64}$/.test(command.ownerId ?? ''))
    )
      throw Error('invalid_rma');
    const body =
      command.kind === 'create'
        ? rmaCreateInputSchema.parse(command.body)
        : command.kind === 'withdraw'
          ? rmaWithdrawInputSchema.parse(command.body)
          : command.kind === 'review'
            ? rmaReviewInputSchema.parse(command.body)
            : rmaPolicyInputSchema.parse(command.body);
    const expected =
      command.kind === 'create'
        ? `/api/orders/${command.orderId}/returns/commands/${command.commandId}`
        : command.kind === 'withdraw'
          ? `/api/returns/${command.caseId}/withdrawals/${command.commandId}`
          : command.kind === 'review'
            ? `/api/admin/returns/${command.caseId}/commands/${command.commandId}`
            : `/api/admin/returns/policy/commands/${command.commandId}`;
    const receipt =
      command.kind === 'policy'
        ? expected
        : `/api/${command.kind === 'review' ? 'admin/' : ''}returns/commands/${command.commandId}`;
    if (
      command.path !== expected ||
      command.receiptPath !== receipt ||
      new TextEncoder().encode(JSON.stringify(body)).length > 32768
    )
      throw Error('invalid_rma');
    this.publish({
      actor,
      command: { ...command, body },
      state: 'pending',
      result: null,
      code: null,
    });
  }
  private matches(actor: string, commandId: string) {
    return actor === this.actor && this.entry?.command.commandId === commandId;
  }
  finish(actor: string, commandId: string, raw: unknown) {
    if (!this.matches(actor, commandId)) return false;
    const c = this.entry!.command;
    const result =
      c.kind === 'policy'
        ? readRmaPolicyResult(raw, commandId)
        : readRmaCommandResult(raw, {
            commandId,
            orderId: c.orderId,
            caseId: c.caseId,
            staff: c.kind === 'review',
            ownerId: c.ownerId,
          });
    if (c.kind === 'create' && c.body !== null && 'case' in result) {
      const body = rmaCreateInputSchema.parse(c.body);
      const d = result.case;
      if (
        d.case.state !== 'submitted' ||
        d.case.outcome !== null ||
        d.policy.id !== body.policyRevisionId ||
        d.case.kind !== body.kind ||
        d.reason !== body.reason ||
        d.lines.length !== body.lines.length ||
        body.lines.some(
          (l) => !d.lines.some((x) => x.lineKey === l.lineKey && x.quantity === l.quantity),
        )
      )
        throw Error('rma_unavailable');
    }
    if (c.body !== null && c.kind === 'withdraw' && 'case' in result) {
      const body = rmaWithdrawInputSchema.parse(c.body);
      const d = result.case;
      if (
        d.case.state !== 'withdrawn' ||
        d.case.version === body.version ||
        d.events.at(-1)?.action !== 'withdrawn' ||
        d.events.at(-1)?.message !== body.reason
      )
        throw Error('rma_unavailable');
    }
    if (c.body !== null && c.kind === 'review' && 'case' in result) {
      const body = rmaReviewInputSchema.parse(c.body);
      const d = result.case;
      const event = d.events.at(-1);
      if (
        d.case.state !== (body.action === 'startReview' ? 'reviewing' : 'reviewed') ||
        d.case.outcome !== body.outcome ||
        d.case.version === body.version ||
        event?.action !== body.action ||
        event?.staffNote !== body.note ||
        event?.message !== body.customerMessage
      )
        throw Error('rma_unavailable');
    }
    if (c.body !== null && c.kind === 'policy' && 'policy' in result) {
      const body = rmaPolicyInputSchema.parse(c.body);
      const p = result.policy.current!;
      if (
        p.version === body.version ||
        (
          [
            'enabled',
            'physicalReturns',
            'digitalComplaints',
            'conditionsFa',
            'conditionsEn',
            'windowMode',
            'windowDays',
            'maxOpenPerOwner',
          ] as const
        ).some((k) => p[k] !== body[k])
      )
        throw Error('rma_unavailable');
    }
    this.publish({
      ...this.entry!,
      command: { ...c, body: null },
      state: 'done',
      result,
      code: null,
    });
    return true;
  }
  fail(actor: string, commandId: string, status: number, code: string) {
    if (!this.matches(actor, commandId) || this.entry?.state === 'done') return;
    const unknown =
      this.entry?.state === 'unknown' ||
      status < 400 ||
      status >= 500 ||
      status === 401 ||
      status === 403 ||
      code.includes('idempotency');
    this.publish({
      ...this.entry!,
      command: { ...this.entry!.command, body: unknown ? this.entry!.command.body : null },
      state: unknown ? 'unknown' : 'rejected',
      result: null,
      code,
    });
  }
  // A same-actor permission change invalidates private snapshots, not the
  // historical outcome of an already-sent command. Keep only receipt metadata.
  redactForPermissionsChange() {
    if (!this.entry) return;
    if (this.entry.state === 'pending' || this.entry.state === 'unknown') {
      this.publish({
        ...this.entry,
        command: { ...this.entry.command, body: null },
        state: 'unknown',
        result: null,
        code: null,
      });
    } else this.publish(null);
  }
  interrupt() {
    if (this.entry?.state === 'pending') this.publish({ ...this.entry, state: 'unknown' });
  }
  clear(actor: string) {
    if (['done', 'rejected'].includes(this.snapshot(actor)?.state ?? '')) this.publish(null);
  }
}
export const customerRmaJournal = new RmaJournal('sayman.customer.rma-command.v1');
export const adminRmaJournal = new RmaJournal('sayman.admin.rma-command.v1');
export function rmaCommand(
  kind: RmaCommand['kind'],
  body: unknown,
  ids: { orderId?: string; caseId?: string; ownerId?: string } = {},
  commandId = crypto.randomUUID().replaceAll('-', ''),
): RmaCommand {
  const path =
    kind === 'create'
      ? `/api/orders/${ids.orderId}/returns/commands/${commandId}`
      : kind === 'withdraw'
        ? `/api/returns/${ids.caseId}/withdrawals/${commandId}`
        : kind === 'review'
          ? `/api/admin/returns/${ids.caseId}/commands/${commandId}`
          : `/api/admin/returns/policy/commands/${commandId}`;
  return {
    kind,
    body,
    ...ids,
    commandId,
    path,
    receiptPath:
      kind === 'policy'
        ? path
        : `/api/${kind === 'review' ? 'admin/' : ''}returns/commands/${commandId}`,
  };
}
