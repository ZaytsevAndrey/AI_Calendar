import { Controller, Get, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Get Hello message' })
  @ApiResponse({ status: 200, description: 'Returns a hello message' })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('.well-known/appspecific/com.chrome.devtools.json')
  handleChromeDevTools(@Res() res: Response) {
    // Empty JSON for Chrome DevTools
    res.status(200).json({});
  }
}
