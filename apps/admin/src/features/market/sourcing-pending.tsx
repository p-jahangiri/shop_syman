import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminSourcingCommand } from './sourcing-admin-command';
export const sourcingCommandKey = (viewerId: string) =>
  ['admin', 'sourcing-command', viewerId] as const;
export function useSourcingCommand(viewerId: string) {
  return useQuery<AdminSourcingCommand | null>({
    queryKey: sourcingCommandKey(viewerId),
    queryFn: async () => null,
    initialData: null,
    enabled: false,
    gcTime: Infinity,
  });
}
export function SourcingCommandGuard({ viewerId }: { viewerId: string }) {
  const command = useSourcingCommand(viewerId).data;
  useEffect(() => {
    if (!command || command.phase === 'failed' || command.phase === 'refresh') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [command]);
  return null;
}
