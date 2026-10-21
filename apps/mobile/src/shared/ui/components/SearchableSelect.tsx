import { useRef, useState } from "react";
import { View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { AppButton } from "./AppButton.tsx";
import { DropdownMenu, type DropdownOption } from "./DropdownMenu.tsx";

/** Выбор с поиском и виртуализированным меню; общий для выбора источника плана. */
export function SearchableSelect({ title, value, options, onSelect, disabled = false, selectedLabel }: Readonly<{
  title: string; value: string; options: readonly DropdownOption<string>[];
  /** Короткая подпись кнопки, когда варианты в списке содержат дополнительные сведения. */
  selectedLabel?: string;
  onSelect: (value: string) => void; disabled?: boolean;
}>) {
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  return <View ref={anchor} collapsable={false}>
    <AppButton variant="secondary" label={`${title}: ${selectedLabel ?? options.find((option) => option.value === value)?.label ?? "Выбрать"}`}
      disabled={disabled} icon={(color) => <ChevronDown size={20} color={color} />} onPress={() => setOpen(true)} />
    <DropdownMenu searchable visible={open} anchor={anchor} title={title} selected={value} options={options}
      onClose={() => setOpen(false)} onSelect={onSelect} />
  </View>;
}
