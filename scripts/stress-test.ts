import http from 'http';
import { ProxyManager } from '../src/core/ProxyManager';

async function run() {
    console.log('Starting high-load memory stability test...');

    // Start proxy and backend
    const manager = new ProxyManager(8080, undefined, 8081);
    manager.router.addRoute({
        id: '1',
        vHost: 'localhost',
        strategy: 'ROUND_ROBIN' as any,
        autoHttps: false,
        reqQueueLength: 1000,
        reqActiveLength: 100,
        backends: [{ id: 'b1', hostname: 'localhost', port: 9000, isDead: false, failureCount: 0 }]
    });

    const backend = http.createServer((req, res) => {
        res.end('OK');
    });
    backend.listen(9000);
    manager.start();

    const ITERATIONS = 10000;
    const CONCURRENCY = 50;
    let completed = 0;

    const next = async () => {
        while (completed < ITERATIONS) {
            completed++;
            await new Promise((resolve) => {
                const req = http.get('http://localhost:8080', {
                    headers: { Host: 'localhost' }
                }, (res) => {
                    res.on('data', () => { });
                    res.on('end', resolve);
                });
                req.on('error', resolve);
            });

            if (completed % 1000 === 0) {
                const mem = process.memoryUsage().heapUsed / 1024 / 1024;
                console.log(`Progress: ${completed}/${ITERATIONS}. Memory: ${mem.toFixed(2)} MB`);
            }
        }
    };

    const workers = Array(CONCURRENCY).fill(null).map(() => next());
    await Promise.all(workers);

    console.log('Load test finished.');
    await manager.stop();
    backend.close();

    if (global.gc) global.gc();
    const finalMem = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`Final memory after GC: ${finalMem.toFixed(2)} MB`);
}

run().catch(console.error);
