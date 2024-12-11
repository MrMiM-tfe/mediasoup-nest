import {
	WebSocketGateway,
	WebSocketServer,
	SubscribeMessage,
	OnGatewayConnection,
	OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MediasoupService } from './mediasoup.service'; // Make sure MediasoupService is properly configured

@WebSocketGateway({ cors: true })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
	@WebSocketServer()
	server: Server;

	private transports = new Map(); // Stores WebRTC transports
	private producers = new Map(); // Stores producers (clients sending media)
	private consumers = new Map(); // Stores consumers (clients receiving media)
	private rooms = new Map(); // Stores rooms with routers and other media-specific data

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
		const roomId = payload.roomId;

		if (!this.rooms.has(roomId)) {
			const router = await this.mediasoupService.initialize();
			this.rooms.set(roomId, { router });
		}

		const router = this.rooms.get(roomId).router;

		return router.rtpCapabilities;
	}

	// Create a WebRTC transport
	@SubscribeMessage('createWebRtcTransport')
	async handleCreateWebRtcTransport(client: Socket, payload: any) {
		const roomId = payload.roomId;
		const router = this.rooms.get(roomId).router;

		const transportOptions = await this.mediasoupService.createTransportOptions();

		const transport = await router.createWebRtcTransport(transportOptions);
		this.transports.set(transport.id, transport);

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
		const { transportId, dtlsParameters } = payload;

		const transport = this.transports.get(transportId);
		if (!transport) {
			return 'ERROR';
		}

		await transport.connect({ dtlsParameters });
		return 'SUCCESS';
	}

	// Produce media from the client
	@SubscribeMessage('produce')
	async handleProduce(client: Socket, payload: any, callback: Function) {
		this.producers = new Map();
		const { transportId, kind, rtpParameters, roomId } = payload;
		const transport = this.transports.get(transportId);

		if (!transport) {
			return callback({ error: 'Transport not found' });
		}

		const producer = await transport.produce({ kind, rtpParameters });
		this.producers.set(producer.id, producer);

		// Add the producer to the room so that other clients can consume it
		const room = this.rooms.get(roomId);
		room[producer.id] = producer;

		return producer.id;
	}

	// Consume media (receive from other producers)
	@SubscribeMessage('consume')
	async handleConsume(client: Socket, payload: any) {
		this.consumers = new Map();
		const { transportId, producerId, rtpCapabilities, roomId } = payload;
		const transport = this.transports.get(transportId);

		if (!transport) {
			return { error: 'Transport not found' };
		}

		const room = this.rooms.get(roomId);
		const router = room.router;
		const producer = room[producerId];

		// Check if client's rtpCapabilities can consume the producer
		if (!router.canConsume({ producerId, rtpCapabilities })) {
			return { error: 'Cannot consume' };
		}

		// Create consumer
		const consumer = await transport.consume({
			producerId,
			rtpCapabilities,
			paused: true, // Consumer is created paused
		});

		this.consumers.set(consumer.id, consumer);

		
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
	@SubscribeMessage('closeTransport')
	handleCloseTransport(client: Socket, payload: any): void {
		const { transportId } = payload;
		const transport = this.transports.get(transportId);

		if (transport) {
			transport.close();
			this.transports.delete(transportId);
		}
	}

	@SubscribeMessage('getProducers')
	handleGetProducers(client: Socket, payload: any): { id: string }[] {
		const { roomId } = payload;

		// Check if the room exists
		const room = this.rooms.get(roomId);
		if (!room) {
			return [];
		}

		// Retrieve all producer IDs in the room
		const producerIds = Object.keys(room)
			.filter((key) => key !== 'router') // Exclude the router from the list
			.map((producerId) => ({ id: producerId }));

		return producerIds;
	}

	// Handle other signaling events, like handling errors or requesting available producers
}
