import { Cloudpilot, SuspendKind, VoidPtr } from './../helper/Cloudpilot';
import { Injectable, NgZone } from '@angular/core';

import { AlertService } from './alert.service';
import { KvsService } from './kvs.service';
import { LoadingController } from '@ionic/angular';
import { Event as Microevent } from 'microevent.ts';
import { Mutex } from 'async-mutex';
import { normalizeProxyAddress } from '../helper/proxyAddress';
import { v4 as uuid } from 'uuid';

const CONNECT_TIMEOUT = 5000;
const HANDSHAKE_TIMEOUT = 5000;
const LOADER_GRRACE_TIME = 500;
const VERSION = 1;

interface HandshakeResponse {
    version: number;
    token: string;
}

type HandshakeResult = { status: 'failed' } | { status: 'version_mismatch' } | { status: 'success'; token: string };

@Injectable({
    providedIn: 'root',
})
export class ProxyService {
    constructor(
        private kvsService: KvsService,
        private alertService: AlertService,
        private ngZone: NgZone,
        private loadingController: LoadingController
    ) {}

    initialize(cloudpilot: Cloudpilot) {
        this.cloudpilot = cloudpilot;

        cloudpilot.proxyDisconnectEvent.addHandler(this.onProxyDisconnect);
    }

    reset(): void {
        if (this.socket) this.disconnect(this.socket);
    }

    handleSuspend(): void {
        if (!this.cloudpilot) return;

        if (!this.cloudpilot.isSuspended()) return;

        switch (this.cloudpilot.getSuspendKind()) {
            case SuspendKind.networkConnect:
                this.handleConnect();
                break;

            case SuspendKind.networkRpc:
                this.handleRpc();
                break;

            default:
                break;
        }
    }

    isConnected(): boolean {
        return !!this.socket;
    }

    async handshake(proxyAddress = this.kvsService.kvs.proxyServer): Promise<HandshakeResult> {
        const url = normalizeProxyAddress(proxyAddress);
        if (!url) return { status: 'failed' };

        try {
            const abortContrtoller = new AbortController();
            const timeout = setTimeout(() => abortContrtoller.abort(), HANDSHAKE_TIMEOUT);
            const response = await fetch(`${url}/network-proxy/handshake`, {
                method: 'POST',
                signal: abortContrtoller.signal,
            });

            clearTimeout(timeout);

            if (response.status !== 200) {
                return { status: 'failed' };
            }

            const handshakeResponse: HandshakeResponse = await response.json();

            if (handshakeResponse.version !== VERSION) {
                return { status: 'version_mismatch' };
            }

            return { status: 'success', token: handshakeResponse.token };
        } catch (e) {
            return { status: 'failed' };
        }
    }

    private handleConnect = () =>
        this.mutex.runExclusive(async (): Promise<void> => {
            const loader = await this.loadingController.create();
            const timeout = setTimeout(() => loader.present(), LOADER_GRRACE_TIME);

            try {
                if (this.socket) this.disconnect(this.socket);

                const url = normalizeProxyAddress(this.kvsService.kvs.proxyServer);

                if (!url) {
                    await this.alertService.errorMessage(`Invalid proxy address: ${this.kvsService.kvs.proxyServer}`);

                    this.cloudpilot.getSuspendContextNetworkConnect().Cancel();

                    return;
                }

                const handshakeResult = await this.handshake();

                switch (handshakeResult.status) {
                    case 'failed':
                        this.onSocketError(undefined);
                        return;

                    case 'version_mismatch':
                        await this.alertService.proxyVersionMismatchError();

                        this.cancelSuspend();

                        return;

                    case 'success':
                        break;

                    default:
                        throw new Error('unreachable');
                }

                this.socket = new WebSocket(
                    `${url.replace(/^http/, 'ws')}/network-proxy/connect?token=${encodeURIComponent(
                        handshakeResult.token
                    )}`
                );
                this.socket.binaryType = 'arraybuffer';

                this.bindListeners(this.socket);

                this.ngZone.run(() => (this.connectTimeoutHandle = setTimeout(this.onSocketError, CONNECT_TIMEOUT)));
            } finally {
                clearTimeout(timeout);
                loader.dismiss();
            }
        });

    private handleRpc(): void {
        const ctx = this.cloudpilot.getSuspendContextNetworkRpc();

        if (!this.socket) {
            ctx.Cancel();

            return;
        }

        this.socket.send(this.cloudpilot.resolveBuffer(ctx.GetRequestData(), ctx.GetRequestSize()));
    }

    private disconnect(socket: WebSocket | undefined): void {
        if (socket) {
            this.unbindListeners(socket);
            socket.close();
        }

        this.sessionId = '';
        this.socket = undefined;
    }

    private bindListeners(socket: WebSocket): void {
        this.ngZone.run(() => {
            socket.addEventListener('open', this.onSocketOpen);
            socket.addEventListener('error', this.onSocketError);
            socket.addEventListener('close', this.onSocketClose);
        });

        this.ngZone.runOutsideAngular(() => socket.addEventListener('message', this.onSocketMessage));
    }

    private unbindListeners(socket: WebSocket | undefined): void {
        if (!socket) {
            return;
        }

        socket.removeEventListener('message', this.onSocketMessage);
        socket.removeEventListener('open', this.onSocketOpen);
        socket.removeEventListener('error', this.onSocketError);
        socket.removeEventListener('close', this.onSocketClose);
    }

    private cancelSuspend(): void {
        if (!this.cloudpilot.isSuspended()) return;

        switch (this.cloudpilot.getSuspendKind()) {
            case SuspendKind.networkConnect:
            case SuspendKind.networkRpc:
                this.cloudpilot.cancelSuspend();
                break;

            default:
                break;
        }
    }

    private onSocketOpen = (): void => {
        this.cancelConnectTimeout();

        if (!this.cloudpilot.isSuspended() || this.cloudpilot.getSuspendKind() !== SuspendKind.networkConnect) {
            console.error('ERROR: socket connected, but emulation is not waiting for connect');

            this.disconnect(this.socket);

            return;
        }

        this.sessionId = uuid();
        this.cloudpilot.getSuspendContextNetworkConnect().Resume(this.sessionId);

        this.resumeEvent.dispatch();
    };

    private onSocketMessage = (evt: MessageEvent): void => {
        if (!this.cloudpilot.isSuspended() || this.cloudpilot.getSuspendKind() !== SuspendKind.networkRpc) {
            console.error('ERROR: socket received message, but emulation is not waiting for rpc');

            return;
        }

        if (!(evt.data instanceof ArrayBuffer)) {
            console.error('ERROR: socket received a text frame');
            this.disconnect(this.socket);
            this.alertService.errorMessage('Connection to proxy closed unexpectedly due to an error.');

            this.cancelSuspend();

            return;
        }

        const ptr: VoidPtr = this.cloudpilot.copyBuffer(new Uint8Array(evt.data));

        this.cloudpilot.getSuspendContextNetworkRpc().ReceiveResponse(ptr, evt.data.byteLength);
        this.cloudpilot.freeBuffer(ptr);

        this.resumeEvent.dispatch();
    };

    private onSocketError = (evt: Event | undefined): void => {
        this.cancelConnectTimeout();

        if (this.cloudpilot.isSuspended() && this.cloudpilot.getSuspendKind() === SuspendKind.networkConnect) {
            this.alertService.errorMessage('Failed to connect to proxy.');
        } else {
            this.alertService.errorMessage('Connection to proxy closed unexpectedly due to an error.');
        }

        this.disconnect(this.socket);
        this.cancelSuspend();

        console.error('ERROR: socket error', evt);
    };

    private onSocketClose = (): void => {
        this.cancelConnectTimeout();

        this.alertService.errorMessage('Connection to proxy closed unexpectedly');

        this.unbindListeners(this.socket);
        this.cancelSuspend();

        this.sessionId = '';
        this.socket = undefined;
    };

    private onProxyDisconnect = (sessionId: string): void => {
        if (sessionId !== this.sessionId || !this.socket) return;

        this.ngZone.run(() => this.disconnect(this.socket));
    };

    private cancelConnectTimeout(): void {
        if (this.connectTimeoutHandle !== undefined) clearTimeout(this.connectTimeoutHandle);

        this.connectTimeoutHandle = undefined;
    }

    public resumeEvent = new Microevent<void>();

    private mutex = new Mutex();

    private socket: WebSocket | undefined;
    private sessionId = '';
    private cloudpilot!: Cloudpilot;

    private connectTimeoutHandle: number | undefined;
}