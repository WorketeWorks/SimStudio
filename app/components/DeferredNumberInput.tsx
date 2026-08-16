import { useEffect, useState } from "react";

type DeferredNumberInputProps = {
  value: number;
  min?: number;
  step?: number;
  onCommit: (value: number) => void;
};

/**
 * Numeric field that permits temporary text such as "-" or "1." while the
 * user is typing. The value is validated only on blur or Enter, preventing
 * React from erasing an incomplete negative number midway through editing.
 */

export function DeferredNumberInput({
  value,
  min,
  step = 0.01,
  onCommit,
}: DeferredNumberInputProps) {
  const [draft, setDraft] = useState(String(+value.toFixed(4)));

  useEffect(() => {
    // A different selected connector/collider supplies a new committed value.
    // Its draft must follow that external editor selection immediately.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(String(+value.toFixed(4)));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (Number.isFinite(parsed) && (min === undefined || parsed >= min)) onCommit(parsed);
    else setDraft(String(+value.toFixed(4)));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      data-step={step}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(+value.toFixed(4)));
          event.currentTarget.blur();
        }
      }}
    />
  );
}
