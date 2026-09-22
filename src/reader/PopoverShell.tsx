import { useFloating } from "@floating-ui/react";
import { useEffect, useMemo, type KeyboardEvent, type ReactNode } from "react";
import { PANEL_MIDDLEWARE } from "./floatingPlacement";
import styles from "./PopoverShell.module.css";

type PopoverShellProps = {
  referenceElement: HTMLElement | null;
  /** Accessible name for the dialog role. */
  label: string;
  children: ReactNode;
  onClose: () => void;
};

/**
 * Shared chrome for the three reader popovers (AI 注釋, 古注, 個人標記).
 *
 * Owns floating placement, the card surface and click-outside dismissal, all of
 * which were identical across the three call sites. Content and per-layer
 * styling stay with each variant so the layers remain visually distinct.
 */
export function PopoverShell({
  referenceElement,
  label,
  children,
  onClose,
}: PopoverShellProps) {
  // Memoized: floating-ui recomputes whenever `elements` changes identity.
  const elements = useMemo(() => ({ reference: referenceElement }), [referenceElement]);
  const { refs, floatingStyles } = useFloating({ elements, middleware: PANEL_MIDDLEWARE });

  useEffect(() => {
    const firstControl = refs.floating.current?.querySelector<HTMLElement>(
      "button, textarea, input, [tabindex]:not([tabindex='-1'])",
    );
    firstControl?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (refs.floating.current?.contains(target)) {
        return;
      }
      if (referenceElement?.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      if (referenceElement?.isConnected) {
        referenceElement.focus();
      }
    };
  }, [onClose, referenceElement, refs.floating]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className={styles.shell}
      role="dialog"
      aria-label={label}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}

/** Dismiss control shared by every popover, so the affordance stays consistent. */
export function PopoverClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button type="button" className={styles.close} onClick={onClose} aria-label={label}>
      ×
    </button>
  );
}
