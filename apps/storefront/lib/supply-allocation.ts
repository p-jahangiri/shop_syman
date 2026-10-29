// A response is the server's read-time state. An open tab must stop presenting
// its hold as active when that explicit absolute deadline passes locally too.
// A local clock never grants a hold that the server marked expired or absent.
export function supplyAllocationHeld(
  reserved: boolean,
  allocation: { state: string; effectiveState: string; expiresAt: string } | null,
  now: number,
) {
  return (
    reserved &&
    allocation?.state === 'Active' &&
    allocation.effectiveState === 'Active' &&
    Number.isFinite(now) &&
    Date.parse(allocation.expiresAt) > now
  );
}
