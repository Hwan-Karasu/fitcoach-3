import { useRef, useState } from "react";
import { View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { AppButton } from "./AppButton.tsx";
import { DropdownMenu, type DropdownOption } from "./DropdownMenu.tsx";

/** Searchable selection with a bounded, virtualized menu shared by plan source selectors. */
export function SearchableSelect({ title, value, options, onSelect, disabled = false }: Readonly<{
  title: string; value: string; options: readonly DropdownOption<string>[];
  onSelect: (value: string) => void; disabled?: boolean;
}>) {
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  return <View ref={anchor} collapsable={false}>
    <AppButton variant="secondary" label={`${title}: ${options.find((option) => option.value === value)?.label ?? "Выбрать"}`}
      disabled={disabled} icon={(color) => <ChevronDown size={20} color={color} />} onPress={() => setOpen(true)} />
    <DropdownMenu searchable visible={open} anchor={anchor} title={title} selected={value} options={options}
      onClose={() => setOpen(false)} onSelect={onSelect} />
  </View>;
}
