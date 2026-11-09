import { ArrowLeft, Wallet } from 'lucide-react';
import Link from '@/components/navigation/localized-link';
import { budgetFinderPath } from '@/lib/catalog/budget-finder';
import type { Locale } from '@sayman/web-shared/lib/shared/types.ts';
import './budget-finder.css';

export function BudgetFinderLink({ locale }: { locale: Locale }) {
  const fa = locale === 'fa';
  return (
    <Link className="budget-entry" href={budgetFinderPath}>
      <span className="budget-entry-icon">
        <Wallet size={23} aria-hidden="true" />
      </span>
      <span>
        <strong>
          {fa ? 'با بودجه‌ات چی می‌تونی بخری؟' : 'What can you buy within your budget?'}
        </strong>
        <span>
          {fa
            ? 'سقف هزینه‌ات را بگو و کالاهای موجود را کنار هم ببین.'
            : 'Set a spending limit and see what is in stock.'}
        </span>
      </span>
      <ArrowLeft className="budget-arrow" size={20} aria-hidden="true" />
    </Link>
  );
}
