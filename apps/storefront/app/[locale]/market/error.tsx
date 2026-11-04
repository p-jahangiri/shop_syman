'use client';
import { MarketFailure } from '@/components/market/market';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <MarketFailure reset={reset} />;
}
