import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';
import HttpProxy from 'http-proxy';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

import { Router } from './Router';
import { Tracker } from './Tracker';
import { Route } from './Route';
import { APIServer } from './APIServer';
import { ProxyRequest, Backend } from '../types/models';

// Type Augmentation to attach our metadata to the native Node request
declare module 'http' {
    interface IncomingMessage {
        proxyRequest?: ProxyRequest;
    }
}

const logger = pino({ name: 'ProxyManager' });

export class ProxyManager {
    public router: Router;
    public tracker: Tracker;

    private proxy: HttpProxy;
    private httpServer: http.Server;
    private httpsServer?: https.Server;
    private apiServer: APIServer;

    constructor(
        private port: number,
        private sslPort?: number,
        private apiPort: number = 8081
    ) {
        this.router = new Router();
        this.tracker = new Tracker();

        // Initialize API
        this.apiServer = new APIServer(this.router, this.tracker, this.apiPort);

        // Initialize Proxy Engine
        this.proxy = HttpProxy.createProxyServer({
            xfwd: true, // Adds X-Forwarded-For headers
            preserveHeaderKeyCase: true,
            timeout: 5000,      // Socket connection timeout
            proxyTimeout: 10000 // Response from target timeout
        });

        // Initialize HTTP Server
        this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));

        // Initialize HTTPS Server (Optional)
        if (this.sslPort) {
            this.httpsServer = https.createServer({
                SNICallback: this.handleSNI.bind(this)
            }, (req, res) => this.handleRequest(req, res));
        }

        this.bindGlobalProxyEvents();
    }

    /**
     * Handles Server Name Indication (SNI) for dynamic SSL certificates.
     */
    private handleSNI(servername: string, cb: (err: Error | null, ctx: tls.SecureContext) => void) {
        this.router.getSNIContext(servername, (err, ctx) => {
            if (err) {
                logger.error({ err: err.message, servername }, 'Error resolving SNI context');
                return cb(err, null as any);
            }
            if (!ctx) {
                logger.warn({ servername }, 'No SSL context found for SNI');
                return cb(new Error(`No certificate found for ${servername}`), null as any);
            }
            cb(null, ctx);
        });
    }

    /**
     * Binds global events for the http-proxy instance.
     * Note: Request-specific logic is often better handled in the web() callback or custom logic,
     * but 'proxyRes' is essential for header manipulation.
     */
    private bindGlobalProxyEvents() {
        // Handle Upstream Errors (e.g., Connection Refused)
        this.proxy.on('error', (err: any, req, res) => {
            const proxyReq = (req as http.IncomingMessage).proxyRequest;
            const isTimeout = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message.includes('timeout');

            logger.error({
                err: err.message,
                code: err.code,
                vHost: proxyReq?.meta.vHost,
                isTimeout
            }, 'Upstream proxy error');

            // Finalize state if we have context
            if (proxyReq) {
                const route = this.router.getRoute(proxyReq.meta.vHost);
                if (route && proxyReq.meta.targetId) {
                    route.markBackendFailure(proxyReq.meta.targetId);
                }
                this.finalizeRequest(proxyReq, false);
            }

            // Send error response to client if headers haven't been sent
            if (res && 'writeHead' in res && !res.headersSent) {
                const statusCode = isTimeout ? 504 : 502;
                const statusMsg = isTimeout ? 'Gateway Timeout' : 'Bad Gateway';

                res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: statusMsg,
                    code: isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
                    message: err.message
                }));
            }
        });


        // Handle Upstream Response (Headers received)
        this.proxy.on('proxyRes', (proxyRes, req, res) => {
            const proxyReq = (req as http.IncomingMessage).proxyRequest;
            if (proxyReq) {
                // Here you can inject custom response headers defined in RouteConfig
                // e.g. res.setHeader('X-Proxy-By', 'MyProxy');
            }
        });
    }

    /**
     * Entry point for all incoming HTTP/HTTPS traffic.
     */
    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        const hostHeader = req.headers.host;

        // Basic Host validation
        if (!hostHeader) {
            res.writeHead(400);
            return res.end('Missing Host Header');
        }

        // 1. Resolve Route
        const hostname = hostHeader.split(':')[0]; // Strip port if present
        const route = this.router.getRoute(hostname);

        if (!route) {
            res.writeHead(404);
            return res.end(`No route configured for ${hostname}`);
        }

        // 2. Build Internal Request Object
        const proxyReq: ProxyRequest = {
            id: uuidv4(),
            req,
            res,
            startTime: Date.now(),
            retries: 0,
            meta: {
                vHost: hostname,
                clientIp: req.socket.remoteAddress || 'unknown'
            }
        };

        // Attach to native req for event propagation
        req.proxyRequest = proxyReq;

        // 3. Dispatch
        this.dispatch(route, proxyReq);
    }

    /**
     * Decides whether to forward immediately or queue the request.
     */
    private dispatch(route: Route, proxyReq: ProxyRequest) {
        if (route.canHandleRequest()) {
            this.forward(route, proxyReq);
        } else if (route.canQueueRequest()) {
            logger.debug({ vHost: route.config.vHost, q: route.getQueueLength() }, 'Request queued');
            route.enqueue(proxyReq);
        } else {
            // Queue is full - Shed Load
            this.tracker.trackError(route.config.vHost, 'QUEUE_FULL');
            proxyReq.res.writeHead(503, { 'Retry-After': '10' });
            proxyReq.res.end('Server Busy');
            // No need to finalizeRequest here as it never entered active state
        }
    }

    /**
     * Selects a backend and pipes traffic.
     */
    private forward(route: Route, proxyReq: ProxyRequest) {
        const backend = route.getNextBackend(proxyReq);

        if (!backend) {
            proxyReq.res.writeHead(503);
            proxyReq.res.end('Service Unavailable - No Healthy Backends');
            return;
        }

        // 1. Mark State Active
        route.activeRequests++;
        proxyReq.meta.targetId = backend.id; // Store for error handling

        // 2. Track Metrics
        this.tracker.trackRequestStart(route.config.vHost);

        // 3. Setup cleanup listener for client disconnects
        // If client kills connection before backend responds, we must decrement count
        const abortHandler = () => {
            logger.warn({ reqId: proxyReq.id }, 'Client aborted request');
            this.finalizeRequest(proxyReq, false);
        };
        proxyReq.req.once('aborted', abortHandler);

        // 4. Proxy
        const target = `http://${backend.hostname}:${backend.port}`;
        const options: any = { target };

        if (route.config.timeout) options.timeout = route.config.timeout;
        if (route.config.proxyTimeout) options.proxyTimeout = route.config.proxyTimeout;

        this.proxy.web(proxyReq.req, proxyReq.res, options);

        // 5. Success Listener
        // We listen on 'finish' of the response to ensure stream is done.
        const finishHandler = () => {
            // Status code logic helps determine 'success' vs 'app error'
            const isSuccess = proxyReq.res.statusCode < 500;
            this.finalizeRequest(proxyReq, isSuccess);
        };
        proxyReq.res.once('finish', finishHandler);

        // Store handlers for cleanup
        (proxyReq as any)._abortHandler = abortHandler;
        (proxyReq as any)._finishHandler = finishHandler;
    }

    /**
     * Cleans up request state, updates metrics, and triggers the queue.
     * Guaranteed to run only once per request due to the 'isEnded' flag check.
     */
    private finalizeRequest(proxyReq: ProxyRequest, isSuccess: boolean) {
        // Prevent double counting (race between error, aborted, and finish)
        if (proxyReq.meta.isEnded) return;
        proxyReq.meta.isEnded = true;

        // Cleanup listeners to prevent memory leaks
        if ((proxyReq as any)._abortHandler) {
            proxyReq.req.removeListener('aborted', (proxyReq as any)._abortHandler);
        }
        if ((proxyReq as any)._finishHandler) {
            proxyReq.res.removeListener('finish', (proxyReq as any)._finishHandler);
        }

        const route = this.router.getRoute(proxyReq.meta.vHost);
        if (!route) return;

        // 1. Decrement Active Count
        route.activeRequests = Math.max(0, route.activeRequests - 1);

        // 2. Track Latency & Stats
        this.tracker.trackRequestEnd(proxyReq, isSuccess);

        // 3. Trigger Queue Processing (Event Driven)
        // Since a slot just opened up, check if anyone is waiting
        this.pumpQueue(route);
    }

    /**
     * Checks the specific route's queue and processes pending requests
     * if capacity allows.
     */
    private pumpQueue(route: Route) {
        // Use a loop to fill available slots if multiple slots opened
        // or if active length config changed dynamically
        while (route.canHandleRequest() && route.getQueueLength() > 0) {
            const queuedReq = route.dequeue();
            if (queuedReq) {
                logger.debug({ vHost: route.config.vHost }, 'Promoting request from queue');
                // Process immediately on next tick to unwind stack
                process.nextTick(() => this.forward(route, queuedReq));
            }
        }
    }

    public start() {
        this.httpServer.listen(this.port, () => {
            logger.info(`HTTP Proxy listening on port ${this.port}`);
        });

        if (this.httpsServer && this.sslPort) {
            this.httpsServer.listen(this.sslPort, () => {
                logger.info(`HTTPS Proxy listening on port ${this.sslPort}`);
            });
        }

        this.apiServer.start();
    }

    public async stop() {
        const closures = [
            new Promise(resolve => this.httpServer.close(resolve)),
            this.apiServer.stop(),
            Promise.resolve(this.proxy.close())
        ];

        if (this.httpsServer) {
            closures.push(new Promise(resolve => this.httpsServer!.close(resolve)));
        }

        this.router.stop();
        await Promise.all(closures);
    }
}