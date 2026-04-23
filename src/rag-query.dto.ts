import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class QueryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  query!: string;
}

export class SearchQueryDto extends QueryDto {}

export class AskQueryDto extends QueryDto {}
