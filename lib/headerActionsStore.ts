/**
 * v1.1.55: Tiny client-side store that lets a project page register the
 * Copy PPT Prompt / Export Full Report / Run refresh actions so the GLOBAL
 * header (rendered in app/layout.tsx) can surface them next to the
 * "All Projects" link.
 *
 * Why not React Context? The header lives in the root layout (server
 * boundary above the page tree); plumbing context through would require
 * lifting state to a client-only RootShell. A module-level subscription
 * store keeps the boundary small: only `HeaderActions` (a tiny client
 * component) needs to subscribe, and the `Dashboard` registers from a
 * useEffect with no extra wrappers.
 *
 * Lifecycle: the Dashboard calls `setHeaderActions(...)` whenever its
 * latest metrics / refreshing state / project info changes, and calls
 * `clearHeaderActions()` on unmount so the buttons disappear when the user
 * navigates back to the Projects index.
 */
"use client";

import { useSyncExternalStore } from "react";

export interface HeaderActionsState {
  /** Optional human-readable project label rendered next to the buttons. */
  projectLabel?: string;
  /** Project UUID — used by HeaderActions to build the /projects/[id]/edit URL. */
  projectId?: string;
  /** True while the dashboard's refresh request is in flight. Drives the
   *  disabled state + label swap on the Run refresh button. */
  refreshing: boolean;
  /** Latest snapshot metrics. When falsy, the Copy PPT Prompt button is
   *  disabled (there's no snapshot yet to build a prompt from). */
  hasMetrics: boolean;
  /** Handlers — owned by Dashboard. The store doesn't know anything about
   *  PDF generation or clipboard APIs; it just routes clicks back to the
   *  page that's actually mounted. */
  onRunRefresh: () => void;
  onExportReport: () => Promise<void> | void;
  onCopyPptPrompt: () => Promise<void> | void;
}

let state: HeaderActionsState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Called by Dashboard on every render where the underlying inputs change.
 *  Cheap to call: only triggers subscribers if at least one shallow field
 *  differs from the previous snapshot. */
export function setHeaderActions(next: HeaderActionsState) {
  // Shallow-equal short-circuit so re-renders inside the dashboard don't
  // wake up the header subscriber on every keystroke.
  if (
    state &&
    state.projectLabel === next.projectLabel &&
    state.projectId === next.projectId &&
    state.refreshing === next.refreshing &&
    state.hasMetrics === next.hasMetrics &&
    state.onRunRefresh === next.onRunRefresh &&
    state.onExportReport === next.onExportReport &&
    state.onCopyPptPrompt === next.onCopyPptPrompt
  ) {
    return;
  }
  state = next;
  emit();
}

/** Called on Dashboard unmount so the header buttons disappear when the
 *  user navigates away from a project. */
export function clearHeaderActions() {
  if (state === null) return;
  state = null;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): HeaderActionsState | null {
  return state;
}

// SSR snapshot — header always renders empty on the server, then hydrates.
function getServerSnapshot(): HeaderActionsState | null {
  return null;
}

/** Subscribe to the current header-actions state. Returns null when no
 *  project page has registered actions (i.e. we're on the Projects index
 *  or any non-project route). */
export function useHeaderActions(): HeaderActionsState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
