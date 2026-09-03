import { IsNotEmpty, IsString } from 'class-validator';

export class CreateSmDto {
  @IsString()
  @IsNotEmpty()
  senderAddress: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}
