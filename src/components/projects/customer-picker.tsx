"use client";

// src/components/projects/customer-picker.tsx
// Customer combobox for the project form: debounced server-side search
// (searchCustomersAction → listCustomers, org-scoped) instead of shipping the
// whole customer table to the browser. Editing the text after a selection
// clears the selection so a stale id can never ride along with a new label.

import * as React from "react";
import { SearchIcon } from "lucide-react";
import { searchCustomersAction } from "@/modules/customers/actions";
import { Input } from "@/components/ui/input";

export interface CustomerPickerProps {
  id: string;
  /** Selected customer id ("" = nothing selected yet). */
  value: string;
  /** Label of the already-selected customer (edit mode) or "" (create). */
  initialName: string;
  onValueChange: (id: string) => void;
  disabled?: boolean;
}

interface CustomerOption {
  id: string;
  companyName: string;
}

export function CustomerPicker({
  id,
  value,
  initialName,
  onValueChange,
  disabled,
}: CustomerPickerProps) {
  const [query, setQuery] = React.useState(initialName);
  const [options, setOptions] = React.useState<CustomerOption[]>([]);
  const [open, setOpen] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);
  // The label currently backing the selection — matches mean "still selected".
  const selectedLabel = React.useRef(initialName);

  React.useEffect(() => {
    if (disabled) return;
    const q = query.trim();
    if (!q || q === selectedLabel.current) {
      setOptions([]);
      setOpen(false);
      setSearching(false);
      setFailed(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const result = await searchCustomersAction({ q });
      if (cancelled) return;
      setSearching(false);
      if (result.ok) {
        setOptions(result.data.options);
        setFailed(null);
      } else {
        setOptions([]);
        setFailed(result.error.message);
      }
      setOpen(true);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, disabled]);

  function handleQuery(next: string) {
    setQuery(next);
    if (value && next.trim() !== selectedLabel.current) {
      selectedLabel.current = "";
      onValueChange("");
    }
  }

  function select(option: CustomerOption) {
    selectedLabel.current = option.companyName;
    setQuery(option.companyName);
    setOptions([]);
    setOpen(false);
    setFailed(null);
    onValueChange(option.id);
  }

  const showResults = open && (searching || failed !== null || options.length > 0 || query.trim() !== "");

  return (
    <div className="relative">
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          role="combobox"
          aria-expanded={showResults}
          aria-controls={`${id}-results`}
          aria-autocomplete="list"
          autoComplete="off"
          className="pl-9"
          placeholder="Ketik nama customer…"
          value={query}
          disabled={disabled}
          onChange={(event) => handleQuery(event.target.value)}
          onFocus={() => {
            if (query.trim() && query.trim() !== selectedLabel.current) setOpen(true);
          }}
        />
      </div>

      {showResults ? (
        <div
          id={`${id}-results`}
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-md"
        >
          {searching ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Mencari…</p>
          ) : failed ? (
            <p role="alert" className="px-3 py-2 text-sm text-destructive">
              {failed}
            </p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Tidak ada customer yang cocok.
            </p>
          ) : (
            <ul role="listbox" aria-label="Hasil pencarian customer" className="max-h-56 overflow-y-auto">
              {options.map((option) => (
                <li key={option.id} role="option" aria-selected={option.id === value}>
                  <button
                    type="button"
                    // Keep focus inside so the results box survives the click.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(option)}
                    className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {option.companyName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
