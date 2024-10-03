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

const joinRoom = async () => {
	try {
		socket.emit('getRouterRtpCapabilities', {roomId: 1}, async (routerRtpCapabilities: RouterRtpCapabilities) => {
			device = new mediasoupClient.Device();
			await device.load({ routerRtpCapabilities });

			// Step 3: Request transport creation from the server
			socket.emit('createWebRtcTransport', { forceTcp: false, roomId: 1 }, async (transportInfo: ServerTransportOptions) => {
				// Step 4: Create a transport on the client
				console.log('Transport created:', transportInfo);
				sendTransport = device!.createSendTransport(transportInfo);

				// Handle transport connection events (DTLS, ICE candidates)
				sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
					console.log('Transport connected');
					socket.emit(
						'connectTransport',
						{ transportId: sendTransport!.id, dtlsParameters },
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
					socket.emit('produce', { transportId: sendTransport!.id, ...parameters, roomId: 1 }, (id: string) => {
						callback({ id });
					});
				});

				// Step 5: Capture local media stream
				const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

			
				// Step 6: Produce video track and send to server
				const videoTrack = stream.getVideoTracks()[0];
				producer = await sendTransport.produce({ track: videoTrack });

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

function App() {
	return (
		<div className="main">
			<button onClick={() => {
				console.log(device)
				console.log(sendTransport)
				console.log(producer)
			}}> log </button>
			<button onClick={joinRoom}>cam</button>
			<video id="localVideo" autoPlay muted></video>
			<video id="remoteVideo" autoPlay></video>
		</div>
	);
}

export default App;
