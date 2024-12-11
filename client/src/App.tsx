import './assets/styles/App.css';
import * as mediasoupClient from 'mediasoup-client';
import io from 'socket.io-client';
import { useEffect, useRef } from 'react';

interface ServerTransportOptions {
	id: string;
	iceParameters: mediasoupClient.types.IceParameters;
	iceCandidates: mediasoupClient.types.IceCandidate[];
	dtlsParameters: mediasoupClient.types.DtlsParameters;
	sctpParameters?: mediasoupClient.types.SctpParameters;
}

interface RouterRtpCapabilities {
	codecs: mediasoupClient.types.RtpCodecCapability[];
	headerExtensions: mediasoupClient.types.RtpHeaderExtension[];
	fecMechanisms?: string[];
}

const socket = io('http://localhost:3000');
let device: mediasoupClient.Device | null = null;
let sendTransport: mediasoupClient.types.Transport | null = null;
let producer: mediasoupClient.types.Producer | null = null;

const produce = async () => {
	try {
		socket.emit('getRouterRtpCapabilities', {channelId: 1}, async (routerRtpCapabilities: RouterRtpCapabilities) => {
			device = new mediasoupClient.Device();
			await device.load({ routerRtpCapabilities });

			// Step 3: Request transport creation from the server
			socket.emit('createWebRtcTransport', { forceTcp: false, channelId: 1 }, async (transportInfo: ServerTransportOptions) => {
				// Step 4: Create a transport on the client
				console.log('Transport created:', transportInfo);
				sendTransport = device!.createSendTransport(transportInfo);

				// Handle transport connection events (DTLS, ICE candidates)
				sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
					console.log('Transport connected');
					socket.emit(
						'connectTransport',
						{ transportId: sendTransport!.id, dtlsParameters, channelId: 1 },
						(resp: string) => {
							console.log("connectTransport resp", resp)
							if (resp === "SUCCESS") {
								callback()
							}else {
								errback(new Error("Error from connect resp"))
							}
						}
					);
				});

				// Handle transport 'produce' event for new producer
				sendTransport.on('produce', (parameters, callback, errback) => {
					console.log('Producing media');
					socket.emit('produce', { transportId: sendTransport!.id, ...parameters, channelId: 1 }, (id: string) => {
						callback({ id });
					});
				});

				// Step 5: Capture local media stream
				const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

			
				// Step 6: Produce video track and send to server
				const videoTrack = stream.getVideoTracks()[0];
				producer = await sendTransport.produce({ track: videoTrack });

				// Produce audio track and send to server
				const audioTrack = stream.getAudioTracks()[0];
				const audioProducer = await sendTransport.produce({ track: audioTrack });

				// Optional: Handle producer events (like 'trackended', etc.)
				producer.on('trackended', () => {
					console.log('Track ended');
				});

				// Display local video in the element
				const localVideo = document.getElementById('localVideo') as HTMLVideoElement;
				if (localVideo) {
					localVideo.srcObject = stream;
				}

			});
		});
	} catch (error) {
		console.error('Error joining room:', error);
	}
};

const consume = async () => {
	try {
		// Step 1: Get router RTP capabilities
		socket.emit('getRouterRtpCapabilities', { channelId: 1 }, async (routerRtpCapabilities: RouterRtpCapabilities) => {
			// Initialize device if not already done
			if (!device) {
				device = new mediasoupClient.Device();
				await device.load({ routerRtpCapabilities });
			}

			// Step 2: Create a receiving transport
			socket.emit('createWebRtcTransport', { forceTcp: false, channelId: 1 }, async (transportInfo: ServerTransportOptions) => {
				const recvTransport = device!.createRecvTransport(transportInfo);

				recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
					socket.emit(
						'connectTransport',
						{ transportId: recvTransport.id, dtlsParameters, channelId: 1 },
						(resp: string) => {
							if (resp === 'SUCCESS') {
								callback();
							} else {
								errback(new Error('Error connecting transport'));
							}
						}
					);
				});

				// Step 3: Request producers from the server
				socket.emit('getProducers', { channelId: 1 }, async (producers: { id: string }[]) => {
					if (producers.length === 0) {
						console.log('No producers available');
						return;
					}

					// Step 4: Consume each producer
					for (const producer of producers) {
						// Request consumer parameters for this producer
						socket.emit(
							'consume',
							{
								transportId: recvTransport.id,
								channelId: 1,
								producerId: producer.id,
								rtpCapabilities: device!.rtpCapabilities, // Send device RTP capabilities
							},
							async (consumeParams: {
								id: string;
								producerId: string;
								kind: mediasoupClient.types.MediaKind;
								rtpParameters: mediasoupClient.types.RtpParameters;
							}) => {
								console.log(consumeParams)
								// Create a consumer using the parameters from the server
								const consumer = await recvTransport.consume(consumeParams);

								const remoteStream = new MediaStream();
								remoteStream.addTrack(consumer.track);

								if (consumeParams.kind === 'video') {
	
									const remoteVideo = document.getElementById('remoteVideo') as HTMLVideoElement;
									if (remoteVideo) {
										remoteVideo.srcObject = remoteStream;
										remoteVideo.play().catch((error) => {
											console.warn('Error playing remote video:', error.message);
										});
									}
								}

								if (consumeParams.kind === 'audio') {
									const remoteAudio = document.getElementById('remoteAudio') as HTMLAudioElement;
									if (remoteAudio) {
										remoteAudio.srcObject = remoteStream;
										remoteAudio.play().catch((error) => {
											console.warn('Error playing remote audio:', error.message);
										});
									}
								}

								// Attach the track to a MediaStream and play it in the video element
							}
						);
					}
				});
			});
		});
	} catch (error) {
		console.error('Error consuming media:', error);
	}
};


function App() {
	return (
		<div className="main">
			<button onClick={() => {
				console.log(device)
				console.log(sendTransport)
				console.log(producer)
			}}> log </button>
			<button onClick={produce}>cam</button>
			<button onClick={consume}>consume</button>
			<button onClick={() => {
				socket.emit("reset")
			}}>reset</button>
			<div className="local">
				local video
				<video id="localVideo" autoPlay muted></video>
			</div>
			<div className="remote">
				remote video
				<video id="remoteVideo" autoPlay></video>
				<audio id='remoteAudio' autoPlay></audio>
			</div>
		</div>
	);
}

export default App;
