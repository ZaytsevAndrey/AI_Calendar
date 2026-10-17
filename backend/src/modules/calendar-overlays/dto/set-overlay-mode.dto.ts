import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetOverlayModeDto {
  @IsIn(['fixed', 'flexible'])
  schedulingMode: 'fixed' | 'flexible';

  @IsOptional()
  @IsString()
  @MaxLength(512)
  calendarId?: string;
}

export class UnscheduleOverlayDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  calendarId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;
}
