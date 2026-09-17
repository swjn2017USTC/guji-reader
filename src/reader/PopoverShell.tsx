import { flip, offset, shift, useFloating } from "@floating-ui/react";
import { useEffect, useMemo, type ReactNode } from "react";
import styles from "./PopoverShell.module.css";

/*
 * offset + collision handling. flip/shift are not optional here: in vertical
 * mode the marked text sits near the right edge (measured: mark x=1412 in a
 * 1512px viewport), and a 20rem popover without them renders off-screen with its
 * buttons out of reach.
 */
const MIDDLEWARE = [offset(8), flip(), shift({ padding: 8 })];

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
  const { refs, floatingStyles } = useFloating({ elements, middleware: MIDDLEWARE });

  useEffect(() => {
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
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [onClose, referenceElement, refs.floating]);

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className={styles.shell}
      role="dialog"
      aria-label={label}
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
