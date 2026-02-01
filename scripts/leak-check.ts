import { ProxyManager } from '../src/core/ProxyManager';

async function run() {
    console.log('Starting leak check...');
    for (let i = 0; i < 500; i++) {
        const pm = new ProxyManager(10000 + (i % 100), undefined, 20000 + (i % 100));
        await pm.stop();
        if (i % 50 === 0) {
            if (global.gc) global.gc();
            const mem = process.memoryUsage().heapUsed / 1024 / 1024;
            console.log(`Iteration ${i}: ${mem.toFixed(2)} MB heap used`);
        }
    }
    console.log('Leak check completed.');
}

run().catch(console.error);
