import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UserSettingsState {
  settingsChecked: boolean;
}

const initialState: UserSettingsState = {
  settingsChecked: false,
};

const userSettingsSlice = createSlice({
  name: 'userSettings',
  initialState,
  reducers: {
    setSettingsChecked: (state, action: PayloadAction<boolean>) => {
      state.settingsChecked = action.payload;
    },
  },
});

export const { setSettingsChecked } = userSettingsSlice.actions;
export default userSettingsSlice.reducer; 