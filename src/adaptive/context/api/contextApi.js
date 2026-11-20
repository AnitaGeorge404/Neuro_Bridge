/**
 * contextApi.js — Unified Context API & Service Contract
 *
 * Part of the Context & Perception Engine for NeuroBridge V2.
 *
 * Provides the clean REST API endpoint handler and client service interface for external modules
 * (such as the Adaptive Intelligence layer, User State Model, and frontend components)
 * to retrieve the public ContextSnapshot.
 *
 * ENDPOINT:
 * GET /api/context/current
 *
 * Ownership: Context & Perception Engineer
 */

import { fuseContext } from "../contextFusion.js";
import { toContextSnapshot } from "../contextSnapshotAdapter.js";

/**
 * Express / Vite / Service handler for GET /api/context/current.
 * Answers: "What do we currently know about the user right now and how fresh/reliable is it?"
 *
 * @param {object} [req] - Optional HTTP request object
 * @returns {{ status: string, statusCode: number, timestamp: string, data: import("../types/contextTypes.js").ContextSnapshot }}
 */
export function handleGetContextSnapshot(req = {}) {
  const timestamp = new Date().toISOString();
  const unifiedContext = fuseContext({});
  const contextSnapshot = toContextSnapshot(unifiedContext);

  return {
    status: "success",
    statusCode: 200,
    timestamp,
    data: contextSnapshot,
  };
}

/**
 * Client service helper for Adaptive Intelligence modules to retrieve the current context snapshot.
 *
 * This context engine is entirely client-side (in-browser interaction tracking, mood inference,
 * etc.) — there has never been a real GET /api/context/current route on the backend to serve it
 * (handleGetContextSnapshot above is a facade for a server this app doesn't have), so a remote
 * fetch here can only ever 404. ContextProvider.jsx calls this on every route change and on every
 * tracked user interaction, so that dead network attempt was firing constantly in production —
 * wasted round-trips client-side and 404 log spam server-side, before silently falling back to
 * the exact same local result it could resolve immediately. Always resolve locally.
 *
 * @returns {Promise<import("../types/contextTypes.js").ContextSnapshot>}
 */
export async function getContextSnapshotAPI() {
  const res = handleGetContextSnapshot();
  return res.data;
}

export const handleGetUnifiedContext = handleGetContextSnapshot;
export const getUnifiedContextAPI = getContextSnapshotAPI;
