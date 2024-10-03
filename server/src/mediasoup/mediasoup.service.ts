import * as mediasoup from 'mediasoup';

export class MediasoupService {
	private mediasoupRouter: mediasoup.types.Router;

	// Initialize Mediasoup (create a router)
	async initialize(): Promise<mediasoup.types.Router> {
		const worker = await this.createWorker();
		this.mediasoupRouter = await worker.createRouter({
			mediaCodecs: [
				{
					kind: 'audio',
					mimeType: 'audio/opus',
					clockRate: 48000,
					channels: 2,
				},
				{
					kind: 'video',
					mimeType: 'video/VP8',
					clockRate: 90000,
				},
			],
		});
		return this.mediasoupRouter;
	}

	// Create worker
	private async createWorker(): Promise<mediasoup.types.Worker> {
		return await mediasoup.createWorker({
			logLevel: 'debug', // You can adjust log levels based on your need
			rtcMinPort: 20000,
			rtcMaxPort: 29999,
		});
	}

	// Create WebRTC transport options (used in the gateway)
	async createTransportOptions(): Promise<mediasoup.types.WebRtcTransportOptions> {
		return {
			listenIps: [
				{ ip: '0.0.0.0', announcedIp: '127.0.0.1' }, // Replace with your public IP
			],
			enableUdp: true,
			enableTcp: true,
			preferUdp: true,
			initialAvailableOutgoingBitrate: 1000000,
		};
	}

	// Create WebRTC transport (using options)
	async createWebRtcTransport(router: mediasoup.types.Router): Promise<mediasoup.types.WebRtcTransport> {
		const transportOptions = await this.createTransportOptions();
		return await router.createWebRtcTransport(transportOptions);
	}
}
