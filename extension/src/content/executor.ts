/**
 * Executor - Command execution with verification
 * Handles hover, click, type, scroll, and other actions
 */

import type {
    Command,
    CommandAck,
    CommandAckOk,
    CommandAckFail,
    CommandAckVerify,
    HoverCommand,
    ClickCommand,
    TypeCommand,
    ScrollCommand,
    FocusCommand,
    SelectCommand,
    MoveMouseCommand,
    QueryCommand,
    Rect,
} from '../shared/protocol';
import { getElementById, extractActionMap, findCandidate, getElementId } from './actionmap';

/**
 * Create success acknowledgment
 */
function ackOk(commandId: string, result?: unknown): CommandAckOk {
    return {
        type: 'ack',
        commandId,
        status: 'ok',
        timestamp: Date.now(),
        result,
    };
}

/**
 * Create failure acknowledgment
 */
function ackFail(commandId: string, reason: string): CommandAckFail {
    return {
        type: 'ack',
        commandId,
        status: 'fail',
        reason,
        timestamp: Date.now(),
    };
}

/**
 * Create verification acknowledgment
 */
function ackVerify(
    commandId: string,
    id: string,
    element: Element | null
): CommandAckVerify {
    const stillVisible = element !== null;
    let hitTestOk = false;
    let rectChanged = false;
    let newRect: Rect | undefined;

    if (element) {
        const bounds = element.getBoundingClientRect();
        const cx = bounds.left + bounds.width / 2;
        const cy = bounds.top + bounds.height / 2;
        const topEl = document.elementFromPoint(cx, cy);
        hitTestOk = topEl === element || element.contains(topEl!) || topEl?.contains(element) || false;

        newRect = {
            x: Math.round(bounds.left),
            y: Math.round(bounds.top),
            w: Math.round(bounds.width),
            h: Math.round(bounds.height),
        };
    }

    return {
        type: 'ack',
        commandId,
        status: 'verify',
        timestamp: Date.now(),
        verification: {
            id,
            stillVisible,
            hitTestOk,
            rectChanged,
            newRect,
        },
    };
}

/**
 * Find element by ID or throw
 */
function findElement(id: string): Element {
    const element = getElementById(id);
    if (!element) {
        throw new Error(`Element not found: ${id}`);
    }
    return element;
}

/**
 * Simulate mouse event at element center
 */
function simulateMouseEvent(
    element: Element,
    eventType: string,
    options: Partial<MouseEventInit> = {}
): void {
    const bounds = element.getBoundingClientRect();
    const cx = bounds.left + bounds.width / 2;
    const cy = bounds.top + bounds.height / 2;

    const event = new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: cx,
        clientY: cy,
        screenX: cx + window.screenX,
        screenY: cy + window.screenY,
        ...options,
    });

    element.dispatchEvent(event);
}

/**
 * Execute hover command
 */
async function executeHover(cmd: HoverCommand): Promise<CommandAck> {
    try {
        const element = findElement(cmd.id);

        // Simulate mouse enter and move
        simulateMouseEvent(element, 'mouseenter');
        simulateMouseEvent(element, 'mouseover');
        simulateMouseEvent(element, 'mousemove');

        // Wait for any hover effects
        if (cmd.duration) {
            await new Promise(resolve => setTimeout(resolve, cmd.duration));
        }

        return ackVerify(cmd.commandId, cmd.id, element);
    } catch (error) {
        return ackFail(cmd.commandId, (error as Error).message);
    }
}

/**
 * Execute click command
 */
async function executeClick(cmd: ClickCommand): Promise<CommandAck> {
    try {
        const element = findElement(cmd.id);

        // Determine click options
        const button = cmd.button === 'right' ? 2 : cmd.button === 'middle' ? 1 : 0;
        const modifiers: Partial<MouseEventInit> = {
            button,
            ctrlKey: cmd.modifiers?.includes('ctrl'),
            shiftKey: cmd.modifiers?.includes('shift'),
            altKey: cmd.modifiers?.includes('alt'),
            metaKey: cmd.modifiers?.includes('meta'),
        };

        const clickCount = cmd.clickCount || 1;

        for (let i = 0; i < clickCount; i++) {
            // Full click sequence
            simulateMouseEvent(element, 'mousedown', { ...modifiers, detail: i + 1 });
            simulateMouseEvent(element, 'mouseup', { ...modifiers, detail: i + 1 });
            simulateMouseEvent(element, 'click', { ...modifiers, detail: i + 1 });
        }

        // For focusable elements, also focus them
        if (element instanceof HTMLElement &&
            (element.tabIndex >= 0 || element instanceof HTMLInputElement ||
                element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement)) {
            element.focus();
        }

        // Try native click as fallback for better compatibility
        if (element instanceof HTMLElement) {
            element.click();
        }

        return ackVerify(cmd.commandId, cmd.id, element);
    } catch (error) {
        return ackFail(cmd.commandId, (error as Error).message);
    }
}

/**
 * Execute type command
 */
async function executeType(cmd: TypeCommand): Promise<CommandAck> {
    try {
        const element = findElement(cmd.id);

        if (!(element instanceof HTMLInputElement) &&
            !(element instanceof HTMLTextAreaElement) &&
            !element.hasAttribute('contenteditable')) {
            return ackFail(cmd.commandId, 'Element is not typeable');
        }

        // Focus the element
        if (element instanceof HTMLElement) {
            element.focus();
        }

        // Handle contenteditable
        if (element.hasAttribute('contenteditable')) {
            if (cmd.clearFirst || cmd.mode === 'replace') {
                element.textContent = '';
            }

            // Type characters
            for (const char of cmd.text) {
                element.textContent += char;
                element.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: char,
                }));

                if (cmd.delay) {
                    await new Promise(resolve => setTimeout(resolve, cmd.delay));
                }
            }

            return ackOk(cmd.commandId);
        }

        // Handle input/textarea
        const inputEl = element as HTMLInputElement | HTMLTextAreaElement;

        if (cmd.clearFirst || cmd.mode === 'replace') {
            inputEl.value = '';
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Type characters with optional delay
        for (const char of cmd.text) {
            // Dispatch keydown
            inputEl.dispatchEvent(new KeyboardEvent('keydown', {
                key: char,
                bubbles: true,
                cancelable: true,
            }));

            // Update value based on mode
            if (cmd.mode === 'prepend') {
                inputEl.value = char + inputEl.value;
            } else {
                inputEl.value += char;
            }

            // Dispatch input event
            inputEl.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: char,
            }));

            // Dispatch keyup
            inputEl.dispatchEvent(new KeyboardEvent('keyup', {
                key: char,
                bubbles: true,
                cancelable: true,
            }));

            if (cmd.delay) {
                await new Promise(resolve => setTimeout(resolve, cmd.delay));
            }
        }

        // Dispatch change event
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));

        return ackOk(cmd.commandId, { value: inputEl.value });
    } catch (error) {
        return ackFail(cmd.commandId, (error as Error).message);
    }
}

/**
 * Execute scroll command
 */
async function executeScroll(cmd: ScrollCommand): Promise<CommandAck> {
    try {
        let target: Element | Window = window;

        if (cmd.target && cmd.target !== 'viewport') {
            const element = getElementById(cmd.target);
            if (!element) {
                return ackFail(cmd.commandId, `Scroll target not found: ${cmd.target}`);
            }
            target = element;
        }

        if (target === window) {
            window.scrollBy({
                left: cmd.dx,
                top: cmd.dy,
                behavior: 'smooth',
            });
        } else {
            (target as Element).scrollBy({
                left: cmd.dx,
                top: cmd.dy,
                behavior: 'smooth',
            });
        }

        // Wait for scroll to complete
        await new Promise(resolve => setTimeout(resolve, 300));

        return ackOk(cmd.commandId, {
            scrollX: window.scrollX,
            scrollY: window.scrollY,
        });
    } catch (error) {
        return ackFail(cmd.commandId, (error as Error).message);
    }
}

/**
 * Execute focus command
 */
async function executeFocus(cmd: FocusCommand): Promise<CommandAck> {
    try {
        const element = findElement(cmd.id);

        if (!(element instanceof HTMLElement)) {
            return ackFail(cmd.commandId, 'Element cannot be focused');
        }

        element.focus();

        return ackOk(cmd.commandId);
    } catch (error) {
        return ackFail(cmd.commandId, (error as Error).message);
    }
}

/**
 * Execute select command (for dropdowns)
 */
async function executeSelect(cmd: SelectCommand): Promise<CommandAck> {
    try {
        const element = findElement(cmd.id);

        if (!(element instanceof HTMLSelectElement)) {
            return ackFail(cmd.commandId, 'Element is not a select');
        }

        const values = Array.isArray(cmd.value) ? cmd.value : [cmd.value];

        // Clear previous selections for multiple select
        if (element.multiple) {
            for (const option of element.options) {
                option.selected = false;
            }
        }

        // Select matching options
        for (const option of element.options) {
            if (values.includes(option.value) || values.includes(option.textContent || '')) {
                option.selected = true;
                if (!element.multiple) break;
            }
        }

        // Dispatch change event
        element.dispatchEvent(new Event('change', { bubbles: true }));

        return ackOk(cmd.commandId, { value: element.value });
    } catch (error) {
        return ackFail(cmd.commandId, (error as Error).message);
    }
}

/**
 * Execute mouse move command
 */
async function executeMoveMouse(cmd: MoveMouseCommand): Promise<CommandAck> {
    try {
        const steps = cmd.steps || 10;
        const duration = cmd.duration || 200;
        const stepDelay = duration / steps;

        // Get current position (approximate - we don't have real cursor position)
        const startX = window.innerWidth / 2;
        const startY = window.innerHeight / 2;
        const targetX = cmd.x;
        const targetY = cmd.y;

        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let t = progress;

            // Apply easing
            if (cmd.curve === 'ease') {
                t = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            } else if (cmd.curve === 'bezier') {
                t = progress * progress * (3 - 2 * progress);
            }

            const x = startX + (targetX - startX) * t;
            const y = startY + (targetY - startY) * t;

            const event = new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
            });
            document.elementFromPoint(x, y)?.dispatchEvent(event);

            if (i < steps) {
                await new Promise(resolve => setTimeout(resolve, stepDelay));
            }
        }

        return ackOk(cmd.commandId);
    } catch (error) {
        return ackFail(cmd.commandId, (error as Error).message);
    }
}

/**
 * Execute query command
 */
async function executeQuery(cmd: QueryCommand): Promise<CommandAck> {
    try {
        const candidates = extractActionMap();

        // Apply filters
        let filtered = candidates;

        if (cmd.filters?.role) {
            filtered = filtered.filter(c => c.role === cmd.filters!.role);
        }
        if (cmd.filters?.tag) {
            filtered = filtered.filter(c => c.tag === cmd.filters!.tag);
        }
        if (cmd.filters?.visible !== undefined) {
            filtered = filtered.filter(c => !c.occluded === cmd.filters!.visible);
        }
        if (cmd.filters?.enabled !== undefined) {
            filtered = filtered.filter(c => !c.state.disabled === cmd.filters!.enabled);
        }

        // Search by text
        if (cmd.search) {
            const match = findCandidate(cmd.search, filtered);
            if (match) {
                return ackOk(cmd.commandId, { matches: [match] });
            }

            // Return partial matches
            const query = cmd.search.toLowerCase();
            const matches = filtered.filter(c =>
                c.name.toLowerCase().includes(query) ||
                c.aria.toLowerCase().includes(query)
            );
            return ackOk(cmd.commandId, { matches: matches.slice(0, 10) });
        }

        return ackOk(cmd.commandId, { matches: filtered.slice(0, 20) });
    } catch (error) {
        return ackFail(cmd.commandId, (error as Error).message);
    }
}

/**
 * Execute a command
 */
export async function executeCommand(command: Command): Promise<CommandAck> {
    switch (command.type) {
        case 'hover':
            return executeHover(command);
        case 'click':
            return executeClick(command);
        case 'type':
            return executeType(command);
        case 'scroll':
            return executeScroll(command);
        case 'focus':
            return executeFocus(command);
        case 'select':
            return executeSelect(command);
        case 'move_mouse':
            return executeMoveMouse(command);
        case 'query':
            return executeQuery(command);
        case 'capture_patch':
            // Not implemented in content script - requires background script
            return ackFail(command.commandId, 'capture_patch not implemented');
        default:
            return ackFail((command as Command).commandId, `Unknown command type`);
    }
}
