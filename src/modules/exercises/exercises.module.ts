import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ExercisesController } from './exercises.controller';
import { ExercisesRepository } from './exercises.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [ExercisesController],
  providers: [ExercisesRepository],
  exports: [ExercisesRepository],
})
export class ExercisesModule {}
