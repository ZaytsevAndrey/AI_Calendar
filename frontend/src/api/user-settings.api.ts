import apiCall from 'modules/common/utils/apiCall';

export interface UserSettingsDTO {
  id: string;
  userId: string;
  wakeTime: string;
  sleepTime: string;
  defaultWorkBlockDuration: number;
  defaultBreakDuration: number;
  defaultLunchDuration: number;
  preferredLunchTime: string;
  weekendWorkEnabled: boolean;
  googleCalendarLinked: boolean;
  /** Name of the dedicated Google calendar used for app-created events */
  appGoogleCalendarName?: string;
  appGoogleCalendarId?: string | null;
  /** Google calendar ids hidden on the Calendar page. */
  hiddenGoogleCalendarIds?: string[] | null;
  /** Minutes kept free around fixed tasks and external Google events. 0 is off. */
  fixedEventBufferMinutes?: number;
  minSplitMinutes: number;
  maxSplitMinutes: number;
  recurringScheduleHorizonDays: number;
  timeZone?: string | null;
  remindersEnabled?: boolean;
  /** When true, voice complete / skip / move asks before writing. */
  confirmVoiceCommands?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettingsRequiredDTO {
  requiredFilled: boolean;
  hasPhases: boolean;
}

export interface UpdateUserSettingsDTO {
  wakeTime?: string;
  sleepTime?: string;
  defaultWorkBlockDuration?: number;
  defaultBreakDuration?: number;
  defaultLunchDuration?: number;
  preferredLunchTime?: string;
  weekendWorkEnabled?: boolean;
  googleCalendarLinked?: boolean;
  appGoogleCalendarName?: string;
  hiddenGoogleCalendarIds?: string[];
  fixedEventBufferMinutes?: number;
  minSplitMinutes?: number;
  maxSplitMinutes?: number;
  recurringScheduleHorizonDays?: number;
  timeZone?: string;
  remindersEnabled?: boolean;
  confirmVoiceCommands?: boolean;
}

export const UserSettingsApi = {
  getUserSettings: async (): Promise<UserSettingsDTO> => {
    const response = await apiCall({ method: 'GET', url: '/user-settings' });
    if (!response) throw new Error('No response from server');
    return response.data as UserSettingsDTO;
  },

  updateUserSettings: async (settings: UpdateUserSettingsDTO): Promise<UserSettingsDTO> => {
    const response = await apiCall({ method: 'PATCH', url: '/user-settings', data: settings });
    if (!response) throw new Error('No response from server');
    return response.data as UserSettingsDTO;
  },

  checkRequiredSettings: async (): Promise<UserSettingsRequiredDTO> => {
    const response = await apiCall({ method: 'GET', url: '/user-settings/required' });
    if (!response) throw new Error('No response from server');
    return response.data as UserSettingsRequiredDTO;
  },


}; 