import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ExercisesModule } from '../exercises/exercises.module';
import { IdempotencyRepository } from './idempotency.repository';
import { WorkoutLoggingController } from './workout-logging.controller';
import { WorkoutLoggingRepository } from './workout-logging.repository';
import { WorkoutLoggingService } from './workout-logging.service';
import { WorkoutHistoryController } from './workout-history.controller';
import { WorkoutHistoryRepository } from './workout-history.repository';
import { WorkoutHistoryService } from './workout-history.service';

@Module({
  imports: [DatabaseModule, ExercisesModule],
  controllers: [WorkoutLoggingController, WorkoutHistoryController],
  providers: [
    WorkoutLoggingService,
    WorkoutLoggingRepository,
    IdempotencyRepository,
    WorkoutHistoryService,
    WorkoutHistoryRepository,
  ],
})
export class WorkoutsModule {}
