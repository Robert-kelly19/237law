import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

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
}
