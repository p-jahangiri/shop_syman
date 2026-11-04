import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { AdminTable } from './admin-table';

export function DataTable<T>({
  data,
  columns,
  label = 'فهرست اطلاعات',
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  placeholder?: string;
  label?: string;
}) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <AdminTable pageable aria-label={label}>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id} data-sortable={header.column.getCanSort()}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => {
              const value = cell.getValue();
              const primitive = typeof value === 'string' || typeof value === 'number';
              return (
                <td
                  key={cell.id}
                  data-sort-value={primitive ? value : undefined}
                  data-search-value={primitive ? String(value) : undefined}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </AdminTable>
  );
}
