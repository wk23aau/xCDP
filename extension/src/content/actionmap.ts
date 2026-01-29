/**
 * ActionMap - Core perception engine
 * Extracts interactive candidates from the DOM with spatial and semantic information
 */

import type { ActionCandidate, Rect, ActionState, ActionContext, StyleHint, HitPoint } from '../shared/protocol';

// Interactive element selectors
const INTERACTIVE_SELECTORS = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="searchbox"]',
    '[role="textbox"]',
    '[tabindex]:not([tabindex="-1"])',
    '[onclick]',
    '[contenteditable="true"]',
    'summary',
    'details',
    'label[for]',
].join(', ');

// Element ID cache for stable identity
const elementIdMap = new WeakMap<Element, string>();
let idCounter = 0;

/**
 * Get or create a stable ID for an element
 */
export function getElementId(element: Element): string {
    let id = elementIdMap.get(element);
    if (!id) {
        // Try to use existing id attribute if unique
        const existingId = element.id;
        if (existingId && document.querySelectorAll(`#${CSS.escape(existingId)}`).length === 1) {
            id = `e_${existingId}`;
        } else {
            id = `a_${(idCounter++).toString(36)}`;
        }
        elementIdMap.set(element, id);
    }
    return id;
}

/**
 * Get element from its stable ID
 */
export function getElementById(id: string): Element | null {
    // Search through all tracked elements
    const allElements = document.querySelectorAll(INTERACTIVE_SELECTORS);
    for (const el of allElements) {
        if (elementIdMap.get(el) === id) {
            return el;
        }
    }
    return null;
}

/**
 * Get bounding rect in both px and normalized (0-1) coordinates
 */
function getRect(element: Element): { rect: Rect; rectN: Rect } {
    const bounds = element.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    return {
        rect: {
            x: Math.round(bounds.left),
            y: Math.round(bounds.top),
            w: Math.round(bounds.width),
            h: Math.round(bounds.height),
        },
        rectN: {
            x: bounds.left / vw,
            y: bounds.top / vh,
            w: bounds.width / vw,
            h: bounds.height / vh,
        },
    };
}

/**
 * Get the center hit point for clicking
 */
function getHitPoint(rect: Rect): HitPoint {
    return {
        cx: Math.round(rect.x + rect.w / 2),
        cy: Math.round(rect.y + rect.h / 2),
    };
}

/**
 * Check if element is visible in viewport
 */
function isVisible(element: Element, rect: Rect): boolean {
    if (rect.w === 0 || rect.h === 0) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;

    // Check if in viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.x + rect.w < 0 || rect.x > vw) return false;
    if (rect.y + rect.h < 0 || rect.y > vh) return false;

    return true;
}

/**
 * Check if element is occluded by another element at its center
 */
function isOccluded(element: Element, hit: HitPoint): boolean {
    const topElement = document.elementFromPoint(hit.cx, hit.cy);
    if (!topElement) return true;
    return !element.contains(topElement) && !topElement.contains(element) && topElement !== element;
}

/**
 * Get accessible name for element
 */
function getAccessibleName(element: Element): string {
    // aria-label takes precedence
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl) return labelEl.textContent?.trim() || '';
    }

    // For inputs, check associated label
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        const id = element.id;
        if (id) {
            const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (label) return label.textContent?.trim() || '';
        }
    }

    // title attribute
    const title = element.getAttribute('title');
    if (title) return title;

    // placeholder for inputs
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        if (element.placeholder) return element.placeholder;
    }

    // Text content (limited)
    const text = element.textContent?.trim() || '';
    return text.length > 50 ? text.substring(0, 50) + '...' : text;
}

/**
 * Get ARIA role for element
 */
function getRole(element: Element): string {
    // Explicit role
    const role = element.getAttribute('role');
    if (role) return role;

    // Implicit roles
    const tag = element.tagName.toLowerCase();
    switch (tag) {
        case 'a': return element.hasAttribute('href') ? 'link' : 'generic';
        case 'button': return 'button';
        case 'input': {
            const type = (element as HTMLInputElement).type;
            switch (type) {
                case 'button':
                case 'submit':
                case 'reset': return 'button';
                case 'checkbox': return 'checkbox';
                case 'radio': return 'radio';
                case 'range': return 'slider';
                case 'search': return 'searchbox';
                default: return 'textbox';
            }
        }
        case 'select': return element.hasAttribute('multiple') ? 'listbox' : 'combobox';
        case 'textarea': return 'textbox';
        case 'img': return 'img';
        case 'nav': return 'navigation';
        case 'main': return 'main';
        case 'header': return 'banner';
        case 'footer': return 'contentinfo';
        case 'aside': return 'complementary';
        case 'article': return 'article';
        case 'section': return 'region';
        default: return 'generic';
    }
}

/**
 * Get element state
 */
function getState(element: Element): ActionState {
    const htmlEl = element as HTMLElement;
    const inputEl = element as HTMLInputElement;

    return {
        disabled: htmlEl.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
        expanded: element.getAttribute('aria-expanded') === 'true',
        checked: inputEl.checked || element.getAttribute('aria-checked') === 'true',
        selected: (element as HTMLOptionElement).selected || element.getAttribute('aria-selected') === 'true',
        focused: document.activeElement === element,
    };
}

/**
 * Get element context
 */
function getContext(element: Element): ActionContext {
    const isInModal = !!element.closest('[role="dialog"], [role="alertdialog"], .modal, [aria-modal="true"]');
    const isInNav = !!element.closest('nav, [role="navigation"], [role="menu"], [role="menubar"]');
    const form = element.closest('form');

    // Calculate depth
    let depth = 0;
    let current: Element | null = element;
    while (current && current !== document.body) {
        depth++;
        current = current.parentElement;
    }

    return {
        inModal: isInModal,
        inNav: isInNav,
        inForm: !!form,
        depth,
        formId: form ? getElementId(form) : undefined,
    };
}

/**
 * Get style hints for element
 */
function getStyleHint(element: Element): StyleHint {
    const style = window.getComputedStyle(element);
    const bgColor = style.backgroundColor;
    const textColor = style.color;

    // Check for primary button styling
    const isPrimary = element.classList.contains('primary') ||
        element.classList.contains('btn-primary') ||
        element.getAttribute('data-variant') === 'primary' ||
        Boolean(bgColor && isHighContrastColor(bgColor));

    // Check for danger styling
    const isDanger = element.classList.contains('danger') ||
        element.classList.contains('btn-danger') ||
        element.classList.contains('destructive') ||
        element.getAttribute('data-variant') === 'danger' ||
        Boolean(bgColor && isRedColor(bgColor));

    return {
        isPrimary,
        isDanger,
        cursorPointer: style.cursor === 'pointer',
        backgroundColor: bgColor !== 'rgba(0, 0, 0, 0)' ? bgColor : undefined,
        textColor,
    };
}

function isHighContrastColor(color: string): boolean {
    // Simple heuristic for primary-looking colors
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return false;
    const [, r, g, b] = match.map(Number);
    // Check for saturated colors (not gray)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return (max - min) > 50 && max > 100;
}

function isRedColor(color: string): boolean {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return false;
    const [, r, g, b] = match.map(Number);
    return r > 150 && g < 100 && b < 100;
}

/**
 * Extract all action candidates from the current page
 */
export function extractActionMap(): ActionCandidate[] {
    const elements = document.querySelectorAll(INTERACTIVE_SELECTORS);
    const candidates: ActionCandidate[] = [];

    for (const element of elements) {
        const { rect, rectN } = getRect(element);

        // Skip invisible elements
        if (!isVisible(element, rect)) continue;

        const hit = getHitPoint(rect);
        const id = getElementId(element);
        const name = getAccessibleName(element);

        const candidate: ActionCandidate = {
            id,
            rect,
            rectN,
            role: getRole(element),
            tag: element.tagName.toLowerCase(),
            name,
            aria: element.getAttribute('aria-label') || '',
            placeholder: (element as HTMLInputElement).placeholder,
            value: (element as HTMLInputElement).value,
            href: (element as HTMLAnchorElement).href,
            state: getState(element),
            ctx: getContext(element),
            styleHint: getStyleHint(element),
            hit,
            occluded: isOccluded(element, hit),
        };

        candidates.push(candidate);
    }

    return candidates;
}

/**
 * Find candidate by search query (fuzzy text match)
 */
export function findCandidate(search: string, candidates: ActionCandidate[]): ActionCandidate | null {
    const query = search.toLowerCase();

    // Exact match on name or aria
    let match = candidates.find(c =>
        c.name.toLowerCase() === query ||
        c.aria.toLowerCase() === query
    );
    if (match) return match;

    // Partial match
    match = candidates.find(c =>
        c.name.toLowerCase().includes(query) ||
        c.aria.toLowerCase().includes(query)
    );
    if (match) return match;

    // Match by role + partial name
    const roleMatch = query.match(/^(\w+)\s+(.+)$/);
    if (roleMatch) {
        const [, role, text] = roleMatch;
        match = candidates.find(c =>
            c.role === role &&
            (c.name.toLowerCase().includes(text) || c.aria.toLowerCase().includes(text))
        );
        if (match) return match;
    }

    return null;
}

export { INTERACTIVE_SELECTORS };
