/**
 * Policy & Safety Layer
 * Domain filtering, action blocking, and rate limiting
 */

import type { Command } from './protocol.js';

export interface PolicyConfig {
    // Domain filtering
    domainMode: 'allowlist' | 'blocklist' | 'all';
    domainList: string[];

    // Action safety
    blockPaymentActions: boolean;
    blockDeleteActions: boolean;
    requireUserPresent: boolean;

    // Rate limiting
    maxCommandsPerSecond: number;
    maxCommandsPerMinute: number;

    // Logging
    logAllCommands: boolean;
}

const defaultConfig: PolicyConfig = {
    domainMode: 'all',
    domainList: [],
    blockPaymentActions: true,
    blockDeleteActions: true,
    requireUserPresent: false,
    maxCommandsPerSecond: 10,
    maxCommandsPerMinute: 300,
    logAllCommands: true,
};

let config: PolicyConfig = { ...defaultConfig };

// Rate limiting state
const commandHistory: number[] = [];

// Dangerous patterns
const PAYMENT_PATTERNS = [
    /checkout/i,
    /payment/i,
    /purchase/i,
    /buy\s*now/i,
    /place\s*order/i,
    /confirm\s*order/i,
    /submit\s*order/i,
    /pay\s*\$/i,
];

const DELETE_PATTERNS = [
    /delete/i,
    /remove/i,
    /clear\s*all/i,
    /destroy/i,
    /erase/i,
];

/**
 * Update policy configuration
 */
export function updatePolicy(newConfig: Partial<PolicyConfig>): void {
    config = { ...config, ...newConfig };
}

/**
 * Get current policy configuration
 */
export function getPolicy(): PolicyConfig {
    return { ...config };
}

/**
 * Reset to default policy
 */
export function resetPolicy(): void {
    config = { ...defaultConfig };
}

/**
 * Check if domain is allowed
 */
export function isDomainAllowed(url: string): boolean {
    if (config.domainMode === 'all') return true;

    try {
        const domain = new URL(url).hostname.toLowerCase();
        const matches = config.domainList.some(d =>
            domain === d.toLowerCase() || domain.endsWith('.' + d.toLowerCase())
        );

        return config.domainMode === 'allowlist' ? matches : !matches;
    } catch {
        return false;
    }
}

/**
 * Check if action targets payment-related element
 */
function isPaymentAction(command: Command, elementName?: string): boolean {
    if (!config.blockPaymentActions) return false;
    if (!elementName) return false;

    return PAYMENT_PATTERNS.some(pattern => pattern.test(elementName));
}

/**
 * Check if action targets delete-related element
 */
function isDeleteAction(command: Command, elementName?: string): boolean {
    if (!config.blockDeleteActions) return false;
    if (!elementName) return false;

    return DELETE_PATTERNS.some(pattern => pattern.test(elementName));
}

/**
 * Check rate limits
 */
function checkRateLimits(): { allowed: boolean; reason?: string } {
    const now = Date.now();

    // Clean old entries
    const oneMinuteAgo = now - 60000;
    while (commandHistory.length > 0 && commandHistory[0] < oneMinuteAgo) {
        commandHistory.shift();
    }

    // Check per-minute limit
    if (commandHistory.length >= config.maxCommandsPerMinute) {
        return { allowed: false, reason: 'Rate limit exceeded (per minute)' };
    }

    // Check per-second limit
    const oneSecondAgo = now - 1000;
    const recentCommands = commandHistory.filter(t => t > oneSecondAgo).length;
    if (recentCommands >= config.maxCommandsPerSecond) {
        return { allowed: false, reason: 'Rate limit exceeded (per second)' };
    }

    return { allowed: true };
}

/**
 * Record command execution
 */
function recordCommand(): void {
    commandHistory.push(Date.now());
}

export interface PolicyCheckResult {
    allowed: boolean;
    reason?: string;
    warnings?: string[];
}

/**
 * Check if command is allowed by policy
 */
export function checkCommand(
    command: Command,
    tabUrl?: string,
    elementName?: string
): PolicyCheckResult {
    const warnings: string[] = [];

    // Check domain
    if (tabUrl && !isDomainAllowed(tabUrl)) {
        return {
            allowed: false,
            reason: `Domain not allowed: ${tabUrl}`
        };
    }

    // Check rate limits
    const rateCheck = checkRateLimits();
    if (!rateCheck.allowed) {
        return { allowed: false, reason: rateCheck.reason };
    }

    // Check for dangerous actions (only for click/type)
    if (command.type === 'click' || command.type === 'type') {
        if (isPaymentAction(command, elementName)) {
            return {
                allowed: false,
                reason: `Payment action blocked: ${elementName}`
            };
        }

        if (isDeleteAction(command, elementName)) {
            return {
                allowed: false,
                reason: `Delete action blocked: ${elementName}`
            };
        }
    }

    // Record command and allow
    recordCommand();

    if (config.logAllCommands) {
        console.log(`[Policy] Command allowed: ${command.type} ${(command as any).id || ''}`);
    }

    return { allowed: true, warnings };
}

/**
 * Log command for audit
 */
export function logCommand(command: Command, result: 'success' | 'fail', details?: string): void {
    if (!config.logAllCommands) return;

    const entry = {
        timestamp: new Date().toISOString(),
        commandId: command.commandId,
        type: command.type,
        tabId: command.tabId,
        result,
        details,
    };

    console.log('[Audit]', JSON.stringify(entry));
}

/**
 * Get rate limit status
 */
export function getRateLimitStatus() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneSecondAgo = now - 1000;

    const commandsLastMinute = commandHistory.filter(t => t > oneMinuteAgo).length;
    const commandsLastSecond = commandHistory.filter(t => t > oneSecondAgo).length;

    return {
        commandsLastSecond,
        commandsLastMinute,
        maxPerSecond: config.maxCommandsPerSecond,
        maxPerMinute: config.maxCommandsPerMinute,
        remaining: {
            perSecond: config.maxCommandsPerSecond - commandsLastSecond,
            perMinute: config.maxCommandsPerMinute - commandsLastMinute,
        },
    };
}
