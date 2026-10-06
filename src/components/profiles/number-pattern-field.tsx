"use client";

// src/components/profiles/number-pattern-field.tsx
// Number-pattern input with real-time validation + preview. Imports the pure
// token parser (same module the server validates with), so what the user sees
// while typing is exactly what saveNumberingAction/updateProfileAction will
// accept. Includes the spec's fixed example: pattern
// INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3} for July 2026 → INV/SB/VII/2026/001.

import * as React from "react";
import {
  NUMBER_PATTERN_TOKENS,
  previewNumber,
  validateNumberPattern,
} from "@/modules/profiles/number-pattern";
import { useToday } from "@/lib/use-today";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EXAMPLE_PATTERN = "INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}";
const EXAMPLE_DATE = new Date(2026, 6, 1); // 1 Juli 2026 — fixed, no hydration risk
const EXAMPLE_NUMBER = previewNumber(EXAMPLE_PATTERN, {
  code: "SB",
  date: EXAMPLE_DATE,
  nextSequence: 1,
});

export interface NumberPatternFieldProps {
  /** Profile code used in the live preview ({CODE} token). */
  code: string;
  defaultValue: string;
  disabled?: boolean;
  id?: string;
  name?: string;
}

export function NumberPatternField({
  code,
  defaultValue,
  disabled,
  id = "numberPattern",
  name = "numberPattern",
}: NumberPatternFieldProps) {
  const [pattern, setPattern] = React.useState(defaultValue);
  const today = useToday();

  const validation = validateNumberPattern(pattern);
  const livePreview =
    validation.ok && today
      ? previewNumber(pattern, { code: code || "INV", date: today, nextSequence: 1 })
      : null;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Pola nomor invoice</Label>
      <Input
        id={id}
        name={name}
        value={pattern}
        onChange={(event) => setPattern(event.target.value)}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!validation.ok || undefined}
      />
      {validation.ok ? (
        <p className="text-sm text-muted-foreground">
          Pratinjau hari ini:{" "}
          <span className="font-medium tabular-nums text-foreground">{livePreview ?? "…"}</span>
        </p>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          {validation.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Token valid: {NUMBER_PATTERN_TOKENS.join(" ")} — tepat satu {"{SEQ:n}"} wajib ada.
      </p>
      <p className="text-xs text-muted-foreground">
        Contoh (Juli 2026, kode SB, pola {EXAMPLE_PATTERN}):{" "}
        <span className="font-medium tabular-nums text-foreground">{EXAMPLE_NUMBER}</span>
      </p>
    </div>
  );
}
