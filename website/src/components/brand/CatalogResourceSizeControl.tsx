import { CheckIcon, ChevronDownIcon } from "@primer/octicons-react";
import { clsx } from "clsx";

export type CatalogResourceSizeOption<T extends number> = {
  value: T;
  label: string;
};

export const CATALOG_RESOURCE_SIZE_OPTIONS = [
  { value: 6, label: "6" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
] as const satisfies readonly CatalogResourceSizeOption<number>[];

/** A page size the catalogs offer: 6, 25, 50, or 100 items. */
export type CatalogResourceSize =
  (typeof CATALOG_RESOURCE_SIZE_OPTIONS)[number]["value"];

/** How many items a catalog page shows until the reader picks a size. */
export const DEFAULT_CATALOG_RESOURCE_SIZE: CatalogResourceSize = 6;

type CatalogResourceSizeControlProps<T extends number> = {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: readonly CatalogResourceSizeOption<T>[];
  /** The catalog's CSS module. The menu reuses the sort menu's classes so the
   *  two toolbar menus look the same. */
  styles: Record<string, string | undefined>;
  value: T;
};

export function CatalogResourceSizeControl<T extends number>({
  ariaLabel,
  onChange,
  options,
  styles,
  value,
}: CatalogResourceSizeControlProps<T>) {
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? String(value);

  return (
    <div className={styles.sortControl}>
      <span className={styles.sortLabel}>Resource page size:</span>
      <details className={styles.sortMenu}>
        <summary
          className={styles.sortTrigger}
          aria-label={`${ariaLabel}: ${selectedLabel}`}
        >
          {selectedLabel}
          <ChevronDownIcon size={16} className={styles.sortChevron} />
        </summary>
        <div className={styles.sortOverlay} role="menu">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              className={clsx(
                styles.sortOption,
                value === option.value && styles.sortOptionActive,
              )}
              onClick={(event) => {
                onChange(option.value);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              {option.label}
              <CheckIcon
                size={16}
                className={styles.sortOptionCheck}
                aria-hidden={value !== option.value}
              />
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
