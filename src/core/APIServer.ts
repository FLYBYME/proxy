import fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Router } from './Router';
import { Tracker } from './Tracker';
import { BalancingStrategy, RouteConfig, Backend } from '../types/models';
import pino from 'pino';

const logger = pino({ name: 'APIServer' });

// Zod schemas for validation
const BackendSchema = z.object({
    id: z.string(),
    hostname: z.string(),
    port: z.number(),
    weight: z.number().optional().default(1),
    isDead: z.boolean().optional().default(false),
    failureCount: z.number().optional().default(0)
});

const RouteConfigSchema = z.object({
    id: z.string(),
    vHost: z.string(),
    strategy: z.nativeEnum(BalancingStrategy),
    autoHttps: z.boolean().optional().default(false),
    reqQueueLength: z.number().optional().default(100),
    reqActiveLength: z.number().optional().default(50),
    authProvider: z.string().optional(),
    headers: z.record(z.string()).optional(),
    backends: z.array(BackendSchema).default([]),
    ssl: z.object({
        key: z.string(),
        cert: z.string()
    }).optional()
});

const SSLSchema = z.object({
    domain: z.string(),
    key: z.string(),
    cert: z.string()
});

export class APIServer {
    private app: FastifyInstance;

    constructor(private router: Router, private tracker: Tracker, private port: number = 8081) {
        this.app = fastify({ logger: false });
        this.setupRoutes();
    }

    private setupRoutes() {
        // GET /api/v1/routes - List all routes
        this.app.get('/api/v1/routes', async () => {
            return this.router.getRoutes().map(r => r.config);
        });

        // POST /api/v1/routes - Create/Update a route
        this.app.post('/api/v1/routes', async (request, reply) => {
            const body = RouteConfigSchema.parse(request.body);
            this.router.addRoute(body);
            return reply.code(201).send(body);
        });

        // GET /api/v1/routes/:vHost - Get route details
        this.app.get('/api/v1/routes/:vHost', async (request, reply) => {
            const { vHost } = request.params as { vHost: string };
            const route = this.router.getRoute(vHost);
            if (!route) {
                return reply.code(404).send({ error: 'Route not found' });
            }
            return route.config;
        });

        // DELETE /api/v1/routes/:vHost - Remove a route
        this.app.delete('/api/v1/routes/:vHost', async (request, reply) => {
            const { vHost } = request.params as { vHost: string };
            const deleted = this.router.removeRoute(vHost);
            if (!deleted) {
                return reply.code(404).send({ error: 'Route not found' });
            }
            this.tracker.removeStats(vHost);
            return reply.code(204).send();
        });

        // POST /api/v1/routes/:vHost/backends - Add backend
        this.app.post('/api/v1/routes/:vHost/backends', async (request, reply) => {
            const { vHost } = request.params as { vHost: string };
            const backend = BackendSchema.parse(request.body);
            const route = this.router.getRoute(vHost);
            if (!route) {
                return reply.code(404).send({ error: 'Route not found' });
            }
            const newConfig = { ...route.config, backends: [...route.config.backends, backend] };
            route.updateConfig(newConfig);
            return reply.code(201).send(backend);
        });

        // DELETE /api/v1/routes/:vHost/backends/:id - Remove backend
        this.app.delete('/api/v1/routes/:vHost/backends/:id', async (request, reply) => {
            const { vHost, id } = request.params as { vHost: string, id: string };
            const route = this.router.getRoute(vHost);
            if (!route) {
                return reply.code(404).send({ error: 'Route not found' });
            }
            const newBackends = route.config.backends.filter(b => b.id !== id);
            route.updateConfig({ ...route.config, backends: newBackends });
            return reply.code(204).send();
        });

        // POST /api/v1/certificates - Update SSL
        this.app.post('/api/v1/certificates', async (request, reply) => {
            const body = SSLSchema.parse(request.body);
            const route = this.router.getRoute(body.domain);
            if (!route) {
                return reply.code(404).send({ error: 'Route not found' });
            }
            route.updateConfig({ ...route.config, ssl: { key: body.key, cert: body.cert } });
            return { success: true };
        });

        // GET /api/v1/stats - Global stats
        this.app.get('/api/v1/stats', async () => {
            const allStats = this.tracker.getAllStats();
            return Object.fromEntries(allStats);
        });

        // GET /api/v1/stats/:vHost - Specific stats
        this.app.get('/api/v1/stats/:vHost', async (request, reply) => {
            const { vHost } = request.params as { vHost: string };
            const stats = this.tracker.getRouteStats(vHost);
            if (!stats) {
                return reply.code(404).send({ error: 'Stats not found' });
            }
            return stats;
        });

        // Error handling for Zod
        this.app.setErrorHandler((error, request, reply) => {
            if (error instanceof z.ZodError) {
                reply.status(400).send({
                    error: 'Validation Error',
                    details: error.errors
                });
            } else {
                reply.send(error);
            }
        });
    }

    public async start() {
        try {
            await this.app.listen({ port: this.port, host: '0.0.0.0' });
            logger.info(`Management API listening on port ${this.port}`);
        } catch (err) {
            logger.error(err, 'Failed to start API server');
            process.exit(1);
        }
    }

    public async stop() {
        await this.app.close();
    }
}
