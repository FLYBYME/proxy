#!/usr/bin/env node
import { Command } from 'commander';
import { BalancingStrategy } from '../types/models';
import { v4 as uuidv4 } from 'uuid';

const program = new Command();
const API_URL = process.env.PROXY_API_URL || 'http://localhost:8081/api/v1';

program
    .name('proxy-cli')
    .description('CLI to manage the TypeScript Dynamic Reverse Proxy')
    .version('1.0.0');

// Routes Commands
const routes = program.command('routes').description('Manage virtual host routes');

routes
    .command('list')
    .description('List all configured routes')
    .action(async () => {
        try {
            const res = await fetch(`${API_URL}/routes`);
            const data = await res.json();
            console.table(data);
        } catch (err) {
            console.error('Failed to fetch routes:', err);
        }
    });

routes
    .command('add <vHost> <strategy>')
    .description('Add a new virtual host route')
    .option('--auto-https', 'Enable automatic HTTPS redirect', false)
    .option('--active-limit <number>', 'Max concurrent requests', '50')
    .option('--queue-limit <number>', 'Max queued requests', '100')
    .option('--timeout <number>', 'Socket connection timeout (ms)', '5000')
    .option('--proxy-timeout <number>', 'Response timeout (ms)', '10000')
    .action(async (vHost, strategy, options) => {
        try {
            const config = {
                id: uuidv4(),
                vHost,
                strategy,
                autoHttps: options.autoHttps,
                reqActiveLength: parseInt(options.activeLimit),
                reqQueueLength: parseInt(options.queueLimit),
                timeout: parseInt(options.timeout),
                proxyTimeout: parseInt(options.proxyTimeout),
                backends: []
            };

            const res = await fetch(`${API_URL}/routes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (res.ok) {
                console.log(`Successfully added route for ${vHost}`);
            } else {
                const error = await res.json();
                console.error('Failed to add route:', error);
            }
        } catch (err) {
            console.error('Error adding route:', err);
        }
    });

routes
    .command('remove <vHost>')
    .description('Remove a virtual host route')
    .action(async (vHost) => {
        try {
            const res = await fetch(`${API_URL}/routes/${vHost}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                console.log(`Successfully removed route for ${vHost}`);
            } else {
                console.error('Failed to remove route');
            }
        } catch (err) {
            console.error('Error removing route:', err);
        }
    });

// Backends Commands
const backends = program.command('backends').description('Manage backends for a route');

backends
    .command('add <vHost> <hostname> <port>')
    .description('Add a backend to a route')
    .action(async (vHost, hostname, port) => {
        try {
            const backend = {
                id: uuidv4(),
                hostname,
                port: parseInt(port),
                isDead: false,
                failureCount: 0
            };

            const res = await fetch(`${API_URL}/routes/${vHost}/backends`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backend)
            });

            if (res.ok) {
                console.log(`Successfully added backend ${hostname}:${port} to ${vHost}`);
            } else {
                const error = await res.json();
                console.error('Failed to add backend:', error);
            }
        } catch (err) {
            console.error('Error adding backend:', err);
        }
    });

backends
    .command('remove <vHost> <id>')
    .description('Remove a backend from a route')
    .action(async (vHost, id) => {
        try {
            const res = await fetch(`${API_URL}/routes/${vHost}/backends/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                console.log(`Successfully removed backend ${id} from ${vHost}`);
            } else {
                console.error('Failed to remove backend');
            }
        } catch (err) {
            console.error('Error removing backend:', err);
        }
    });

// Stats Command
program
    .command('stats [vHost]')
    .description('View real-time metrics')
    .action(async (vHost) => {
        try {
            const url = vHost ? `${API_URL}/stats/${vHost}` : `${API_URL}/stats`;
            const res = await fetch(url);
            const data = await res.json();
            if (vHost) {
                console.table([data]);
            } else {
                console.table(data);
            }
        } catch (err) {
            console.error('Failed to fetch stats:', err);
        }
    });

program.parse(process.argv);
