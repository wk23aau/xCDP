/**
 * World State Store
 * In-memory storage for ActionMaps, deltas, and tab state
 */

import type {
    ActionCandidate,
    ActionMapSnapshot,
    ActionMapDelta,
    HelloMessage,
} from './protocol.js';

export interface TabState {
    tabId: number;
    url: string;
    viewport: { width: number; height: number };
    userAgent: string;
    connectedAt: number;
    lastUpdate: number;
    candidates: Map<string, ActionCandidate>;
    deltaHistory: ActionMapDelta[];
}

export interface WorldState {
    tabs: Map<number, TabState>;
    pointer: { x: number; y: number; buttons: number } | null;
}

// Global state
const state: WorldState = {
    tabs: new Map(),
    pointer: null,
};

// Delta history limit
const MAX_DELTA_HISTORY = 50;

/**
 * Handle hello message from tab
 */
export function handleHello(message: HelloMessage): TabState {
    const existing = state.tabs.get(message.tabId);

    const tabState: TabState = {
        tabId: message.tabId,
        url: message.url,
        viewport: message.viewport,
        userAgent: message.userAgent,
        connectedAt: existing?.connectedAt || Date.now(),
        lastUpdate: Date.now(),
        candidates: existing?.candidates || new Map(),
        deltaHistory: existing?.deltaHistory || [],
    };

    state.tabs.set(message.tabId, tabState);
    return tabState;
}

/**
 * Handle snapshot message - replace entire candidate list
 */
export function handleSnapshot(snapshot: ActionMapSnapshot): TabState | null {
    let tabState = state.tabs.get(snapshot.tabId);

    if (!tabState) {
        // Create new tab state
        tabState = {
            tabId: snapshot.tabId,
            url: snapshot.url,
            viewport: snapshot.viewport,
            userAgent: '',
            connectedAt: Date.now(),
            lastUpdate: Date.now(),
            candidates: new Map(),
            deltaHistory: [],
        };
        state.tabs.set(snapshot.tabId, tabState);
    }

    // Clear and rebuild candidates
    tabState.candidates.clear();
    for (const candidate of snapshot.candidates) {
        tabState.candidates.set(candidate.id, candidate);
    }

    tabState.url = snapshot.url;
    tabState.viewport = snapshot.viewport;
    tabState.lastUpdate = Date.now();

    // Clear delta history on full snapshot
    tabState.deltaHistory = [];

    return tabState;
}

/**
 * Handle delta message - apply incremental updates
 */
export function handleDelta(delta: ActionMapDelta): TabState | null {
    const tabState = state.tabs.get(delta.tabId);

    if (!tabState) {
        console.warn(`Delta received for unknown tab: ${delta.tabId}`);
        return null;
    }

    // Apply removals
    for (const id of delta.removed) {
        tabState.candidates.delete(id);
    }

    // Apply additions
    for (const candidate of delta.added) {
        tabState.candidates.set(candidate.id, candidate);
    }

    // Apply updates
    for (const update of delta.updated) {
        if (!update.id) continue;
        const existing = tabState.candidates.get(update.id);
        if (existing) {
            Object.assign(existing, update);
        }
    }

    tabState.lastUpdate = Date.now();

    // Store delta in history
    tabState.deltaHistory.push(delta);
    if (tabState.deltaHistory.length > MAX_DELTA_HISTORY) {
        tabState.deltaHistory.shift();
    }

    return tabState;
}

/**
 * Handle tab disconnect
 */
export function handleDisconnect(tabId: number): void {
    state.tabs.delete(tabId);
}

/**
 * Update pointer state
 */
export function updatePointer(x: number, y: number, buttons: number): void {
    state.pointer = { x, y, buttons };
}

/**
 * Get all tabs
 */
export function getTabs(): TabState[] {
    return Array.from(state.tabs.values());
}

/**
 * Get specific tab state
 */
export function getTab(tabId: number): TabState | undefined {
    return state.tabs.get(tabId);
}

/**
 * Get candidates for tab
 */
export function getCandidates(tabId: number): ActionCandidate[] {
    const tabState = state.tabs.get(tabId);
    return tabState ? Array.from(tabState.candidates.values()) : [];
}

/**
 * Get candidate by ID
 */
export function getCandidate(tabId: number, candidateId: string): ActionCandidate | undefined {
    const tabState = state.tabs.get(tabId);
    return tabState?.candidates.get(candidateId);
}

/**
 * Search candidates by text
 */
export function searchCandidates(
    tabId: number,
    search: string,
    filters?: { role?: string; tag?: string; visible?: boolean; enabled?: boolean }
): ActionCandidate[] {
    const candidates = getCandidates(tabId);
    const query = search.toLowerCase();

    return candidates.filter(c => {
        // Apply text search
        if (search && !c.name.toLowerCase().includes(query) &&
            !c.aria.toLowerCase().includes(query) &&
            !c.id.toLowerCase().includes(query)) {
            return false;
        }

        // Apply filters
        if (filters?.role && c.role !== filters.role) return false;
        if (filters?.tag && c.tag !== filters.tag) return false;
        if (filters?.visible !== undefined && c.occluded === filters.visible) return false;
        if (filters?.enabled !== undefined && c.state.disabled === filters.enabled) return false;

        return true;
    });
}

/**
 * Get world state summary
 */
export function getWorldSummary() {
    return {
        tabCount: state.tabs.size,
        tabs: Array.from(state.tabs.values()).map(t => ({
            tabId: t.tabId,
            url: t.url,
            candidateCount: t.candidates.size,
            lastUpdate: t.lastUpdate,
        })),
        pointer: state.pointer,
    };
}

/**
 * Clear all state
 */
export function clearState(): void {
    state.tabs.clear();
    state.pointer = null;
}

export { state };
