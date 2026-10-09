import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ExercisesController } from './exercises.controller';
import { ExercisesRepository } from './exercises.repository';
import { ExercisesService } from './exercises.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ExercisesController],
  providers: [ExercisesRepository, ExercisesService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
