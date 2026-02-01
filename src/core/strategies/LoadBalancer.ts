import { Backend, ProxyRequest } from '../../types/models';

export abstract class LoadBalancer {
    constructor(protected backends: Backend[]) { }

    abstract getNextBackend(req?: ProxyRequest): Backend | null;

    updateBackends(backends: Backend[]): void {
        this.backends = backends;
    }

    protected getAliveBackends(): Backend[] {
        return this.backends.filter(b => !b.isDead);
    }
}

export class RoundRobinLoadBalancer extends LoadBalancer {
    private counter = 0;

    getNextBackend(req?: ProxyRequest): Backend | null {
        const alive = this.getAliveBackends();
        if (alive.length === 0) return null;

        const backend = alive[this.counter % alive.length];
        this.counter = (this.counter + 1) % alive.length;
        return backend;
    }
}

export class RandomLoadBalancer extends LoadBalancer {
    getNextBackend(req?: ProxyRequest): Backend | null {
        const alive = this.getAliveBackends();
        if (alive.length === 0) return null;

        const index = Math.floor(Math.random() * alive.length);
        return alive[index];
    }
}

export class IPHashLoadBalancer extends LoadBalancer {
    getNextBackend(req?: ProxyRequest): Backend | null {
        const alive = this.getAliveBackends();
        if (alive.length === 0) return null;

        if (!req) {
            // Fallback to round robin if no request context
            return alive[0];
        }

        const ip = req.meta.clientIp || '0.0.0.0';
        let hash = 0;
        for (let i = 0; i < ip.length; i++) {
            const char = ip.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }

        const index = Math.abs(hash) % alive.length;
        return alive[index];
    }
}
