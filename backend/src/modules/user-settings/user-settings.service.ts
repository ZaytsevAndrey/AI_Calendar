import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSettings } from './entities/user-settings.entity';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';

@Injectable()
export class UserSettingsService {
  private readonly logger = new Logger(UserSettingsService.name);

  constructor(
    @InjectRepository(UserSettings)
    private userSettingsRepository: Repository<UserSettings>,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  async getSettings(userId: string): Promise<UserSettings> {
    // First try to find existing settings
    let userSettings = await this.userSettingsRepository.findOne({
      where: { userId },
    });

    // If settings don't exist, create default ones
    if (!userSettings) {
      userSettings = await this.createDefaultSettings(userId);
    } else {
      // If settings exist but some required fields are missing, fill them with defaults
      const defaults = this.getDefaultSettings();
      if (!userSettings.wakeTime) userSettings.wakeTime = defaults.wakeTime;
      if (!userSettings.sleepTime) userSettings.sleepTime = defaults.sleepTime;
      if (userSettings.defaultWorkBlockDuration === undefined)
        userSettings.defaultWorkBlockDuration =
          defaults.defaultWorkBlockDuration;
      if (userSettings.defaultBreakDuration === undefined)
        userSettings.defaultBreakDuration = defaults.defaultBreakDuration;
      if (userSettings.defaultLunchDuration === undefined)
        userSettings.defaultLunchDuration = defaults.defaultLunchDuration;
      if (!userSettings.preferredLunchTime)
        userSettings.preferredLunchTime = defaults.preferredLunchTime;
      if (userSettings.weekendWorkEnabled === undefined)
        userSettings.weekendWorkEnabled = defaults.weekendWorkEnabled;
      if (userSettings.allowSplitScheduling === undefined)
        userSettings.allowSplitScheduling = defaults.allowSplitScheduling;
      if (userSettings.minSplitMinutes === undefined)
        userSettings.minSplitMinutes = defaults.minSplitMinutes;
      if (userSettings.maxSplitMinutes === undefined)
        userSettings.maxSplitMinutes = defaults.maxSplitMinutes;
      if (userSettings.recurringScheduleHorizonDays === undefined)
        userSettings.recurringScheduleHorizonDays =
          defaults.recurringScheduleHorizonDays;
      if (!userSettings.appGoogleCalendarName)
        userSettings.appGoogleCalendarName = defaults.appGoogleCalendarName;

      // Save updated settings if any defaults were applied
      await this.userSettingsRepository.save(userSettings);
    }

    return userSettings;
  }

  async updateSettings(
    userId: string,
    updateUserSettingsDto: UpdateUserSettingsDto,
  ): Promise<UserSettings> {
    const userSettings = await this.getSettings(userId);
    const previousAppCalendarName = userSettings.appGoogleCalendarName;
    const nextMin =
      updateUserSettingsDto.minSplitMinutes ?? userSettings.minSplitMinutes;
    const nextMax =
      updateUserSettingsDto.maxSplitMinutes ?? userSettings.maxSplitMinutes;
    if (nextMin > nextMax) {
      updateUserSettingsDto.maxSplitMinutes = nextMin;
    }

    const updatedSettings = this.userSettingsRepository.merge(
      userSettings,
      updateUserSettingsDto,
    );
    const saved = await this.userSettingsRepository.save(updatedSettings);

    if (
      updateUserSettingsDto.appGoogleCalendarName !== undefined &&
      saved.appGoogleCalendarName !== previousAppCalendarName
    ) {
      try {
        await this.googleCalendarService.updateAppCalendarSummaryIfLinked(
          userId,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `Could not rename Google app calendar for user ${userId}: ${msg}`,
        );
      }
    }

    return saved;
  }

  getDefaultSettings() {
    return {
      wakeTime: '07:00',
      sleepTime: '22:00',
      defaultWorkBlockDuration: 25,
      defaultBreakDuration: 5,
      defaultLunchDuration: 60,
      preferredLunchTime: '12:00',
      weekendWorkEnabled: false,
      allowSplitScheduling: true,
      minSplitMinutes: 30,
      maxSplitMinutes: 30,
      recurringScheduleHorizonDays: 30,
      appGoogleCalendarName: 'AI Calendar Assistant',
    };
  }

  private async createDefaultSettings(userId: string): Promise<UserSettings> {
    const defaultSettings = this.userSettingsRepository.create({
      userId,
      wakeTime: '07:00',
      sleepTime: '22:00',
      defaultWorkBlockDuration: 25,
      defaultBreakDuration: 5,
      defaultLunchDuration: 60,
      preferredLunchTime: '12:00',
      weekendWorkEnabled: false,
      allowSplitScheduling: true,
      minSplitMinutes: 30,
      maxSplitMinutes: 30,
      recurringScheduleHorizonDays: 30,
      appGoogleCalendarName: 'AI Calendar Assistant',
    });

    return this.userSettingsRepository.save(defaultSettings);
  }
}
