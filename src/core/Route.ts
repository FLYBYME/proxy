import { RouteConfig, ProxyRequest, Backend } from '../types/models';
import { LoadBalancer, RoundRobinLoadBalancer, RandomLoadBalancer, IPHashLoadBalancer } from './strategies/LoadBalancer';
import { BalancingStrategy } from '../types/models';
import { EventEmitter } from 'events';
import http from 'http';

export class Route extends EventEmitter {
    private lb: LoadBalancer;
    private queue: ProxyRequest[] = [];
    public activeRequests = 0;

    private healthCheckInterval: NodeJS.Timeout | null = null;

    constructor(public config: RouteConfig) {
        super();
        this.lb = this.createLoadBalancer(config.strategy, config.backends);
        this.startHealthCheck();
    }

    private createLoadBalancer(strategy: BalancingStrategy, backends: Backend[]): LoadBalancer {
        switch (strategy) {
            case BalancingStrategy.ROUND_ROBIN:
                return new RoundRobinLoadBalancer(backends);
            case BalancingStrategy.RANDOM:
                return new RandomLoadBalancer(backends);
            case BalancingStrategy.IP_HASH:
                return new IPHashLoadBalancer(backends);
            default:
                return new RoundRobinLoadBalancer(backends);
        }
    }

    updateConfig(newConfig: RouteConfig): void {
        this.config = newConfig;
        this.lb.updateBackends(newConfig.backends);
    }

    canHandleRequest(): boolean {
        return this.activeRequests < this.config.reqActiveLength;
    }

    canQueueRequest(): boolean {
        return this.queue.length < this.config.reqQueueLength;
    }

    enqueue(req: ProxyRequest): void {
        this.queue.push(req);
    }

    dequeue(): ProxyRequest | undefined {
        return this.queue.shift();
    }

    getNextBackend(req?: ProxyRequest): Backend | null {
        return this.lb.getNextBackend(req);
    }

    getQueueLength(): number {
        return this.queue.length;
    }

    markBackendFailure(backendId: string): void {
        const backend = this.config.backends.find(b => b.id === backendId);
        if (backend) {
            backend.failureCount++;
            if (backend.failureCount >= 3) {
                backend.isDead = true;
                backend.deadSince = Date.now();
            }
        }
    }

    private startHealthCheck(): void {
        if (this.healthCheckInterval) return;

        this.healthCheckInterval = setInterval(() => {
            const deadBackends = this.config.backends.filter(b => b.isDead);
            for (const backend of deadBackends) {
                this.checkBackendHealth(backend);
            }
        }, 10000).unref(); // Check every 10 seconds
    }

    private checkBackendHealth(backend: Backend): void {
        const options = {
            hostname: backend.hostname,
            port: backend.port,
            path: '/',
            method: 'GET',
            timeout: 2000
        };

        const req = http.request(options, (res) => {
            if (res.statusCode && res.statusCode < 500) {
                this.restoreBackend(backend);
            }
            res.resume(); // Consume response data
        });

        req.on('error', () => {
            // Still dead, do nothing
        });

        req.on('timeout', () => {
            req.destroy();
        });

        req.end();
    }

    private restoreBackend(backend: Backend): void {
        backend.isDead = false;
        backend.failureCount = 0;
        backend.deadSince = undefined;
    }

    stop(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
}
