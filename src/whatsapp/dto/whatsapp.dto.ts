import {
  IsNotEmpty,
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsEnum,
  MaxLength,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum WhatsAppMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  DOCUMENT = 'document',
  LOCATION = 'location',
  CONTACTS = 'contacts',
  INTERACTIVE = 'interactive',
  UNKNOWN = 'unknown',
}

export class WhatsAppTextPayload {
  @IsNotEmpty()
  @IsString()
  body!: string;
}

export class WhatsAppImagePayload {
  @IsNotEmpty()
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  caption?: string;
}

export class WhatsAppAudioPayload {
  @IsNotEmpty()
  @IsString()
  id!: string;
}

export class WhatsAppVideoPayload {
  @IsNotEmpty()
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  caption?: string;
}

export class WhatsAppDocumentPayload {
  @IsNotEmpty()
  @IsString()
  id!: string;

  @IsNotEmpty()
  @IsString()
  filename!: string;
}

export class WhatsAppLocationPayload {
  @IsNotEmpty()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  latitude!: number;

  @IsNotEmpty()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  longitude!: number;
}

export class WhatsAppMessageDto {
  @IsNotEmpty()
  @IsString()
  from!: string;

  @IsNotEmpty()
  @IsString()
  id!: string;

  @IsNotEmpty()
  @IsString()
  type!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppTextPayload)
  text?: WhatsAppTextPayload;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppImagePayload)
  image?: WhatsAppImagePayload;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppAudioPayload)
  audio?: WhatsAppAudioPayload;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppVideoPayload)
  video?: WhatsAppVideoPayload;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppDocumentPayload)
  document?: WhatsAppDocumentPayload;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppLocationPayload)
  location?: WhatsAppLocationPayload;

  getTextContent(): string | null {
    if (this.text?.body) return this.text.body;
    if (this.image?.caption) return this.image.caption;
    if (this.video?.caption) return this.video.caption;
    if (this.document?.filename) return this.document.filename;
    return null;
  }
}

export class WhatsAppValueDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhatsAppMessageDto)
  messages?: WhatsAppMessageDto[];
}

export class WhatsAppChangeDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppValueDto)
  value?: WhatsAppValueDto;
}

export class WhatsAppEntryDto {
  @IsNotEmpty()
  @IsString()
  id!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhatsAppChangeDto)
  changes?: WhatsAppChangeDto[];
}

export class WhatsAppWebhookDto {
  @IsNotEmpty()
  @IsString()
  object!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhatsAppEntryDto)
  entry?: WhatsAppEntryDto[];
}

export class SendMessageDto {
  @IsNotEmpty()
  @IsString()
  phoneNumber!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(4096)
  body!: string;
}
