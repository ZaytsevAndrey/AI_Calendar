import {
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ScheduleJobService } from './schedule-job.service';

@ApiTags('schedule-jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedule-jobs')
export class ScheduleJobController {
  constructor(private readonly scheduleJobService: ScheduleJobService) {}

  @Post('replan')
  @ApiOperation({ summary: 'Enqueue full intelligent replan for current user' })
  @ApiResponse({ status: 201, description: 'Job created' })
  async replan(@Request() req) {
    const job = await this.scheduleJobService.enqueueReplan(req.user.userId);
    return { jobId: job.id, status: job.status };
  }

  @Get('undo')
  @ApiOperation({ summary: 'Whether the last Calendar Generate can be undone' })
  async undoAvailability(@Request() req) {
    return this.scheduleJobService.getUndoAvailability(req.user.userId);
  }

  @Post('undo')
  @ApiOperation({
    summary:
      'Restore local slots and Google events from before the last Calendar Generate. Finished blocks stay.',
  })
  async undo(@Request() req) {
    return this.scheduleJobService.undoLastGenerate(req.user.userId);
  }

  @Get('latest/done')
  @ApiOperation({ summary: 'Latest completed job for current user' })
  async latestDone(@Request() req) {
    const job = await this.scheduleJobService.getLatestDoneJob(req.user.userId);
    if (!job) return { job: null };
    let result: unknown = null;
    if (job.resultDiffJson) {
      try {
        result = JSON.parse(job.resultDiffJson);
      } catch {
        result = job.resultDiffJson;
      }
    }
    return {
      job: {
        id: job.id,
        status: job.status,
        result,
        updatedAt: job.updatedAt,
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get job status and result' })
  @ApiResponse({ status: 200, description: 'Job' })
  async getOne(@Param('id') id: string, @Request() req) {
    const job = await this.scheduleJobService.getJob(id, req.user.userId);
    let result: unknown = null;
    if (job.resultDiffJson) {
      try {
        result = JSON.parse(job.resultDiffJson);
      } catch {
        result = job.resultDiffJson;
      }
    }
    return {
      id: job.id,
      status: job.status,
      errorMessage: job.errorMessage,
      result,
      progressStage: job.progressStage,
      progressCurrent: job.progressCurrent,
      progressTotal: job.progressTotal,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
