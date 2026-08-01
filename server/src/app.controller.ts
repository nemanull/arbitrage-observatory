import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('status')
  getStatus() {}

  @Get('start')
  start() {}

  @Get('stop')
  stop() {}
}
