import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PhoneInputProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
  defaultCountryCode?: string; // e.g. "+260" for Zambia
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Phone input that nudges the user toward E.164 format. Defaults to +260 (Zambia)
 * but accepts any international number. Strips spaces/dashes/parentheses on save.
 */
export const PhoneInput = ({
  id,
  label,
  value,
  onChange,
  helper,
  defaultCountryCode = "+260",
  placeholder = "+260 97 1234567",
  disabled,
}: PhoneInputProps) => {
  const handleChange = (raw: string) => {
    let v = raw.replace(/[^\d+]/g, "");
    if (v && !v.startsWith("+")) {
      // If user typed leading 0, drop it and prepend default country code
      if (v.startsWith("0")) v = defaultCountryCode + v.slice(1);
      else v = defaultCountryCode + v;
    }
    onChange(v);
  };

  const handleBlur = () => {
    if (value && !value.startsWith("+")) {
      onChange(`${defaultCountryCode}${value.replace(/^0/, "")}`);
    }
  };

  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="tel"
      />
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
};

export default PhoneInput;
