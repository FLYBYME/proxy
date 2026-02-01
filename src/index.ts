import { ProxyManager } from './core/ProxyManager';
// Note: BalancingStrategy might need to be imported from the correct location
// Based on readme, it's in './types' but let's check src/types
import { BalancingStrategy, Routes } from './types/models';
import fs from 'fs';

const port = Number(process.env.PORT) || 8080;
const sslPort = process.env.SSL_PORT ? Number(process.env.SSL_PORT) : undefined;

const proxy = new ProxyManager(port, sslPort);

// Start the server
proxy.start();

console.log(`Proxy Manager started on port ${port}${sslPort ? ` and SSL port ${sslPort}` : ''}`);

const routes = JSON.parse(fs.readFileSync('./data/routes.json', 'utf-8')) as Routes;

routes.routes.forEach((route) => {
    proxy.router.addRoute(route);
});

