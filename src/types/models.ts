import { IncomingMessage, ServerResponse } from 'http';

// Enums for strategies
export enum BalancingStrategy {
    ROUND_ROBIN = 'ROUND_ROBIN',
    IP_HASH = 'IP_HASH',
    RANDOM = 'RANDOM',
    LEAST_LATENCY = 'LEAST_LATENCY'
}

// A backend server (Target)
export interface Backend {
    id: string;
    hostname: string; // IP or Domain
    port: number;
    weight?: number; // For future weighted strategies

    // Runtime state
    isDead: boolean;
    deadSince?: number;
    failureCount: number;
}

// A Virtual Host Route
export interface RouteConfig {
    id: string;
    vHost: string; // e.g., "api.example.com" or "*.example.com"
    strategy: BalancingStrategy;

    // Settings
    autoHttps: boolean;
    reqQueueLength: number; // Max queued requests
    reqActiveLength: number; // Max concurrent requests

    // Security
    authProvider?: string; // Reference to auth service
    headers?: Record<string, string>; // Custom headers to inject

    backends: Backend[];

    // SSL Context (optional)
    ssl?: {
        key: string;
        cert: string;
    };

    // Custom Timeouts
    timeout?: number;
    proxyTimeout?: number;
}

export interface Routes {
    routes: RouteConfig[];
}

export interface ProxyRequest {
    id: string;
    req: IncomingMessage;
    res: ServerResponse;
    startTime: number;
    retries: number;
    meta: {
        vHost: string;
        clientIp: string;
        targetId?: string;
        isEnded?: boolean;
    };
}
