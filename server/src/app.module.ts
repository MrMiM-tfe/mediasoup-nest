import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MediasoupService } from './mediasoup/mediasoup.service';
import { MediasoupModule } from './mediasoup/mediasoup.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
	imports: [
		ServeStaticModule.forRoot({
			rootPath: join(__dirname, '..', 'client'),
		}),
		MediasoupModule,
	],
	controllers: [AppController],
	providers: [AppService, MediasoupService],
})
export class AppModule {}
