import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { normalizeAdminListText } from './admin-list-text.ts';

type NodeProps = {
  className?: string;
  children?: ReactNode;
  colSpan?: number;
  'data-sort-value'?: string | number;
  'data-search-value'?: string;
  'data-sortable'?: boolean;
};
export type TableCell = ReactElement<NodeProps>;
export type TableRecord = { id: string; source: TableCell; cells: TableCell[] };

export function tableNodes(children: ReactNode): TableCell[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<NodeProps>(child)) return [];
    return child.type === Fragment ? tableNodes(child.props.children) : [child];
  });
}

// Text in controls is an action or an editable value, not a record field.
// Never index an input value, password or hidden data in table search.
export function tableCellText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint')
    return String(node);
  if (Array.isArray(node)) return node.map(tableCellText).join(' ');
  if (!isValidElement<NodeProps>(node)) return '';
  if (['input', 'select', 'textarea', 'button', 'svg'].includes(String(node.type))) return '';
  return tableCellText(node.props.children);
}

export function tableCellValue(cell: TableCell): string {
  return String(cell.props['data-sort-value'] ?? tableCellText(cell.props.children)).trim();
}

export type TableFilter = string | { equals: string };
export function tableCellMatches(cell: TableCell, query: TableFilter) {
  const text = normalizeAdminListText(
    cell.props['data-search-value'] ?? tableCellText(cell.props.children),
  );
  if (typeof query !== 'string') return text === normalizeAdminListText(query.equals);
  return normalizeAdminListText(query)
    .split(' ')
    .filter(Boolean)
    .every((word) => text.includes(word));
}

export function readTableMarkup(children: ReactNode) {
  const sections = tableNodes(children);
  const head = sections.find((section) => section.type === 'thead');
  const body = sections.find((section) => section.type === 'tbody');
  if (!head || !body) return null;
  const headings = tableNodes(head.props.children);
  if (headings.length !== 1) return null;
  const headers = tableNodes(headings[0].props.children);
  if (!headers.length || headers.some((header) => (header.props.colSpan ?? 1) !== 1)) return null;
  const bodyRows = tableNodes(body.props.children);
  const onlyCells = bodyRows.length === 1 ? tableNodes(bodyRows[0].props.children) : [];
  const empty =
    onlyCells.length === 1 && onlyCells[0].props.colSpan === headers.length
      ? bodyRows[0]
      : undefined;
  const rows: TableRecord[] = bodyRows
    .filter((row) => row !== empty)
    .map((row, index) => ({
      id: String(row.key ?? index),
      source: row,
      cells: tableNodes(row.props.children),
    }));
  // A complex spanning table remains native instead of losing or misplacing cells.
  if (
    rows.some(
      (row) =>
        row.cells.length !== headers.length ||
        row.cells.some((cell) => (cell.props.colSpan ?? 1) !== 1),
    )
  )
    return null;
  return { headers, rows, empty, footer: sections.find((section) => section.type === 'tfoot') };
}

export function sortableTableHeader(header: TableCell) {
  if (header.props['data-sortable'] === false) return false;
  const text = tableCellText(header.props.children).trim();
  return !!text && !/عملیات|جزئیات|پرونده$|گفت‌وگو|انتخاب|دسترسی و|ویرایش/.test(text);
}
