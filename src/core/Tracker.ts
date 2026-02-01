import { ProxyRequest } from '../types/models';

export interface RouteStats {
    requestsTotal: number;
    requestsActive: number;
    errorsTotal: number;
    avgLatencyMs: number;
}

export class Tracker {
    private stats: Map<string, RouteStats> = new Map();

    private getStats(vHost: string): RouteStats {
        if (!this.stats.has(vHost)) {
            this.stats.set(vHost, {
                requestsTotal: 0,
                requestsActive: 0,
                errorsTotal: 0,
                avgLatencyMs: 0
            });
        }
        return this.stats.get(vHost)!;
    }

    trackRequestStart(vHost: string): void {
        const s = this.getStats(vHost);
        s.requestsTotal++;
        s.requestsActive++;
    }

    trackRequestEnd(req: ProxyRequest, success: boolean): void {
        const s = this.getStats(req.meta.vHost);
        s.requestsActive = Math.max(0, s.requestsActive - 1);

        if (!success) {
            s.errorsTotal++;
        }

        const duration = Date.now() - req.startTime;
        // Simple moving average for latency
        s.avgLatencyMs = (s.avgLatencyMs * 0.9) + (duration * 0.1);
    }

    trackError(vHost: string, errorCode: string): void {
        const s = this.getStats(vHost);
        s.errorsTotal++;
    }

    getAllStats(): Map<string, RouteStats> {
        return this.stats;
    }

    getRouteStats(vHost: string): RouteStats | undefined {
        return this.stats.get(vHost);
    }

    removeStats(vHost: string): void {
        this.stats.delete(vHost);
    }
}
