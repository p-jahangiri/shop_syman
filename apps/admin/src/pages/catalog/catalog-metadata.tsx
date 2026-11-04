import { useMemo, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { FolderTree, ListChecks, Pencil, Plus, RefreshCw, Tag } from 'lucide-react';
import { adminListMatches, compareAdminListValues } from '../../utils/admin-list-text';
import {
  attributeTypeLabels,
  metadataName,
  type MetadataKind,
} from '../../features/catalog-metadata/catalog-metadata-model';
import { CatalogMetadataDialog } from '../../features/catalog-metadata/catalog-metadata-form';
import { imagePreviewUrl } from '../../api/contracts/media/media-contract';
import { type Catalog } from '../../types/types';
import {
  WorkspaceDataTable,
  type WorkspaceColumn,
  type WorkspaceSort,
} from '../../components/tables/workspace-data-table';
import '../../features/catalog-metadata/catalog-metadata.css';

type MetadataColumn = 'name' | 'identifier' | 'relation' | 'quantity' | 'order' | 'status';
const number = new Intl.NumberFormat('fa-IR');
const pages = [10, 25, 50] as const;
const content = {
  brands: {
    singular: 'برند',
    name: 'برندها',
    identifier: 'نشانی برند',
    description: 'نام، لوگو و وضعیت نمایش برند در فروشگاه را مدیریت کنید.',
    icon: Tag,
  },
  categories: {
    singular: 'دسته‌بندی',
    name: 'دسته‌بندی‌ها',
    identifier: 'نشانی دسته',
    description: 'ساختار دسته‌ها، ترتیب نمایش و ویژگی‌های هر دسته را تنظیم کنید.',
    icon: FolderTree,
  },
  attributes: {
    singular: 'ویژگی',
    name: 'ویژگی‌های پویا',
    identifier: 'کلید ویژگی',
    description: 'نوع داده و گزینه‌های قابل انتخاب برای مشخصات کالا و فیلتر فروشگاه را تعریف کنید.',
    icon: ListChecks,
  },
};
type MetadataRow = {
  id: string;
  name: string;
  english: string;
  identifier: string;
  relation: string;
  relationId: string;
  quantity: number;
  order?: number;
  image?: string;
  status: string;
};

function tableRows(data: Catalog, kind: MetadataKind): MetadataRow[] {
  const english = (row: { translations: { locale: string; name: string }[] }) =>
    row.translations.find((tr) => tr.locale === 'en')?.name ?? '';
  if (kind === 'brands')
    return data.brands.map((brand) => ({
      id: brand.id,
      name: brand.name,
      english: '',
      identifier: brand.slug,
      relation: '',
      relationId: '',
      quantity: 0,
      image: brand.logoUrl,
      status: brand.isActive ? 'فعال' : 'غیرفعال',
    }));
  if (kind === 'categories') {
    const names = new Map(
      data.categories.map((category) => [category.id, metadataName(category, category.slug)]),
    );
    return data.categories.map((category) => ({
      id: category.id,
      name: names.get(category.id)!,
      english: english(category),
      identifier: category.slug,
      relation: category.parentId ? (names.get(category.parentId) ?? 'والد نامشخص') : 'دستهٔ اصلی',
      relationId: category.parentId ?? 'root',
      quantity: category.attributes.length,
      order: category.sortOrder,
      image: category.imageUrl,
      status: category.isActive ? 'فعال' : 'غیرفعال',
    }));
  }
  return data.attributes.map((attribute) => ({
    id: attribute.id,
    name: metadataName(attribute, attribute.key),
    english: english(attribute),
    identifier: attribute.key,
    relation: attributeTypeLabels[attribute.dataType],
    relationId: attribute.dataType,
    quantity: attribute.options.length,
    status: '',
  }));
}

function tableColumns(kind: MetadataKind): WorkspaceColumn<MetadataRow, MetadataColumn>[] {
  const main: WorkspaceColumn<MetadataRow, MetadataColumn>[] = [
    {
      key: 'name',
      label: 'عنوان',
      type: 'text',
      sortable: true,
      sticky: 'start',
      width: 225,
      mobilePriority: 'primary',
      tooltip: (row) => (row.english ? row.name + ' · ' + row.english : row.name),
      formatter: (row) => (
        <span className="catalog-meta-record">
          {row.image && imagePreviewUrl(row.image) && (
            <img src={imagePreviewUrl(row.image)} alt="" loading="lazy" />
          )}
          <span className="catalog-meta-title">
            <strong>{row.name}</strong>
            {row.english && row.english !== row.name && (
              <small>
                <bdi>{row.english}</bdi>
              </small>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'identifier',
      label: content[kind].identifier,
      type: 'text',
      sortable: true,
      width: 170,
      mobilePriority: 'primary',
      formatter: (row) => <bdi>{row.identifier}</bdi>,
    },
  ];
  if (kind !== 'brands')
    main.push(
      {
        key: 'relation',
        label: kind === 'categories' ? 'دستهٔ والد' : 'نوع داده',
        type: 'enum',
        filter: 'multiselect',
        sortable: true,
        width: 172,
        mobilePriority: 'primary',
        formatter: (row) =>
          kind === 'attributes' ? (
            <Chip
              size="small"
              label={row.relation}
              color={row.relationId === 'MultiSelect' ? 'warning' : 'info'}
              variant="outlined"
            />
          ) : (
            row.relation
          ),
      },
      {
        key: 'quantity',
        label: kind === 'categories' ? 'ویژگی‌های متصل' : 'گزینه‌ها',
        type: 'number',
        sortable: true,
        width: 134,
        formatter: (row) => number.format(row.quantity),
      },
    );
  if (kind === 'categories')
    main.push({
      key: 'order',
      label: 'ترتیب نمایش',
      type: 'number',
      sortable: true,
      width: 130,
      formatter: (row) => number.format(row.order ?? 0),
    });
  if (kind !== 'attributes')
    main.push({
      key: 'status',
      label: 'وضعیت',
      type: 'status',
      sortable: true,
      filter: 'multiselect',
      width: 135,
      mobilePriority: 'primary',
      formatter: (row) => (
        <Chip
          size="small"
          label={row.status}
          color={row.status === 'فعال' ? 'success' : 'default'}
          variant="outlined"
        />
      ),
    });
  return main;
}

export function CatalogPage({
  kind,
  data,
  writable,
}: {
  kind: MetadataKind;
  data: Catalog;
  writable: boolean;
}) {
  const client = useQueryClient();
  const fetching = useIsFetching({ queryKey: ['admin', 'catalog'] }) > 0;
  const [editing, setEditing] = useState<string | null | undefined>();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<WorkspaceSort<MetadataColumn>>({
    key: 'name',
    direction: 'asc',
  });
  const [filters, setFilters] = useState({ relation: '', status: '' });
  const [hidden, setHidden] = useState<Set<MetadataColumn>>(() => new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const rows = useMemo(() => tableRows(data, kind), [data, kind]);
  const columns = useMemo(() => tableColumns(kind), [kind]);
  const ordered = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            (!filters.relation || row.relationId === filters.relation) &&
            (!filters.status || row.status === filters.status) &&
            adminListMatches(
              [row.name, row.english, row.identifier, row.relation, row.status],
              search,
            ),
        )
        .sort((a, b) => {
          const column = sort.key;
          const order =
            compareAdminListValues(a[column], b[column]) * (sort.direction === 'asc' ? 1 : -1);
          return order || compareAdminListValues(a.id, b.id);
        }),
    [rows, filters, search, sort],
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(ordered.length / pageSize) - 1));
  const relations = new Map(
    rows.filter((row) => row.relationId).map((row) => [row.relationId, row.relation]),
  );
  const chips: { key: MetadataColumn; label: string }[] = [];
  if (filters.relation)
    chips.push({ key: 'relation', label: relations.get(filters.relation) ?? 'دستهٔ والد' });
  if (filters.status) chips.push({ key: 'status', label: filters.status });
  function apply(key: 'relation' | 'status', value: string) {
    setFilters((old) => ({ ...old, [key]: value }));
    setPage(0);
  }
  const label = content[kind];
  const Icon = label.icon;
  return (
    <section className="panel catalog-meta">
      <div className="section-heading catalog-meta-heading">
        <div className="catalog-meta-heading-label">
          <span className="catalog-meta-icon" data-kind={kind}>
            <Icon size={23} aria-hidden="true" />
          </span>
          <div>
            <h2>{label.name}</h2>
            <p>{label.description}</p>
          </div>
        </div>
        {writable && (
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setEditing(null)}
          >
            افزودن {label.singular}
          </Button>
        )}
      </div>
      <WorkspaceDataTable
        label={'جدول ' + label.name}
        itemLabel={label.singular}
        columns={columns}
        items={ordered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)}
        getRowId={(row) => row.id}
        total={ordered.length}
        page={currentPage}
        pageSize={pageSize}
        pageSizes={pages}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
        searchLabel={'جست‌وجوی ' + label.singular}
        searchPlaceholder="عنوان یا شناسه"
        sort={sort}
        onSortChange={(value) => {
          setSort(value);
          setPage(0);
        }}
        hiddenColumns={hidden}
        onHiddenColumnsChange={setHidden}
        filterChips={chips}
        onRemoveFilter={(key) => apply(key === 'relation' ? 'relation' : 'status', '')}
        onClearFilters={() => {
          setFilters({ relation: '', status: '' });
          setPage(0);
        }}
        renderFilter={(column, close) => {
          const key = column.key === 'relation' ? 'relation' : 'status';
          const choices =
            key === 'relation'
              ? [...relations].sort((a, b) => compareAdminListValues(a[1], b[1]))
              : [
                  ['فعال', 'فعال'],
                  ['غیرفعال', 'غیرفعال'],
                ];
          return (
            <TextField
              select
              label={column.label}
              value={filters[key]}
              fullWidth
              onChange={(event) => {
                apply(key, event.target.value);
                close();
              }}
            >
              <MenuItem value="">همه</MenuItem>
              {choices.map(([id, title]) => (
                <MenuItem
                  key={id}
                  value={id}
                  sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                >
                  {title}
                </MenuItem>
              ))}
            </TextField>
          );
        }}
        toolbarActions={
          <Button
            startIcon={<RefreshCw size={17} />}
            disabled={fetching}
            onClick={() => void client.invalidateQueries({ queryKey: ['admin', 'catalog'] })}
          >
            تازه‌سازی
          </Button>
        }
        renderRowActions={
          writable
            ? (row) => (
                <Button
                  size="small"
                  startIcon={<Pencil size={15} />}
                  onClick={() => setEditing(row.id)}
                  aria-label={'ویرایش ' + row.name}
                >
                  ویرایش
                </Button>
              )
            : undefined
        }
      />
      {writable && editing !== undefined && (
        <CatalogMetadataDialog
          kind={kind}
          label={label.singular}
          id={editing}
          data={data}
          onClose={() => setEditing(undefined)}
        />
      )}
    </section>
  );
}
