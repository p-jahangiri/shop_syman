import { Text } from '../../components/forms/forms';
import type { HomeBlock, PromoContent } from '@sayman/web-shared/lib/shared/types.ts';
import type { CmsMenuItem } from './cms-menu-editor';

export function translatedMenu(shared: CmsMenuItem[], existing: CmsMenuItem[] = []): CmsMenuItem[] {
  return shared.map((item, index) => {
    const match =
      existing[index]?.href === item.href
        ? existing[index]
        : existing.find((entry) => entry.href === item.href);
    return {
      ...item,
      label: match?.label || item.label,
      ...(item.children && { children: translatedMenu(item.children, match?.children) }),
    };
  });
}

const blockFields = ['eyebrow', 'title', 'description', 'action'] as const;
const bannerFields = ['eyebrow', 'title', 'action', 'watermark'] as const;
const labels = {
  eyebrow: 'Eyebrow',
  title: 'Title',
  description: 'Description',
  action: 'Button label',
  watermark: 'Decorative text',
};

export function translatedBlocks(
  shared: HomeBlock[] = [],
  existing: HomeBlock[] = [],
): HomeBlock[] {
  return shared.map((block) => {
    const previous = existing.find((entry) => entry.id === block.id && entry.kind === block.kind);
    const result = { ...block };
    for (const field of blockFields)
      if (block[field] !== undefined && previous?.[field]) result[field] = previous[field];
    result.items = block.items?.map((banner, index) => {
      const match =
        previous?.items?.[index]?.href === banner.href
          ? previous.items[index]
          : previous?.items?.find((entry) => entry.href === banner.href);
      const copy: PromoContent = { ...banner };
      for (const field of bannerFields)
        if (banner[field] !== undefined && match?.[field]) copy[field] = match[field];
      return copy;
    });
    return result;
  });
}

function MenuLabels({
  items,
  onChange,
}: {
  items: CmsMenuItem[];
  onChange: (items: CmsMenuItem[]) => void;
}) {
  return items.map((item, index) => {
    const update = (change: Partial<CmsMenuItem>) =>
      onChange(items.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
    return (
      <div key={index} className="cms-translation-menu-label">
        <Text
          label={item.href}
          required
          value={item.label}
          onChange={(label) => update({ label })}
        />
        {item.children?.length ? (
          <MenuLabels items={item.children} onChange={(children) => update({ children })} />
        ) : null}
      </div>
    );
  });
}

export function SiteTranslationFields({
  nav,
  blocks,
  onNavChange,
  onBlocksChange,
}: {
  nav: CmsMenuItem[];
  blocks: HomeBlock[];
  onNavChange: (value: CmsMenuItem[]) => void;
  onBlocksChange: (value: HomeBlock[]) => void;
}) {
  return (
    <>
      <fieldset>
        <legend>برچسب انگلیسی منو</legend>
        <MenuLabels items={nav} onChange={onNavChange} />
      </fieldset>
      <fieldset>
        <legend>متن انگلیسی بخش‌های خانه</legend>
        {blocks.map((block, blockIndex) => {
          const fields = blockFields.filter((field) => block[field] !== undefined);
          if (!fields.length && !block.items?.length) return null;
          const update = (change: Partial<HomeBlock>) =>
            onBlocksChange(
              blocks.map((entry, i) => (i === blockIndex ? { ...entry, ...change } : entry)),
            );
          return (
            <fieldset key={block.id}>
              <legend>{block.id}</legend>
              {fields.map((field) => (
                <Text
                  key={field}
                  label={labels[field]}
                  value={block[field] ?? ''}
                  onChange={(value) => update({ [field]: value })}
                />
              ))}
              {block.items?.map((banner, bannerIndex) => (
                <fieldset key={bannerIndex}>
                  <legend>{banner.href}</legend>
                  {bannerFields
                    .filter((field) => banner[field] !== undefined)
                    .map((field) => (
                      <Text
                        key={field}
                        label={labels[field]}
                        value={banner[field] ?? ''}
                        onChange={(value) =>
                          update({
                            items: block.items?.map((item, i) =>
                              i === bannerIndex ? { ...item, [field]: value } : item,
                            ),
                          })
                        }
                      />
                    ))}
                </fieldset>
              ))}
            </fieldset>
          );
        })}
      </fieldset>
    </>
  );
}
