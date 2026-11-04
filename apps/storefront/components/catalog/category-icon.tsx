import {
  Boxes,
  Gamepad2,
  Grid2X2,
  Headphones,
  Laptop,
  PackageCheck,
  Smartphone,
} from 'lucide-react';

const categoryIcons = {
  all: Grid2X2,
  phones: Smartphone,
  laptops: Laptop,
  gaming: Gamepad2,
  accessories: Headphones,
  used: PackageCheck,
};

export function CatalogCategoryIcon({
  categoryKey,
  size = 18,
}: {
  categoryKey?: string;
  size?: number;
}) {
  const Icon =
    categoryKey && Object.hasOwn(categoryIcons, categoryKey)
      ? categoryIcons[categoryKey as keyof typeof categoryIcons]
      : Boxes;
  return <Icon size={size} aria-hidden="true" />;
}
