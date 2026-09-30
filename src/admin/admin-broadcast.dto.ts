import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class BroadcastDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(1600)
  message!: string;
}
