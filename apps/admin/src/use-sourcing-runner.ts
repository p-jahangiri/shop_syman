import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, save } from './api';
import {
  createSourcingCommandRunner,
  sourcingRunnerBusy,
  subscribeSourcingRunner,
  type CommandFocus,
} from './sourcing-command-runner';
import { createCommandAdapter, type CommandPermissions } from './sourcing-command-protocol';
import type { AdminSourcingCommand } from './sourcing-admin-command';

export function useSourcingRunner(
  viewerId: string,
  permissions: CommandPermissions,
  onFocus: (focus: CommandFocus) => void,
  onError: (error: unknown) => void,
) {
  const client = useQueryClient(),
    active = useRef(true),
    current = useRef({ permissions, onFocus, onError });
  current.current = { permissions, onFocus, onError };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const busy = useSyncExternalStore(
    (listener) => subscribeSourcingRunner(client, viewerId, listener),
    () => sourcingRunnerBusy(client, viewerId),
    () => false,
  );
  const runner = createSourcingCommandRunner({
    client,
    viewerId,
    active: () => active.current,
    adapter: (command) =>
      createCommandAdapter(command, current.current.permissions, (path) => api<unknown>(path)),
    onFocus: (focus) => current.current.onFocus(focus),
    onError: (error) => current.current.onError(error),
    status: (error) => (error instanceof ApiError ? error.status : null),
  });
  return {
    busy,
    send: (command: AdminSourcingCommand) =>
      runner.send(command, (path, body, method) => save<unknown>(path, body, method)),
    recover: (command: AdminSourcingCommand) =>
      runner.recover(command, (path) => api<unknown>(path)),
    refresh: (command: AdminSourcingCommand) => runner.refresh(command),
    discardFailed: (command: AdminSourcingCommand, invalidate: readonly (readonly unknown[])[]) =>
      runner.discardFailed(command, invalidate),
  };
}
