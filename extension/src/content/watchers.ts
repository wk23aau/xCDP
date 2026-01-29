/**
 * Watchers - Incremental DOM observation system
 * Uses MutationObserver, ResizeObserver, and IntersectionObserver to detect changes
 */

import type { ActionCandidate, ActionMapDelta } from '../shared/protocol';
import { extractActionMap, getElementId, INTERACTIVE_SELECTORS } from './actionmap';

type DeltaCallback = (delta: ActionMapDelta) => void;

let previousCandidates: Map<string, ActionCandidate> = new Map();
let deltaCallback: DeltaCallback | null = null;
let mutationObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let intersectionObserver: IntersectionObserver | null = null;
let isWatching = false;
let pendingUpdate = false;
let updateTimeout: number | null = null;

// Debounce time for updates (ms)
const UPDATE_DEBOUNCE = 50;

/**
 * Compare two candidates and return which fields changed
 */
function diffCandidate(
    oldCandidate: ActionCandidate,
    newCandidate: ActionCandidate
): Partial<ActionCandidate> | null {
    const changes: Partial<ActionCandidate> = {};
    let hasChanges = false;

    // Check rect changes (with tolerance)
    if (
        Math.abs(oldCandidate.rect.x - newCandidate.rect.x) > 2 ||
        Math.abs(oldCandidate.rect.y - newCandidate.rect.y) > 2 ||
        Math.abs(oldCandidate.rect.w - newCandidate.rect.w) > 2 ||
        Math.abs(oldCandidate.rect.h - newCandidate.rect.h) > 2
    ) {
        changes.rect = newCandidate.rect;
        changes.rectN = newCandidate.rectN;
        changes.hit = newCandidate.hit;
        hasChanges = true;
    }

    // Check state changes
    if (
        oldCandidate.state.disabled !== newCandidate.state.disabled ||
        oldCandidate.state.expanded !== newCandidate.state.expanded ||
        oldCandidate.state.checked !== newCandidate.state.checked ||
        oldCandidate.state.selected !== newCandidate.state.selected ||
        oldCandidate.state.focused !== newCandidate.state.focused
    ) {
        changes.state = newCandidate.state;
        hasChanges = true;
    }

    // Check name changes
    if (oldCandidate.name !== newCandidate.name) {
        changes.name = newCandidate.name;
        hasChanges = true;
    }

    // Check value changes
    if (oldCandidate.value !== newCandidate.value) {
        changes.value = newCandidate.value;
        hasChanges = true;
    }

    // Check occlusion changes
    if (oldCandidate.occluded !== newCandidate.occluded) {
        changes.occluded = newCandidate.occluded;
        hasChanges = true;
    }

    // Check context changes
    if (
        oldCandidate.ctx.inModal !== newCandidate.ctx.inModal ||
        oldCandidate.ctx.inNav !== newCandidate.ctx.inNav
    ) {
        changes.ctx = newCandidate.ctx;
        hasChanges = true;
    }

    return hasChanges ? changes : null;
}

/**
 * Compute delta between previous and current action map
 */
function computeDelta(currentCandidates: ActionCandidate[]): ActionMapDelta {
    const added: ActionCandidate[] = [];
    const removed: string[] = [];
    const updated: (Partial<ActionCandidate> & { id: string })[] = [];

    const currentMap = new Map(currentCandidates.map(c => [c.id, c]));

    // Find removed and updated
    for (const [id, oldCandidate] of previousCandidates) {
        const newCandidate = currentMap.get(id);
        if (!newCandidate) {
            removed.push(id);
        } else {
            const diff = diffCandidate(oldCandidate, newCandidate);
            if (diff) {
                updated.push({ id, ...diff });
            }
        }
    }

    // Find added
    for (const candidate of currentCandidates) {
        if (!previousCandidates.has(candidate.id)) {
            added.push(candidate);
        }
    }

    return {
        type: 'delta',
        tabId: 0, // Will be set by background script
        frameId: 0,
        timestamp: Date.now(),
        added,
        removed,
        updated,
    };
}

/**
 * Process pending updates and emit delta
 */
function processPendingUpdate() {
    if (!deltaCallback) return;
    pendingUpdate = false;
    updateTimeout = null;

    const currentCandidates = extractActionMap();
    const delta = computeDelta(currentCandidates);

    // Only emit if there are actual changes
    if (delta.added.length > 0 || delta.removed.length > 0 || delta.updated.length > 0) {
        deltaCallback(delta);
    }

    // Update previous state
    previousCandidates = new Map(currentCandidates.map(c => [c.id, c]));
}

/**
 * Schedule an update (debounced)
 */
function scheduleUpdate() {
    if (pendingUpdate) return;
    pendingUpdate = true;

    if (updateTimeout !== null) {
        clearTimeout(updateTimeout);
    }
    updateTimeout = window.setTimeout(processPendingUpdate, UPDATE_DEBOUNCE);
}

/**
 * Handle mutation events
 */
function handleMutations(mutations: MutationRecord[]) {
    // Check if any mutation affects interactive elements
    let hasRelevantChanges = false;

    for (const mutation of mutations) {
        if (mutation.type === 'childList') {
            // Check added/removed nodes
            for (const node of mutation.addedNodes) {
                if (node instanceof Element) {
                    if (node.matches(INTERACTIVE_SELECTORS) || node.querySelector(INTERACTIVE_SELECTORS)) {
                        hasRelevantChanges = true;
                        break;
                    }
                }
            }
            for (const node of mutation.removedNodes) {
                if (node instanceof Element) {
                    if (node.matches(INTERACTIVE_SELECTORS) || node.querySelector(INTERACTIVE_SELECTORS)) {
                        hasRelevantChanges = true;
                        break;
                    }
                }
            }
        } else if (mutation.type === 'attributes') {
            // Check if attribute change affects interactive state
            const attrName = mutation.attributeName;
            if (
                attrName === 'disabled' ||
                attrName === 'aria-disabled' ||
                attrName === 'aria-expanded' ||
                attrName === 'aria-checked' ||
                attrName === 'aria-selected' ||
                attrName === 'aria-label' ||
                attrName === 'class' ||
                attrName === 'style' ||
                attrName === 'hidden' ||
                attrName === 'value'
            ) {
                hasRelevantChanges = true;
                break;
            }
        }

        if (hasRelevantChanges) break;
    }

    if (hasRelevantChanges) {
        scheduleUpdate();
    }
}

/**
 * Handle resize events
 */
function handleResize(entries: ResizeObserverEntry[]) {
    // Any resize of the document body or main containers triggers update
    scheduleUpdate();
}

/**
 * Handle intersection changes
 */
function handleIntersection(entries: IntersectionObserverEntry[]) {
    // Visibility changes trigger update
    if (entries.some(e => e.isIntersecting !== undefined)) {
        scheduleUpdate();
    }
}

/**
 * Start watching for DOM changes
 */
export function startWatching(callback: DeltaCallback): ActionCandidate[] {
    if (isWatching) {
        stopWatching();
    }

    deltaCallback = callback;
    isWatching = true;

    // Initial extraction
    const candidates = extractActionMap();
    previousCandidates = new Map(candidates.map(c => [c.id, c]));

    // Set up MutationObserver
    mutationObserver = new MutationObserver(handleMutations);
    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
            'disabled',
            'aria-disabled',
            'aria-expanded',
            'aria-checked',
            'aria-selected',
            'aria-label',
            'class',
            'style',
            'hidden',
            'value',
        ],
    });

    // Set up ResizeObserver
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(document.body);

    // Set up IntersectionObserver for tracking visibility
    intersectionObserver = new IntersectionObserver(handleIntersection, {
        threshold: [0, 0.1, 0.5, 1],
    });

    // Observe all interactive elements
    for (const el of document.querySelectorAll(INTERACTIVE_SELECTORS)) {
        intersectionObserver.observe(el);
    }

    // Also watch for scroll events
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });

    return candidates;
}

/**
 * Stop watching for changes
 */
export function stopWatching() {
    isWatching = false;
    deltaCallback = null;

    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }

    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }

    if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
    }

    if (updateTimeout !== null) {
        clearTimeout(updateTimeout);
        updateTimeout = null;
    }

    window.removeEventListener('scroll', scheduleUpdate);
    window.removeEventListener('resize', scheduleUpdate);

    previousCandidates.clear();
}

/**
 * Force an immediate update
 */
export function forceUpdate() {
    if (!deltaCallback) return;
    processPendingUpdate();
}

/**
 * Get current watching status
 */
export function isCurrentlyWatching(): boolean {
    return isWatching;
}
