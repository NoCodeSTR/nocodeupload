"use client";

/**
 * AccentColorInput — a color swatch (native picker) paired with a hex text field
 * so users can either pick visually or paste a brand hex like `#2563eb` without
 * knowing its RGB. The native `<input type="color">` only accepts lowercase
 * `#rrggbb`, so the text field normalizes on blur/Enter (accepts with or without
 * `#`, and 3-digit shorthand) and reverts if the value isn't valid hex.
 */
import { useEffect, useState } from "react";

/** Normalize free-text hex to `#rrggbb`, or null if it isn't a valid color. */
export function normalizeHexColor(input: string): string | null {
  let v = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    v = v
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  return null;
}

interface AccentColorInputProps {
  value: string;
  onChange: (hex: string) => void;
}

export function AccentColorInput({ value, onChange }: AccentColorInputProps) {
  const [text, setText] = useState(value);

  // Keep the text field in sync when the value changes from outside (e.g. the
  // swatch, or an account default being applied).
  useEffect(() => setText(value), [value]);

  function commitText() {
    const hex = normalizeHexColor(text);
    if (hex) {
      onChange(hex);
      setText(hex);
    } else {
      setText(value); // revert invalid input
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-14 cursor-pointer rounded border border-ink-200 dark:border-ink-700"
        aria-label="Accent color"
      />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="#2563eb"
        maxLength={7}
        spellCheck={false}
        className="input h-10 w-28 font-mono text-sm"
        aria-label="Hex color code"
      />
    </div>
  );
}
