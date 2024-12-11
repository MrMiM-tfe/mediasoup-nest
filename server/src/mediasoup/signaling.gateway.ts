import {
	WebSocketGateway,
	WebSocketServer,
	SubscribeMessage,
	OnGatewayConnection,
	OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MediasoupService } from './mediasoup.service'; // Make sure MediasoupService is properly configured
import { AppData, Router, WebRtcTransport } from 'mediasoup/node/lib/types';

interface IChannel {
	router: Router<AppData>,
	transports: Map<string, WebRtcTransport<AppData>>,
	producers: Map<string, any>,
	consumers: Map<string, any>,
}

@WebSocketGateway({ cors: true })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
	@WebSocketServer()
	server: Server;

	// private newRooms: {}[]  = null
	private channels: Record<string ,IChannel> = {}
	// private transports = new Map(); // Stores WebRTC transports
	// private producers = new Map(); // Stores producers (clients sending media)
	// private consumers = new Map(); // Stores consumers (clients receiving media)
	// private rooms = new Map(); // Stores rooms with routers and other media-specific data

	constructor(private readonly mediasoupService: MediasoupService) {}

	// Handle when a client connects
	handleConnection(client: Socket) {
		console.log('Client connected:', client.id);
	}

	// Handle when a client disconnects
	handleDisconnect(client: Socket) {
		console.log('Client disconnected:', client.id);
	}

	@SubscribeMessage('test')
	async test(client: Socket, payload: any, callback: Function) {
		console.log(typeof payload, typeof callback);
		console.log(payload, callback);
		return 'hello from server';
		// callback({test: 'test'})
	}

	// Client requests router RTP capabilities (before connecting)
	@SubscribeMessage('getRouterRtpCapabilities')
	async handleGetRouterRtpCapabilities(client: Socket, payload: any) {
		const channelId = payload.channelId;
		
		if (!this.channels[channelId]) {
			const router = await this.mediasoupService.initialize();
			this.channels[channelId] = {
				router: router,
				transports: new Map(),
				producers: new Map(),
				consumers: new Map(),
			};
		}

		const router = this.channels[channelId].router;

		return router.rtpCapabilities;
	}

	// Create a WebRTC transport
	@SubscribeMessage('createWebRtcTransport')
	async handleCreateWebRtcTransport(client: Socket, payload: any) {
		const channelId = payload.channelId;
		const router = this.channels[channelId].router;

		const transportOptions = await this.mediasoupService.createTransportOptions();

		const transport = await router.createWebRtcTransport(transportOptions);
		this.channels[channelId].transports.set(transport.id, transport);

		transport.on('dtlsstatechange', (dtlsState: string) => {
			if (dtlsState === 'closed') {
				transport.close();
				console.log('Transport closed:', transport.id);
			}
		});

		return {
			id: transport.id,
			iceParameters: transport.iceParameters,
			iceCandidates: transport.iceCandidates,
			dtlsParameters: transport.dtlsParameters,
		};
	}

	@SubscribeMessage('connectTransport')
	async handleConnectTransport(client: Socket, payload: any) {
		const { transportId, dtlsParameters, channelId } = payload;

		const transport = this.channels[channelId].transports.get(transportId);
		if (!transport) {
			return 'ERROR';
		}

		await transport.connect({ dtlsParameters });
		return 'SUCCESS';
	}

	// Produce media from the client
	@SubscribeMessage('produce')
	async handleProduce(client: Socket, payload: any, callback: Function) {
		const { transportId, kind, rtpParameters, channelId } = payload;

		// reset the producers map (for testing)
		// this.channels[channelId].producers = new Map();

		const transport = this.channels[channelId].transports.get(transportId);

		if (!transport) {
			return callback({ error: 'Transport not found' });
		}

		const producer = await transport.produce({ kind, rtpParameters });
		this.channels[channelId].producers.set(producer.id, producer);

		return producer.id;
	}

	// Consume media (receive from other producers)
	@SubscribeMessage('consume')
	async handleConsume(client: Socket, payload: any) {
		const { transportId, producerId, rtpCapabilities, channelId } = payload;
		// reset the consumers map (for testing)
		// this.channels[payload.channelId].consumers = new Map();
		const transport = this.channels[channelId].transports.get(transportId);

		if (!transport) {
			return { error: 'Transport not found' };
		}

		const router = this.channels[channelId].router;
		// const producer = this.channels[channelId].producers.get(producerId);

		// Check if client's rtpCapabilities can consume the producer
		if (!router.canConsume({ producerId, rtpCapabilities })) {
			return { error: 'Cannot consume', producerId, rtpCapabilities };
		}

		// Create consumer
		const consumer = await transport.consume({
			producerId,
			rtpCapabilities,
			paused: true, // Consumer is created paused
		});

		this.channels[channelId].consumers.set(consumer.id, consumer);

		// Consumer resume
		consumer.resume();

		return {
			id: consumer.id,
			producerId,
			kind: consumer.kind,
			rtpParameters: consumer.rtpParameters,
		};
	}

	// Client requests to close the transport
	// @SubscribeMessage('closeTransport')
	// handleCloseTransport(client: Socket, payload: any): void {
	// 	const { transportId } = payload;
	// 	const transport = this.transports.get(transportId);

	// 	if (transport) {
	// 		transport.close();
	// 		this.transports.delete(transportId);
	// 	}
	// }

	@SubscribeMessage('getProducers')
	handleGetProducers(client: Socket, payload: any): { id: string }[] {
		const { channelId } = payload;

		const producers = this.channels[channelId].producers;
		// console.log('producers', producers);

		return Array.from(producers.values()).map((producer) => ({
			id: producer.id,
		}));
	}

	@SubscribeMessage('reset')
	handleReset(client: Socket, payload: any): void {
		this.channels = {}
		console.log('reset');	
	}

	// Handle other signaling events, like handling errors or requesting available producers
}
