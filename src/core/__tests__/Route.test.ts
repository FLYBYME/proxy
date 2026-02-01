import { Route } from '../Route';
import { BalancingStrategy, RouteConfig, ProxyRequest } from '../../types/models';
import { IncomingMessage, ServerResponse } from 'http';

describe('Route', () => {
    let route: Route;
    const mockConfig: RouteConfig = {
        id: '1',
        vHost: 'test.com',
        strategy: BalancingStrategy.ROUND_ROBIN,
        autoHttps: false,
        reqQueueLength: 2,
        reqActiveLength: 2,
        backends: [
            { id: 'b1', hostname: 'host1', port: 80, isDead: false, failureCount: 0 },
            { id: 'b2', hostname: 'host2', port: 80, isDead: false, failureCount: 0 }
        ]
    };

    beforeEach(() => {
        route = new Route(mockConfig);
    });

    afterEach(() => {
        route.stop();
    });

    test('should allow handling request if under limit', () => {
        expect(route.canHandleRequest()).toBe(true);
        route.activeRequests = 2;
        expect(route.canHandleRequest()).toBe(false);
    });

    test('should allow queuing request if under limit', () => {
        expect(route.canQueueRequest()).toBe(true);
        route.enqueue({} as any);
        route.enqueue({} as any);
        expect(route.canQueueRequest()).toBe(false);
    });

    test('should enqueue and dequeue requests', () => {
        const req = { id: 'req1' } as any;
        route.enqueue(req);
        expect(route.getQueueLength()).toBe(1);
        expect(route.dequeue()).toBe(req);
        expect(route.getQueueLength()).toBe(0);
    });

    test('should get next backend (Round Robin)', () => {
        const b1 = route.getNextBackend();
        const b2 = route.getNextBackend();
        const b3 = route.getNextBackend();

        expect(b1?.id).toBe('b1');
        expect(b2?.id).toBe('b2');
        expect(b3?.id).toBe('b1');
    });

    test('should mark backend failure and mark it dead after threshold', () => {
        const backend = mockConfig.backends[0];
        route.markBackendFailure('b1');
        expect(backend.failureCount).toBe(1);

        route.markBackendFailure('b1');
        route.markBackendFailure('b1');

        expect(backend.failureCount).toBe(3);
        expect(backend.isDead).toBe(true);
        expect(backend.deadSince).toBeDefined();
    });

    test('should not return dead backends', () => {
        mockConfig.backends[0].isDead = true;
        mockConfig.backends[1].isDead = true;
        expect(route.getNextBackend()).toBeNull();
    });

    test('should restore backend', () => {
        const backend = mockConfig.backends[0];
        backend.isDead = true;
        (route as any).restoreBackend(backend);
        expect(backend.isDead).toBe(false);
        expect(backend.failureCount).toBe(0);
    });
});
