import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ParseVoiceTaskDto } from './dto/parse-voice-task.dto';
import { TranscribeVoiceDto } from './dto/transcribe-voice.dto';
import { VoiceService } from './voice.service';

@ApiTags('voice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('voice')
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @Post('transcribe')
  @ApiOperation({ summary: 'Transcribe recorded audio with Groq Whisper' })
  @ApiResponse({ status: 201, description: 'Transcript text' })
  transcribe(@Body() dto: TranscribeVoiceDto) {
    return this.voiceService.transcribe(dto);
  }

  @Post('parse-task')
  @ApiOperation({
    summary: 'Turn a transcript into a structured create-task payload',
  })
  @ApiResponse({ status: 201, description: 'Parse result with understanding' })
  parseTask(@Request() req, @Body() dto: ParseVoiceTaskDto) {
    return this.voiceService.parseTask(req.user.userId, dto);
  }
}
