import { Controller, Get } from '@nestjs/common';
import { Orchestrator, type OrchestratorStatus } from './orchestrator';

// The engine starts itself on boot and stops itself on shutdown.
// These routes exist so a run can be inspected, paused and resumed without restarting the process.
@Controller()
export class AppController {
  constructor(private readonly orchestrator: Orchestrator) {}

  @Get('status')
  getStatus(): OrchestratorStatus {
    return this.orchestrator.status();
  }

  @Get('start')
  async start(): Promise<OrchestratorStatus> {
    await this.orchestrator.start();

    return this.orchestrator.status();
  }

  @Get('stop')
  async stop(): Promise<OrchestratorStatus> {
    await this.orchestrator.stop();

    return this.orchestrator.status();
  }
}
