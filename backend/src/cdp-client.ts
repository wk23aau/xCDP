/**
 * CDP Client Module
 * Connects to Chrome via DevTools Protocol for navigation and advanced control
 */

// @ts-ignore - chrome-remote-interface types
import CDP from 'chrome-remote-interface';

interface CDPClient {
    Page: any;
    Runtime: any;
    Input: any;
    Network: any;
    Target: any;
    close: () => void;
}

interface CDPTarget {
    id: string;
    type: string;
    title: string;
    url: string;
    webSocketDebuggerUrl?: string;
}

let client: CDPClient | null = null;
let cdpPort = 9222;

/**
 * Connect to Chrome CDP
 */
export async function connectCDP(port = 9222): Promise<boolean> {
    cdpPort = port;
    try {
        const cdpClient: CDPClient = await CDP({ port });
        await Promise.all([
            cdpClient.Page.enable(),
            cdpClient.Network.enable(),
            cdpClient.Runtime.enable(),
        ]);
        client = cdpClient;
        console.log(`[CDP] Connected to Chrome on port ${port}`);
        return true;
    } catch (error) {
        console.error(`[CDP] Failed to connect:`, error);
        return false;
    }
}

/**
 * Disconnect from CDP
 */
export function disconnectCDP(): void {
    if (client) {
        client.close();
        client = null;
    }
}

/**
 * Check if CDP is connected
 */
export function isCDPConnected(): boolean {
    return client !== null;
}

/**
 * List all tabs via CDP
 */
export async function listCDPTargets(): Promise<CDPTarget[]> {
    try {
        const targets = await CDP.List({ port: cdpPort });
        return targets.filter((t: CDPTarget) => t.type === 'page');
    } catch (error) {
        console.error('[CDP] Failed to list targets:', error);
        return [];
    }
}

/**
 * Navigate to URL
 */
export async function navigate(url: string): Promise<boolean> {
    if (!client) {
        console.error('[CDP] Not connected');
        return false;
    }
    try {
        await client.Page.navigate({ url });
        await client.Page.loadEventFired();
        console.log(`[CDP] Navigated to ${url}`);
        return true;
    } catch (error) {
        console.error('[CDP] Navigation failed:', error);
        return false;
    }
}

/**
 * Navigate specific tab by targetId
 */
export async function navigateTab(targetId: string, url: string): Promise<boolean> {
    try {
        const tabClient = await CDP({ port: cdpPort, target: targetId });
        await tabClient.Page.enable();
        await tabClient.Page.navigate({ url });
        await tabClient.Page.loadEventFired();
        tabClient.close();
        console.log(`[CDP] Tab ${targetId} navigated to ${url}`);
        return true;
    } catch (error) {
        console.error('[CDP] Tab navigation failed:', error);
        return false;
    }
}

/**
 * Execute JavaScript in page
 */
export async function evaluate(expression: string): Promise<any> {
    if (!client) {
        throw new Error('CDP not connected');
    }
    const result = await client.Runtime.evaluate({ expression });
    return result.result.value;
}

/**
 * Type text using keyboard input
 */
export async function typeText(text: string): Promise<void> {
    if (!client) {
        throw new Error('CDP not connected');
    }
    for (const char of text) {
        await client.Input.dispatchKeyEvent({
            type: 'keyDown',
            key: char,
            text: char,
        });
        await client.Input.dispatchKeyEvent({
            type: 'keyUp',
            key: char,
        });
    }
}

/**
 * Press a key
 */
export async function pressKey(key: string): Promise<void> {
    if (!client) {
        throw new Error('CDP not connected');
    }
    await client.Input.dispatchKeyEvent({
        type: 'keyDown',
        key,
        code: key,
        windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : 0,
    });
    await client.Input.dispatchKeyEvent({
        type: 'keyUp',
        key,
        code: key,
    });
}

/**
 * Get current page info
 */
export async function getPageInfo(): Promise<{ url: string; title: string } | null> {
    if (!client) {
        return null;
    }
    try {
        const { result } = await client.Runtime.evaluate({
            expression: 'JSON.stringify({ url: window.location.href, title: document.title })',
        });
        return JSON.parse(result.value);
    } catch {
        return null;
    }
}

export default {
    connect: connectCDP,
    disconnect: disconnectCDP,
    isConnected: isCDPConnected,
    listTargets: listCDPTargets,
    navigate,
    navigateTab,
    evaluate,
    typeText,
    pressKey,
    getPageInfo,
};
