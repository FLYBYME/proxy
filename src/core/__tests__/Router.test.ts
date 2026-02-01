import { Router } from '../Router';
import { BalancingStrategy, RouteConfig } from '../../types/models';
import * as tls from 'tls';

jest.mock('tls');

describe('Router', () => {
    let router: Router;
    const mockRouteConfig: RouteConfig = {
        id: '1',
        vHost: 'example.com',
        strategy: BalancingStrategy.ROUND_ROBIN,
        autoHttps: false,
        reqQueueLength: 10,
        reqActiveLength: 5,
        backends: [
            { id: 'b1', hostname: '127.0.0.1', port: 8080, isDead: false, failureCount: 0 }
        ],
        ssl: {
            key: 'mock-key',
            cert: 'mock-cert'
        }
    };

    beforeEach(() => {
        router = new Router();
    });

    afterEach(() => {
        router.stop();
    });

    test('should add and retrieve a route', () => {
        router.addRoute(mockRouteConfig);
        const route = router.getRoute('example.com');
        expect(route).toBeDefined();
        expect(route?.config.vHost).toBe('example.com');
    });

    test('should return all routes', () => {
        router.addRoute(mockRouteConfig);
        const routes = router.getRoutes();
        expect(routes.length).toBe(1);
    });

    test('should remove a route', () => {
        router.addRoute(mockRouteConfig);
        const deleted = router.removeRoute('example.com');
        expect(deleted).toBe(true);
        expect(router.getRoute('example.com')).toBeUndefined();
    });

    test('should return undefined for non-existent route', () => {
        expect(router.getRoute('none.com')).toBeUndefined();
    });

    test('should resolve SNI context', (done) => {
        router.addRoute(mockRouteConfig);
        (tls.createSecureContext as jest.Mock).mockReturnValue({} as any);

        router.getSNIContext('example.com', (err, ctx) => {
            expect(err).toBeNull();
            expect(ctx).toBeDefined();
            expect(tls.createSecureContext).toHaveBeenCalledWith({
                key: 'mock-key',
                cert: 'mock-cert'
            });
            done();
        });
    });

    test('should return undefined context for route without SSL', (done) => {
        const noSslConfig = { ...mockRouteConfig, ssl: undefined };
        router.addRoute(noSslConfig);

        router.getSNIContext('example.com', (err, ctx) => {
            expect(err).toBeNull();
            expect(ctx).toBeUndefined();
            done();
        });
    });

    test('should return error if tls.createSecureContext fails', (done) => {
        router.addRoute(mockRouteConfig);
        const mockError = new Error('TLS error');
        (tls.createSecureContext as jest.Mock).mockImplementation(() => {
            throw mockError;
        });

        router.getSNIContext('example.com', (err, ctx) => {
            expect(err).toBe(mockError);
            done();
        });
    });
});
