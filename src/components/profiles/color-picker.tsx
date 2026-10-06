"use client";

// src/components/profiles/color-picker.tsx
// Accent-color picker: preset swatches + native color input + hex field.
// Controlled — the parent renders the invoice preview with the live value,
// so picking a color visibly re-themes the sample before anything is saved.

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESETS = [
  "#2563eb",
  "#0f766e",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
  "#b45309",
  "#1f2937",
];

export interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

export function ColorPicker({ value, onChange, disabled, id = "primaryColor" }: ColorPickerProps) {
  const isHex = /^#[0-9a-fA-F]{6}$/.test(value);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Warna utama</Label>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={disabled}
            aria-label={`Pilih warna ${preset}`}
            onClick={() => onChange(preset)}
            className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
              value.toLowerCase() === preset ? "border-foreground" : "border-transparent"
            }`}
            style={{ backgroundColor: preset }}
          />
        ))}
        <input
          type="color"
          value={isHex ? value : "#2563eb"}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label="Pilih warna kustom"
          className="h-8 w-10 cursor-pointer rounded border border-border bg-background p-0.5"
        />
      </div>
      <Input
        id={id}
        name="primaryColor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        className="max-w-[10rem] font-mono"
        aria-invalid={!isHex || undefined}
      />
      {!isHex ? (
        <p role="alert" className="text-sm text-destructive">
          Warna harus berformat #RRGGBB (mis. #2563eb).
        </p>
      ) : null}
    </div>
  );
}
