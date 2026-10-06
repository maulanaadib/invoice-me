"use client";

// src/components/projects/currency-input.tsx
// Currency field per ui-context: renders the id-ID grouping ("Rp 450.000.000")
// while the form value stays the raw decimal string ("450000000"). Parsing and
// grouping are string-only — no float ever round-trips a rupiah amount.

import * as React from "react";
import { Input } from "@/components/ui/input";
import { groupDigits, ungroupDigits } from "@/lib/money";

export interface CurrencyInputProps {
  id: string;
  /** Raw decimal string held by the form ("450000000" | "450000.5"). */
  value: string;
  onValueChange: (raw: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-invalid"?: boolean;
}

export function CurrencyInput({
  id,
  value,
  onValueChange,
  disabled,
  placeholder,
  "aria-invalid": invalid,
}: CurrencyInputProps) {
  const [display, setDisplay] = React.useState(() => groupDigits(value));

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
      >
        Rp
      </span>
      <Input
        id={id}
        className="pr-3 pl-8 text-right font-mono"
        inputMode="decimal"
        autoComplete="off"
        value={display}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => {
          setDisplay(event.target.value);
          onValueChange(ungroupDigits(event.target.value));
        }}
        onBlur={() => {
          // Normalize grouping on the way out ("450000.5" → "450.000,5").
          setDisplay(groupDigits(ungroupDigits(display)));
        }}
      />
    </div>
  );
}
