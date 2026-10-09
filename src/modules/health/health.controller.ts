import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async readiness(): Promise<{ status: string }> {
    try {
      await this.database.pool.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }
}
