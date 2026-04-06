import { UserSettingsDTO } from '../../../api/user-settings.api';
import { UserSettingsApi } from '../../../api/user-settings.api';

export const useUserSettings = () => {
    const userSettings = UserSettingsApi.getUserSettings();

    return userSettings;
}; 