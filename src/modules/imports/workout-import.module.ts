import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WorkoutImportController } from './workout-import.controller';
import { WorkoutImportRepository } from './workout-import.repository';
import { ImportWorkerService } from './import-worker.service';

@Module({
  imports: [DatabaseModule],
  controllers: [WorkoutImportController],
  providers: [WorkoutImportRepository, ImportWorkerService],
  exports: [ImportWorkerService],
})
export class WorkoutImportModule {}
