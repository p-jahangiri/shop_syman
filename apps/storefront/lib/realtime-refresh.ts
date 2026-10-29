export type RealtimeScheduler = (run: () => void) => () => void;
const delayed: RealtimeScheduler = (run) => {
  const timer = setTimeout(run, 100);
  return () => clearTimeout(timer);
};
// UI invalidation never advances a pending/unknown command. A later acknowledgement resumes it.
export class RealtimeRefreshGate {
  private pending = false;
  private disposed = false;
  private cancel: (() => void) | null = null;
  private refresh: () => void;
  private busy: () => boolean;
  private schedule: RealtimeScheduler;
  constructor(refresh: () => void, busy: () => boolean, schedule: RealtimeScheduler = delayed) {
    this.refresh = refresh;
    this.busy = busy;
    this.schedule = schedule;
  }
  changed() {
    if (this.disposed) return;
    this.pending = true;
    this.resume();
  }
  resume() {
    if (this.disposed || !this.pending || this.busy() || this.cancel) return;
    this.cancel = this.schedule(() => {
      this.cancel = null;
      if (this.disposed || !this.pending || this.busy()) return;
      this.pending = false;
      this.refresh();
    });
  }
  dispose() {
    this.disposed = true;
    this.pending = false;
    this.cancel?.();
    this.cancel = null;
  }
}
