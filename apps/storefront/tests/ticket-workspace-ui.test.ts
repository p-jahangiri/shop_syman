import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as contract from '@sayman/web-shared/lib/support/ticket-contract.ts';
import * as fileContract from '@sayman/web-shared/lib/support/ticket-file-contract.ts';
import * as requestGeneration from '@sayman/web-shared/lib/data/request-generation.ts';
import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';

test('support queues show server totals and a full tracking ID bypasses the selected queue', async () => {
  const id = '1234567890abcdef1234567890abcdef';
  const at = '2026-11-03T09:00:00+00:00';
  const h = digitalUiHarness(
    fileURLToPath(
      new URL(
        '../../../packages/web-shared/components/support/ticket-workspace.tsx',
        import.meta.url,
      ),
    ),
    {
      '../../lib/data/request-generation': requestGeneration,
      '../../lib/support/ticket-command-request': {},
      '../../lib/support/ticket-file-contract': fileContract,
      '../notifications/private-realtime': { useRealtimeRefresh: () => {} },
      '../../lib/support/ticket-contract': contract,
      '../../lib/shared/commerce': { normalizePersian },
    },
    { URLSearchParams },
  );
  const requests: string[] = [];
  h.mount('TicketWorkspace', {
    owner: 'staff-user',
    staff: true,
    writable: true,
    locale: 'en',
    journal: { subscribe: () => () => {}, snapshot: () => null, interrupt: () => {} },
    transport: async (path: string) => {
      requests.push(path);
      const search = new URL(path, 'http://localhost').searchParams;
      return {
        schemaVersion: 1,
        state: search.get('state'),
        nextCursor: null,
        queueCounts: { open: 51, waitingCustomer: 4, closed: 22 },
        items: search.has('ticketId')
          ? [
              {
                id,
                locale: 'en',
                subject: 'Older private ticket',
                state: 'Closed',
                version: 'AAAAAAAAAAE=',
                messageCount: 1,
                createdAt: at,
                changedAt: at,
              },
            ]
          : [],
      };
    },
  });
  const searchField = () => uiElements(h.tree()).find((node) => node.props.type === 'search');
  const enter = (value: string) =>
    (searchField()?.props.onChange as (event: unknown) => void)({ target: { value } });
  const queue = (name: string) =>
    uiElements(h.tree()).find((node) => node.props['data-queue'] === name);
  await h.settle();
  assert.match(uiText(queue('Open')), /Needs reply51/);
  assert.match(uiText(queue('all')), /All queues77/);
  assert.equal(queue('Open')?.props['aria-pressed'], true);
  assert.deepEqual(requests, ['/api/admin/support/tickets?state=Open']);
  enter('Older private');
  await h.settle();
  assert.equal(requests.length, 1);
  enter('۱۲۳۴۵۶۷۸-۹۰AB-CDEF-۱۲۳۴-۵۶۷۸۹۰ABCDEF');
  await h.settle();
  assert.equal(requests.at(-1), '/api/admin/support/tickets?ticketId=' + id);
  assert.match(uiText(h.tree()), /Older private ticket/);
  assert.equal(queue('all')?.props['aria-pressed'], true);
  (queue('WaitingCustomer')?.props.onClick as () => void)();
  await h.settle();
  assert.equal(searchField()?.props.value, '');
  assert.equal(requests.at(-1), '/api/admin/support/tickets?state=WaitingCustomer');
  h.unmount();
});

test('ticket conversation and text reply stay available while attachment storage fails', async () => {
  const id = 'a'.repeat(32),
    at = '2026-11-03T09:00:00+00:00';
  let rejectFiles!: (error: Error) => void;
  const unavailableFiles = new Promise((_, reject) => {
    rejectFiles = reject;
  });
  const h = digitalUiHarness(
    fileURLToPath(
      new URL(
        '../../../packages/web-shared/components/support/ticket-workspace.tsx',
        import.meta.url,
      ),
    ),
    {
      '../../lib/data/request-generation': requestGeneration,
      '../../lib/support/ticket-command-request': {},
      '../../lib/support/ticket-file-contract': fileContract,
      '../notifications/private-realtime': {},
      '../../lib/support/ticket-contract': contract,
      '../../lib/shared/commerce': {},
    },
    {},
    'export { TicketConversation };',
  );
  const sent: unknown[] = [];
  h.mount('TicketConversation', {
    id,
    owner: 'staff-user',
    staff: true,
    writable: true,
    locale: 'fa',
    refresh: 0,
    completedReplyId: null,
    send: (command: unknown) => sent.push(command),
    transport: async (path: string) => {
      if (path.endsWith('/attachments') || path.endsWith('/capabilities')) return unavailableFiles;
      if (path.endsWith('/messages')) {
        return {
          schemaVersion: 1,
          ticketId: id,
          nextCursor: null,
          items: [
            {
              id: 'b'.repeat(32),
              sequence: '1',
              author: 'customer',
              locale: 'fa',
              body: 'سؤال ثبت‌شدهٔ مشتری',
              at,
            },
          ],
        };
      }
      return {
        schemaVersion: 1,
        ticket: {
          id,
          locale: 'fa',
          subject: 'تیکت نمونه',
          state: 'Open',
          version: 'AAAAAAAAAAE=',
          messageCount: 1,
          createdAt: at,
          changedAt: at,
        },
      };
    },
  });
  await h.settle();
  assert.match(uiText(h.tree()), /سؤال ثبت‌شدهٔ مشتری/);

  rejectFiles(new Error('Attachment storage offline'));
  await h.settle();
  assert.match(uiText(h.tree()), /بخشی از اطلاعات پیوست دریافت نشد/);
  assert.doesNotMatch(uiText(h.tree()), /گفت‌وگو خوانده نشد/);

  const input = uiElements(h.tree()).find((node) => node.type === 'textarea');
  assert.equal(input?.props.disabled, false);
  (input?.props.onChange as (event: unknown) => void)({ target: { value: 'پاسخ پشتیبان' } });
  await h.settle();
  const form = uiElements(h.tree()).find((node) => node.type === 'form');
  (form?.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  await h.settle();
  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { kind: string }).kind, 'reply');
  h.unmount();
});

test('a support photo is read only on demand through the private attachment transport', async () => {
  const id = 'd'.repeat(32),
    imageId = 'e'.repeat(32),
    messageId = 'f'.repeat(32),
    at = '2026-11-03T09:00:00+00:00',
    image = new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIJkAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      { type: 'image/png' },
    ),
    file = { filename: 'photo.png', contentType: 'image/png', bytes: image.size };
  const h = digitalUiHarness(
    fileURLToPath(
      new URL(
        '../../../packages/web-shared/components/support/ticket-workspace.tsx',
        import.meta.url,
      ),
    ),
    {
      '../../lib/data/request-generation': requestGeneration,
      '../../lib/support/ticket-command-request': {},
      '../../lib/support/ticket-file-contract': fileContract,
      '../notifications/private-realtime': {},
      '../../lib/support/ticket-contract': contract,
      '../../lib/shared/commerce': {},
    },
    {},
    'export { TicketConversation, TicketPhoto };',
  );
  const reads: string[] = [],
    commands: { command: contract.TicketCommand; attachment?: Blob }[] = [];
  h.mount('TicketConversation', {
    id,
    owner: 'staff-user',
    staff: true,
    writable: true,
    locale: 'en',
    refresh: 0,
    completedReplyId: null,
    download: async (path: string, attachmentId: string, metadata: typeof file) => {
      assert.equal(attachmentId, imageId);
      assert.deepEqual(metadata, file);
      reads.push(path);
      return image;
    },
    send: (command: contract.TicketCommand, attachment?: Blob) =>
      commands.push({ command, attachment }),
    transport: async (path: string) => {
      if (path.endsWith('/attachments'))
        return {
          schemaVersion: 1,
          ticketId: id,
          items: [{ id: imageId, messageId, author: 'customer', at, file }],
        };
      if (path.endsWith('/capabilities'))
        return {
          schemaVersion: 1,
          configured: true,
          maxBytes: fileContract.privateFileMaximum,
          maxPerTicket: 20,
          contentTypes: fileContract.privateFileTypes,
        };
      if (path.endsWith('/messages'))
        return { schemaVersion: 1, ticketId: id, nextCursor: null, items: [] };
      return {
        schemaVersion: 1,
        ticket: {
          id,
          locale: 'en',
          subject: 'Private photo',
          state: 'Open',
          version: 'AAAAAAAAAAE=',
          messageCount: 1,
          createdAt: at,
          changedAt: at,
        },
      };
    },
  });
  const button = (label: string) =>
    uiElements(h.tree()).find((node) => node.type === 'button' && uiText(node) === label);
  await h.settle();
  assert.equal(reads.length, 0);
  const view = button('View image');
  assert.equal(view?.props['aria-expanded'], false);
  (view?.props.onClick as () => void)();
  await h.settle();
  assert.deepEqual(reads, [`/api/admin/support/tickets/${id}/attachments/${imageId}`]);
  const hide = button('Hide image');
  assert.equal(hide?.props['aria-expanded'], true);
  assert.ok(
    uiElements(h.tree()).some((node) => node.props.blob === image && node.props.src === undefined),
  );
  (hide?.props.onClick as () => void)();
  await h.settle();
  assert.ok(!uiElements(h.tree()).some((node) => node.props.blob === image));

  const pick = (selected: File) => {
    const input = uiElements(h.tree()).find((node) => node.props.type === 'file');
    (input?.props.onChange as (event: unknown) => void)({ target: { files: [selected] } });
  };
  pick(new File(['file with a spoofed image type'], 'not-photo.png', { type: 'image/png' }));
  await h.settle();
  assert.match(uiText(h.tree()), /This file could not be used/);
  pick(new File([image], 'photo.png', { type: 'image/png' }));
  await h.settle();
  assert.doesNotMatch(uiText(h.tree()), /This file could not be used/);
  const textarea = uiElements(h.tree()).find((node) => node.type === 'textarea');
  (textarea?.props.onChange as (event: unknown) => void)({ target: { value: 'Reply with photo' } });
  await h.settle();
  const form = uiElements(h.tree()).find((node) => node.type === 'form');
  (form?.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  await h.settle();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command.kind, 'attachment');
  assert.equal(commands[0].attachment?.type, 'image/png');
  assert.equal(commands[0].attachment?.size, image.size);
  h.unmount();
});
