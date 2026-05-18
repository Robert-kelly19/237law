import { IsNotEmpty, IsString, MaxLength, IsOptional } from 'class-validator';

export class SearchQueryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  query!: string;
}

export class AskQueryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  query!: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}
