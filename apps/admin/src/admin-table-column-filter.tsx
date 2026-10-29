import type { Column } from '@tanstack/react-table';
import { tableCellText, type TableFilter, type TableRecord } from './admin-table-model';

export function TableColumnFilter({
  column,
  label,
  rows,
  index,
  name,
}: {
  column: Column<TableRecord>;
  label: string;
  rows: TableRecord[];
  index: number;
  name: string;
}) {
  const options = Array.from(
    new Set(
      rows.map(
        (row) =>
          row.cells[index].props['data-search-value'] ??
          tableCellText(row.cells[index].props.children).trim(),
      ),
    ),
  ).filter(Boolean);
  const useChoices =
    options.length > 0 && options.length <= 16 && options.every((value) => value.length <= 70);
  const filter = column.getFilterValue() as TableFilter | undefined;
  return (
    <label className="record-filter-field">
      <span>{label}</span>
      {useChoices ? (
        <select
          name={name}
          value={typeof filter === 'object' ? filter.equals : ''}
          onChange={(event) =>
            column.setFilterValue(event.target.value ? { equals: event.target.value } : undefined)
          }
        >
          <option value="">همه</option>
          {options.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="search"
          name={name}
          placeholder="فیلتر این ستون…"
          value={typeof filter === 'string' ? filter : ''}
          onChange={(event) => column.setFilterValue(event.target.value || undefined)}
        />
      )}
    </label>
  );
}
