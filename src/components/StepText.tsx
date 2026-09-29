import { Timer } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { detectTimers } from "../../shared/ingredients";
import { timerStore } from "../lib/stores";

/** Render step text with tappable timer chips wherever a duration is mentioned. */
export function StepText({ text, label, recipeId, className }: { text: string; label: string; recipeId?: string; className?: string }) {
  const timers = detectTimers(text);
  if (!timers.length) return <span className={className}>{text}</span>;
  const parts: ReactNode[] = [];
  let rest = text;
  let k = 0;
  for (const t of timers) {
    // Match the label in the original text, allowing unicode fractions to differ
    const idx = rest.toLowerCase().indexOf(t.label.toLowerCase());
    if (idx < 0) continue;
    parts.push(<Fragment key={k++}>{rest.slice(0, idx)}</Fragment>);
    parts.push(
      <button key={k++} type="button" className="timer-inline" onClick={() => timerStore.start(label, t.seconds, recipeId)} title={`Start a ${t.label} timer`}>
        <Timer size={14} strokeWidth={2.5} />
        {rest.slice(idx, idx + t.label.length)}
      </button>,
    );
    rest = rest.slice(idx + t.label.length);
  }
  parts.push(<Fragment key={k++}>{rest}</Fragment>);
  return <span className={className}>{parts}</span>;
}
