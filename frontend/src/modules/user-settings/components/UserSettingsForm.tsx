import React, { useEffect, useState, useCallback } from 'react';
import { useForm, useController } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { UserSettingsApi, UserSettingsDTO } from '../../../api/user-settings.api';
import { googleCalendarAPI } from '../../../api/google-calendar.api';
import { Button, Box, Typography, CircularProgress, Card, CardContent } from '@mui/material';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';

interface UserSettingsFormProps {
    initialData: UserSettingsDTO;
}

interface UserSettingsFormData {
    sleepTime: string;
    wakeTime: string;
    googleCalendarLinked: boolean;
}

const UserSettingsForm: React.FC<UserSettingsFormProps> = ({ initialData }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [isConnecting, setIsConnecting] = useState(false);
    const [isDisconnecting, setIsDisconnecting] = useState(false);
    const [isCalendarConnected, setIsCalendarConnected] = useState(false);
    const [isCheckingConnection, setIsCheckingConnection] = useState(true);
    const [initialValues, setInitialValues] = useState<{sleepTime: string, wakeTime: string} | null>(null);

    const { control, setValue, watch } = useForm<UserSettingsFormData>({
        defaultValues: {
            sleepTime: initialData?.sleepTime && initialData.sleepTime !== '' ? initialData.sleepTime : '22:00',
            wakeTime: initialData?.wakeTime && initialData.wakeTime !== '' ? initialData.wakeTime : '07:00',
            googleCalendarLinked: initialData?.googleCalendarLinked || false,
        },
    });

    // Функція для конвертації string в Date
    const stringToDate = (timeString: string): Date => {
        const [hours, minutes] = timeString.split(':').map(Number);
        const date = new Date();
        date.setHours(hours, minutes, 0, 0);
        return date;
    };

    // Функція для конвертації Date в string (24-годинний формат для збереження)
    const dateToString = (date: Date | null): string => {
        if (!date) return '';
        return date.toTimeString().slice(0, 5);
    };

    // Автозбереження при зміні часу
    const sleepTime = watch('sleepTime');
    const wakeTime = watch('wakeTime');

    const sleepTimeController = useController({
        name: "sleepTime",
        control,
        rules: { required: 'Sleep time is required' }
    });

    const wakeTimeController = useController({
        name: "wakeTime",
        control,
        rules: { required: 'Wake time is required' }
    });

    useEffect(() => {
        const checkCalendarConnection = async () => {
            try {
                setIsCheckingConnection(true);
                const response = await googleCalendarAPI.checkConnection();
                const data = response.data as { connected: boolean };
                setIsCalendarConnected(data.connected);
                setValue('googleCalendarLinked', data.connected);
            } catch (error) {
                console.error('Error checking Google Calendar connection:', error);
            } finally {
                setIsCheckingConnection(false);
            }
        };

        checkCalendarConnection();
    }, [setValue]);

    // Перевіряємо URL параметри після повернення з Google OAuth
    useEffect(() => {
        const googleCalendarStatus = searchParams.get('googleCalendar');
        const error = searchParams.get('error');
        
        if (googleCalendarStatus === 'success') {
            toast.success('Google Calendar connected successfully!');
            setIsCalendarConnected(true);
            setValue('googleCalendarLinked', true);
            // Очищаємо URL параметри
            navigate('/settings', { replace: true });
        } else if (googleCalendarStatus === 'error') {
            toast.error(`Failed to connect Google Calendar: ${error || 'Unknown error'}`);
            // Очищаємо URL параметри
            navigate('/settings', { replace: true });
        }
    }, [searchParams, setValue, navigate]);

    const handleGoogleCalendarConnect = async () => {
        try {
            setIsConnecting(true);
            toast.info('Getting Google Calendar authorization URL...');
            
            const { data } = await googleCalendarAPI.getAuthUrl();
            const urlData = data as { url: string };
            
            toast.info('Redirecting to Google...');
            
            // Невелика затримка для показу повідомлення
            setTimeout(() => {
                window.location.replace(urlData.url);
            }, 500);
            
        } catch (error) {
            toast.error('Failed to get Google Calendar authorization URL');
            console.error('Error getting auth URL:', error);
            setIsConnecting(false);
        }
    };

    const handleGoogleCalendarDisconnect = async () => {
        try {
            setIsDisconnecting(true);
            toast.info('Disconnecting Google Calendar...');
            
            await googleCalendarAPI.disconnectCalendar();
            
            toast.success('Google Calendar disconnected successfully!');
            setIsCalendarConnected(false);
            setValue('googleCalendarLinked', false);
            
        } catch (error) {
            toast.error('Failed to disconnect Google Calendar');
            console.error('Error disconnecting Google Calendar:', error);
        } finally {
            setIsDisconnecting(false);
        }
    };

    // Автозбереження при зміні часу
    const autoSaveTimeSettings = useCallback(async (sleepTime: string | null | undefined, wakeTime: string | null | undefined) => {
        // Перевіряємо, що значення часу валідні
        if (!sleepTime || !wakeTime || sleepTime === '' || wakeTime === '' || 
            typeof sleepTime !== 'string' || typeof wakeTime !== 'string') {
            console.log('Skipping auto-save - invalid time values:', { sleepTime, wakeTime });
            return;
        }

        console.log('Auto-saving time settings:', { sleepTime, wakeTime });

        try {
            await UserSettingsApi.updateUserSettings({
                sleepTime: sleepTime,
                wakeTime: wakeTime,
                googleCalendarLinked: isCalendarConnected,
            });
            toast.success('Time settings saved automatically');
        } catch (error: any) {
            // Якщо помилка 401, не показуємо toast - користувач буде перенаправлений на логін
            if (error?.response?.status === 401) {
                console.log('User not authorized, skipping auto-save');
                return;
            }
            toast.error('Failed to save time settings');
            console.error('Error auto-saving time settings:', error);
        }
    }, [isCalendarConnected]);

    // Зберігаємо початкові значення
    useEffect(() => {
        if (sleepTime && wakeTime && !initialValues) {
            setInitialValues({ sleepTime, wakeTime });
        }
    }, [sleepTime, wakeTime, initialValues]);

    // Автозбереження при зміні часу
    useEffect(() => {
        console.log('Time values changed:', { sleepTime, wakeTime, initialValues });
        
        // Перевіряємо, чи значення змінилися від початкових
        const hasChanged = initialValues && 
            (sleepTime !== initialValues.sleepTime || wakeTime !== initialValues.wakeTime);
        
        if (sleepTime && wakeTime && 
            sleepTime !== '' && wakeTime !== '' && 
            typeof sleepTime === 'string' && typeof wakeTime === 'string' &&
            hasChanged) {
            const timeoutId = setTimeout(() => {
                autoSaveTimeSettings(sleepTime, wakeTime);
            }, 1000); // Затримка 1 секунда після зміни

            return () => clearTimeout(timeoutId);
        }
    }, [sleepTime, wakeTime, autoSaveTimeSettings, initialValues]);





    return (
        <Box sx={{ maxWidth: 600, mx: 'auto', mt: 4, p: 2 }}>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 300, mb: 4, textAlign: 'center' }}>
                Settings
            </Typography>

            <Card sx={{ mb: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <CardContent sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom sx={{ fontWeight: 500, mb: 3 }}>
                        Sleep Schedule
                    </Typography>
                    
                    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                                Wake Time
                            </Typography>
                            <LocalizationProvider dateAdapter={AdapterDateFns}>
                                <TimePicker
                                    value={wakeTimeController.field.value ? stringToDate(wakeTimeController.field.value) : null}
                                    onChange={(newValue) => {
                                        const timeString = dateToString(newValue);
                                        wakeTimeController.field.onChange(timeString);
                                    }}
                                    format="hh:mm a"
                                    slotProps={{
                                        textField: {
                                            size: "medium",
                                            sx: { minWidth: 250 }
                                        }
                                    }}
                                />
                            </LocalizationProvider>
                        </Box>

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                                Sleep Time
                            </Typography>
                            <LocalizationProvider dateAdapter={AdapterDateFns}>
                                <TimePicker
                                    value={sleepTimeController.field.value ? stringToDate(sleepTimeController.field.value) : null}
                                    onChange={(newValue) => {
                                        const timeString = dateToString(newValue);
                                        sleepTimeController.field.onChange(timeString);
                                    }}
                                    format="hh:mm a"
                                    slotProps={{
                                        textField: {
                                            size: "medium",
                                            sx: { minWidth: 250 }
                                        }
                                    }}
                                />
                            </LocalizationProvider>
                        </Box>
                    </Box>
                </CardContent>
            </Card>

            <Card sx={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <CardContent sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom sx={{ fontWeight: 500, mb: 3 }}>
                        Google Calendar Integration
                    </Typography>
                    
                    {isCheckingConnection ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <CircularProgress size={20} />
                            <Typography variant="body2" color="text.secondary">
                                Checking connection status...
                            </Typography>
                        </Box>
                    ) : isCalendarConnected ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                                <Box sx={{ 
                                    width: 12, 
                                    height: 12, 
                                    borderRadius: '50%', 
                                    bgcolor: 'success.main',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <Typography variant="caption" color="white" sx={{ fontSize: '0.7rem' }}>✓</Typography>
                                </Box>
                                <Typography variant="body1" color="success.main" sx={{ fontWeight: 500 }}>
                                    Connected to Google Calendar
                                </Typography>
                            </Box>
                            <Button
                                variant="outlined"
                                color="error"
                                onClick={handleGoogleCalendarDisconnect}
                                disabled={isDisconnecting}
                                startIcon={isDisconnecting ? <CircularProgress size={16} /> : null}
                                sx={{
                                    alignSelf: 'flex-start',
                                    minWidth: 200,
                                    transition: 'all 0.2s ease',
                                    '&:hover': {
                                        transform: isDisconnecting ? 'none' : 'translateY(-1px)',
                                        boxShadow: isDisconnecting ? 'none' : '0 2px 4px rgba(0,0,0,0.1)',
                                    }
                                }}
                            >
                                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                            </Button>
                        </Box>
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                Connect your Google Calendar to sync events and manage your schedule
                            </Typography>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={handleGoogleCalendarConnect}
                                disabled={isConnecting}
                                startIcon={isConnecting ? <CircularProgress size={16} /> : null}
                                sx={{
                                    alignSelf: 'flex-start',
                                    minWidth: 200,
                                    transition: 'all 0.2s ease',
                                    '&:hover': {
                                        transform: isConnecting ? 'none' : 'translateY(-1px)',
                                        boxShadow: isConnecting ? 'none' : '0 2px 4px rgba(0,0,0,0.1)',
                                    }
                                }}
                            >
                                {isConnecting ? 'Connecting...' : 'Connect Google Calendar'}
                            </Button>
                        </Box>
                    )}
                </CardContent>
            </Card>
        </Box>
    );
};

export default UserSettingsForm; 