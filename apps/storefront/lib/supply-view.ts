export type SupplyReadTicket = {
  owner: string;
  requestId: string;
  taskId: string | null;
  epoch: number;
};
export type SupplyReadCurrent = SupplyReadTicket & {
  mounted: boolean;
  status: string;
  verifiedOwner: string | null;
};
export function supplyReadMayApply(ticket: SupplyReadTicket, current: SupplyReadCurrent) {
  return (
    current.mounted &&
    current.status === 'member' &&
    current.verifiedOwner === ticket.owner &&
    current.owner === ticket.owner &&
    current.requestId === ticket.requestId &&
    current.taskId === ticket.taskId &&
    current.epoch === ticket.epoch
  );
}
// Re-selecting the current task on its first history page has no state change
// for the read effect. Do not invalidate that read or clear its displayed data.
// A later history page may explicitly return to the first page of the same task.
export function supplySelectionChangesView(
  currentTask: string | null,
  eventCursor: string | null,
  nextTask: string,
) {
  return currentTask !== nextTask || eventCursor !== null;
}
export function supplyPageSelection(currentTask: string | null, items: readonly { id: string }[]) {
  const selected =
    currentTask && items.some((item) => item.id === currentTask)
      ? currentTask
      : (items[0]?.id ?? null);
  return { selected, resetHistory: selected !== currentTask };
}
