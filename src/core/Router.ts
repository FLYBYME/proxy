import { Route } from './Route';
import { RouteConfig } from '../types/models';
import * as tls from 'tls';

export class Router {
    private routes: Map<string, Route> = new Map();

    constructor() { }

    addRoute(config: RouteConfig): void {
        const route = new Route(config);
        // Handle wildcard domains or specific implementations here if needed
        this.routes.set(config.vHost, route);
    }

    removeRoute(vHost: string): boolean {
        const route = this.routes.get(vHost);
        if (route) {
            route.stop();
            return this.routes.delete(vHost);
        }
        return false;
    }

    stop(): void {
        for (const route of this.routes.values()) {
            route.stop();
        }
    }

    getRoute(vHost: string): Route | undefined {
        return this.routes.get(vHost);
    }

    getRoutes(): Route[] {
        return Array.from(this.routes.values());
    }

    // SNI Context Callback for https module
    getSNIContext(servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void): void {
        const route = this.getRoute(servername);
        if (!route || !route.config.ssl) {
            return cb(null, undefined); // No SSL context found
        }

        try {
            const ctx = tls.createSecureContext({
                key: route.config.ssl.key,
                cert: route.config.ssl.cert
            });
            cb(null, ctx);
        } catch (err: any) {
            cb(err);
        }
    }
}
