import { Tracker } from '../Tracker';
import { ProxyRequest } from '../../types/models';

describe('Tracker', () => {
    let tracker: Tracker;
    const vHost = 'test.com';

    beforeEach(() => {
        tracker = new Tracker();
    });

    test('should track request start', () => {
        tracker.trackRequestStart(vHost);
        const stats = tracker.getRouteStats(vHost);
        expect(stats?.requestsTotal).toBe(1);
        expect(stats?.requestsActive).toBe(1);
    });

    test('should track request end (success)', () => {
        const mockReq: ProxyRequest = {
            id: '1',
            startTime: Date.now() - 100,
            meta: { vHost, clientIp: '127.0.0.1' }
        } as any;

        tracker.trackRequestStart(vHost);
        tracker.trackRequestEnd(mockReq, true);

        const stats = tracker.getRouteStats(vHost);
        expect(stats?.requestsActive).toBe(0);
        expect(stats?.errorsTotal).toBe(0);
        expect(stats?.avgLatencyMs).toBeGreaterThan(0);
    });

    test('should track request end (failure)', () => {
        const mockReq: ProxyRequest = {
            id: '1',
            startTime: Date.now() - 100,
            meta: { vHost, clientIp: '127.0.0.1' }
        } as any;

        tracker.trackRequestStart(vHost);
        tracker.trackRequestEnd(mockReq, false);

        const stats = tracker.getRouteStats(vHost);
        expect(stats?.errorsTotal).toBe(1);
    });

    test('should track explicit errors', () => {
        tracker.trackError(vHost, 'QUEUE_FULL');
        const stats = tracker.getRouteStats(vHost);
        expect(stats?.errorsTotal).toBe(1);
    });

    test('should return all stats', () => {
        tracker.trackRequestStart('host1');
        tracker.trackRequestStart('host2');
        const allStats = tracker.getAllStats();
        expect(allStats.size).toBe(2);
    });
});
