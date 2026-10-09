import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ExercisesModule } from '../exercises/exercises.module';
import { IdempotencyRepository } from './idempotency.repository';
import { WorkoutLoggingController } from './workout-logging.controller';
import { WorkoutLoggingRepository } from './workout-logging.repository';
import { WorkoutLoggingService } from './workout-logging.service';

@Module({
  imports: [DatabaseModule, ExercisesModule],
  controllers: [WorkoutLoggingController],
  providers: [
    WorkoutLoggingService,
    WorkoutLoggingRepository,
    IdempotencyRepository,
  ],
})
export class WorkoutsModule {}
