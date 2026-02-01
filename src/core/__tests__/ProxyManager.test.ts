import { ProxyManager } from '../ProxyManager';
import { Router } from '../Router';
import { Tracker } from '../Tracker';
import HttpProxy from 'http-proxy';
import * as http from 'http';

// Mocking heavy external modules
jest.mock('http');
jest.mock('http-proxy');
jest.mock('../Router');
jest.mock('../Tracker');
jest.mock('../APIServer'); // Prevent the API server from actually starting/binding ports

describe('ProxyManager', () => {
    let proxyManager: ProxyManager;
    let mockProxy: any;

    beforeEach(() => {
        // Setup Proxy Mock with chainable 'on' and callback support
        mockProxy = {
            on: jest.fn().mockReturnThis(),
            web: jest.fn(),
            close: jest.fn()
        };
        (HttpProxy.createProxyServer as jest.Mock).mockReturnValue(mockProxy);

        // Setup HTTP Server Mock to trigger close callbacks immediately
        (http.createServer as jest.Mock).mockReturnValue({
            listen: jest.fn().mockImplementation((port, cb) => cb?.()),
            close: jest.fn().mockImplementation((cb) => cb?.())
        });

        proxyManager = new ProxyManager(80, undefined, 8081);
    });

    afterEach(async () => {
        // Crucial: clear all mocks to free memory between tests
        jest.clearAllMocks();
        await proxyManager.stop();
    });

    describe('Request Handling', () => {
        test('should forward request when route is available and healthy', () => {
            const req = {
                headers: { host: 'example.com' },
                socket: { remoteAddress: '1.2.3.4' },
                once: jest.fn(),
                removeListener: jest.fn()
            } as any;
            const res = {
                writeHead: jest.fn(),
                end: jest.fn(),
                once: jest.fn(),
                removeListener: jest.fn()
            } as any;

            const mockBackend = { id: 'b1', hostname: '127.0.0.1', port: 8080 };
            const mockRoute = {
                config: { vHost: 'example.com' },
                activeRequests: 0,
                canHandleRequest: jest.fn().mockReturnValue(true),
                getNextBackend: jest.fn().mockReturnValue(mockBackend),
            };

            (proxyManager.router.getRoute as jest.Mock).mockReturnValue(mockRoute);

            // Accessing private method for testing
            (proxyManager as any).handleRequest(req, res);

            expect(proxyManager.router.getRoute).toHaveBeenCalledWith('example.com');
            expect(mockProxy.web).toHaveBeenCalledWith(
                req,
                res,
                { target: 'http://127.0.0.1:8080' }
            );
            expect(proxyManager.tracker.trackRequestStart).toHaveBeenCalled();
        });

        test('should return 400 if Host header is missing', () => {
            const req = { headers: {} } as any;
            const res = { writeHead: jest.fn(), end: jest.fn() } as any;

            (proxyManager as any).handleRequest(req, res);

            expect(res.writeHead).toHaveBeenCalledWith(400);
            expect(res.end).toHaveBeenCalledWith('Missing Host Header');
        });
    });

    describe('Queue and Load Shedding', () => {
        test('should queue request when capacity is reached but queue is not full', () => {
            const req = { headers: { host: 'example.com' }, socket: {} } as any;
            const res = { writeHead: jest.fn(), end: jest.fn() } as any;

            const mockRoute = {
                config: { vHost: 'example.com' },
                canHandleRequest: jest.fn().mockReturnValue(false),
                canQueueRequest: jest.fn().mockReturnValue(true),
                enqueue: jest.fn(),
                getQueueLength: jest.fn().mockReturnValue(5)
            };

            (proxyManager.router.getRoute as jest.Mock).mockReturnValue(mockRoute);

            (proxyManager as any).handleRequest(req, res);

            expect(mockRoute.enqueue).toHaveBeenCalled();
            expect(mockProxy.web).not.toHaveBeenCalled();
        });

        test('should return 503 when queue is full (Load Shedding)', () => {
            const req = { headers: { host: 'example.com' }, socket: {} } as any;
            const res = { writeHead: jest.fn(), end: jest.fn() } as any;

            const mockRoute = {
                config: { vHost: 'example.com' },
                canHandleRequest: jest.fn().mockReturnValue(false),
                canQueueRequest: jest.fn().mockReturnValue(false)
            };

            (proxyManager.router.getRoute as jest.Mock).mockReturnValue(mockRoute);

            (proxyManager as any).handleRequest(req, res);

            expect(res.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
            expect(proxyManager.tracker.trackError).toHaveBeenCalledWith('example.com', 'QUEUE_FULL');
        });
    });

    describe('Lifecycle & Finalization', () => {
        test('should decrement active requests and pump queue on completion', () => {
            const mockReq = {
                id: 'req-123',
                req: { removeListener: jest.fn() },
                res: { removeListener: jest.fn() },
                meta: { vHost: 'example.com', isEnded: false }
            } as any;

            const mockRoute = {
                config: { vHost: 'example.com' },
                activeRequests: 1,
                canHandleRequest: jest.fn().mockReturnValue(true),
                getQueueLength: jest.fn().mockReturnValueOnce(1).mockReturnValue(0), // Loop breaker
                dequeue: jest.fn().mockReturnValue({
                    req: { once: jest.fn() },
                    res: { once: jest.fn(), statusCode: 200 },
                    meta: { vHost: 'example.com' }
                }),
                getNextBackend: jest.fn().mockReturnValue({ id: 'b1', hostname: '127.0.0.1', port: 8080 })
            };

            (proxyManager.router.getRoute as jest.Mock).mockReturnValue(mockRoute);

            (proxyManager as any).finalizeRequest(mockReq, true);

            expect(mockRoute.activeRequests).toBe(0);
            expect(proxyManager.tracker.trackRequestEnd).toHaveBeenCalled();
            expect(mockRoute.dequeue).toHaveBeenCalled();
        });
    });
});