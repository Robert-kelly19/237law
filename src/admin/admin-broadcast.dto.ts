import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class BroadcastDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(1600)
  message!: string;
}
