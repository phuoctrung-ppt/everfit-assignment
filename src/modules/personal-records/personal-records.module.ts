import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ExercisesModule } from '../exercises/exercises.module';
import { PersonalRecordsController } from './personal-records.controller';
import { PersonalRecordsRepository } from './personal-records.repository';
import { PersonalRecordsService } from './personal-records.service';

@Module({
  imports: [DatabaseModule, ExercisesModule],
  controllers: [PersonalRecordsController],
  providers: [PersonalRecordsService, PersonalRecordsRepository],
})
export class PersonalRecordsModule {}
