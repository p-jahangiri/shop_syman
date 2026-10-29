import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { createCmsImageUploadTracker } from './cms-image-model';

export function useCmsImageUploads(onBusy?: (busy: boolean) => void) {
  const [tracker] = useState(createCmsImageUploadTracker);
  const notify = useRef(onBusy);
  notify.current = onBusy;
  const busy = useSyncExternalStore(tracker.subscribe, tracker.snapshot, tracker.snapshot);
  const setBusy = useCallback(
    (field: string, pending: boolean) => {
      const previous = tracker.snapshot();
      tracker.set(field, pending);
      if (previous !== tracker.snapshot()) notify.current?.(tracker.snapshot());
    },
    [tracker],
  );
  return { busy, isBusy: tracker.snapshot, setBusy };
}
