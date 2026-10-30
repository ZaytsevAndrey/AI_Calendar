import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlacesService } from './places.service';

@ApiTags('places')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('search')
  @ApiOperation({ summary: 'Place autocomplete for a task location (OpenStreetMap)' })
  search(@Query('q') q = '', @Query('lang') lang?: string) {
    return this.places.search(String(q).slice(0, 200), lang);
  }
}
