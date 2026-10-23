import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Request,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { VoiceTraceInterceptor } from '../../common/voice-trace.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ParseVoiceTaskDto } from './dto/parse-voice-task.dto';
import { TranscribeVoiceDto } from './dto/transcribe-voice.dto';
import { VoiceTurnDto } from './dto/voice-turn.dto';
import { SpeakVoiceDto } from './dto/speak-voice.dto';
import { AzureTtsClient } from './azure-tts';
import { PiperSpeechService } from './piper-speech.service';
import { VoiceService } from './voice.service';

@ApiTags('voice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(VoiceTraceInterceptor)
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    private readonly piper: PiperSpeechService,
    private readonly azureTts: AzureTtsClient,
  ) {}

  @Post('transcribe')
  @ApiOperation({
    summary:
      'Transcribe recorded audio with Azure Speech when configured, otherwise Groq Whisper',
  })
  @ApiResponse({ status: 201, description: 'Transcript text' })
  transcribe(@Request() req, @Body() dto: TranscribeVoiceDto) {
    return this.voiceService.transcribe(req.user.userId, dto);
  }

  @Post('parse-task')
  @ApiOperation({
    summary:
      'Turn a transcript into a create-task payload or a complete, skip, or reschedule command',
  })
  @ApiResponse({ status: 201, description: 'Parse result with understanding' })
  parseTask(@Request() req, @Body() dto: ParseVoiceTaskDto) {
    return this.voiceService.parseTask(req.user.userId, dto);
  }

  @Post('turn')
  @ApiOperation({
    summary:
      'Voice Agent turn: grounded Q&A via tools, or legacy parse for mutations',
  })
  @ApiResponse({ status: 201, description: 'Agent turn result' })
  turn(@Request() req, @Body() dto: VoiceTurnDto) {
    return this.voiceService.turn(req.user.userId, dto);
  }

  @Post('speak')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Synthesize a voice reply with Azure Speech when configured, otherwise local Piper',
  })
  @ApiResponse({ status: 200, description: 'WAV audio' })
  async speak(@Body() dto: SpeakVoiceDto): Promise<StreamableFile> {
    const wav = this.azureTts.enabled()
      ? await this.azureTts.synthesize(dto.text, dto.language)
      : await this.piper.synthesize(dto.text, dto.language);
    return new StreamableFile(wav, { type: 'audio/wav' });
  }

  @Delete('session/:sessionId')
  @ApiOperation({ summary: 'Discard an in-memory voice agent session' })
  @ApiResponse({ status: 200, description: 'Session cleared' })
  endSession(@Request() req, @Param('sessionId') sessionId: string) {
    return this.voiceService.endVoiceSession(req.user.userId, sessionId);
  }
}
