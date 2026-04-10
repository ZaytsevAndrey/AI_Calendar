import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
  useCheckRequiredSettingsQuery,
} from 'api/userSettingsApi';
import { useSetupDefaultPhasesMutation } from 'api/phasesApi';
import { WeekDaysSelector } from 'modules/phases/components/WeekDaysSelector';
import { showErrorToast } from 'utils/toast';

const PhaseSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: gate } = useCheckRequiredSettingsQuery();
  const { data: settings } = useGetUserSettingsQuery();

  useEffect(() => {
    if (gate?.hasPhases) {
      navigate('/', { replace: true });
    }
  }, [gate?.hasPhases, navigate]);
  const [updateSettings, { isLoading: savingSettings }] =
    useUpdateUserSettingsMutation();
  const [setupDefaults, { isLoading: bootstrapping }] =
    useSetupDefaultPhasesMutation();

  const [wakeTime, setWakeTime] = useState('08:00');
  const [sleepTime, setSleepTime] = useState('23:00');
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);

  useEffect(() => {
    if (settings?.wakeTime) setWakeTime(settings.wakeTime);
    if (settings?.sleepTime) setSleepTime(settings.sleepTime);
  }, [settings?.wakeTime, settings?.sleepTime]);

  const errors =
    selectedDays.length === 0
      ? { weekDays: { message: 'Оберіть хоча б один день' } as { message: string } }
      : {};

  const runBootstrap = async (weekDays: number[] | undefined) => {
    try {
      await setupDefaults(
        weekDays && weekDays.length > 0 ? { weekDays } : undefined,
      ).unwrap();
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg =
        err &&
        typeof err === 'object' &&
        'data' in err &&
        (err as { data?: { message?: string } }).data?.message;
      showErrorToast(
        typeof msg === 'string' ? msg : 'Не вдалося створити фази.',
      );
    }
  };

  const handleSave = async () => {
    if (selectedDays.length === 0) {
      showErrorToast('Оберіть дні тижня');
      return;
    }
    try {
      await updateSettings({ wakeTime, sleepTime }).unwrap();
      await runBootstrap(selectedDays);
    } catch {
      showErrorToast('Не вдалося зберегти налаштування.');
    }
  };

  const handleSkip = async () => {
    await runBootstrap(undefined);
  };

  const busy = savingSettings || bootstrapping;

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', mt: { xs: 2, sm: 4 }, px: 2, pb: 4 }}>
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          Налаштуйте основні фази
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Вкажіть час підйому та сну. Будуть створені фази «Сон» і «Фокус» за
          цими межами. Оберіть дні тижня (наприклад лише будні).
        </Typography>

        <Stack spacing={2}>
          <TextField
            label="Прокинувся"
            type="time"
            value={wakeTime}
            onChange={(e) => setWakeTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <TextField
            label="Сон"
            type="time"
            value={sleepTime}
            onChange={(e) => setSleepTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <WeekDaysSelector
            selectedDays={selectedDays}
            setSelectedDays={setSelectedDays}
            errors={errors}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 3 }}>
          <Button
            variant="contained"
            fullWidth
            disabled={busy || selectedDays.length === 0}
            onClick={handleSave}
          >
            Зберегти й створити фази
          </Button>
          <Button variant="outlined" fullWidth disabled={busy} onClick={handleSkip}>
            Типові фази (поточний час у налаштуваннях)
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
};

export default PhaseSetupPage;
