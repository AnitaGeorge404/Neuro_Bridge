/**
 * InterventionModal.jsx — Role 3 Accessible Intervention Dialog Overlay
 *
 * Hosts the resolved intervention component with clean responsive framing,
 * background backdrop blur, escape key handling, and seamless exit transitions.
 */

import { useRef } from "react";
import { X } from "lucide-react";
import InterventionResolver from "./InterventionResolver";
import useDialogA11y from "@/hooks/useDialogA11y";

export default function InterventionModal({
  isOpen,
  recommendationId,
  onClose,
  onComplete,
  autoStart = false,
}) {
  const overlayRef = useRef(null);

  // Focus trap, Escape-to-close, initial focus, and focus restoration —
  // shared with the other hand-rolled modals (ACTSOSModal, JITAIOverlay).
  useDialogA11y(overlayRef, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Intervention"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl animate-in zoom-in-95 duration-200">
        {/* Top close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close intervention"
          className="sticky top-2 float-right mr-2 z-10 grid h-11 w-11 -mb-11 place-items-center rounded-full border border-slate-200 bg-white shadow-md text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <X size={18} />
        </button>

        {/* Resolved Intervention Content */}
        <InterventionResolver
          recommendationId={recommendationId}
          onComplete={(result) => {
            onComplete?.(result);
            onClose?.();
          }}
          onCancel={onClose}
          autoStart={autoStart}
        />
      </div>
    </div>
  );
}
