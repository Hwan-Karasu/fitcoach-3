import type { ComponentProps } from "react";
import { TextField } from "./TextField.tsx";
import type { DecimalPolicy } from "./numeric-draft.ts";

interface NumericFieldProps extends Omit<ComponentProps<typeof TextField>, "value" | "onChangeText" | "keyboardType"> {
  readonly rawValue: string;
  readonly onChangeRawValue: (value: string) => void;
  readonly unit: string;
  readonly decimalPolicy?: DecimalPolicy;
}

export function NumericField({
  rawValue,
  onChangeRawValue,
  unit,
  decimalPolicy = "decimal",
  label,
  hint,
  ...rest
}: Readonly<NumericFieldProps>) {
  return (
    <TextField
      {...rest}
      label={`${label}, ${unit}`}
      hint={hint ?? (decimalPolicy === "decimal" ? "Можно ввести точку или запятую" : undefined)}
      value={rawValue}
      onChangeText={onChangeRawValue}
      keyboardType={decimalPolicy === "decimal" ? "decimal-pad" : "number-pad"}
    />
  );
}
