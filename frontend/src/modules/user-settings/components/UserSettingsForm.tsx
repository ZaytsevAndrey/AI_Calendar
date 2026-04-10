import React, { useEffect, useState, useCallback } from 'react';
import { useForm, useController } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { UserSettingsApi, UserSettingsDTO } from '../../../api/user-settings.api';
import { googleCalendarAPI } from '../../../api/google-calendar.api';
import { Spinner } from '../../../ui/Spinner';

interface UserSettingsFormProps {
    initialData: UserSettingsDTO;
}

interface UserSettingsFormData {
    sleepTime: string;
    wakeTime: string;
    googleCalendarLinked: boolean;
}

const fieldClass = 'ui-input max-w-xs';

const UserSettingsForm: React.FC<UserSettingsFormProps> = ({ initialData }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [isConnecting, setIsConnecting] = useState(false);
    const [isDisconnecting, setIsDisconnecting] = useState(false);
    const [isCalendarConnected, setIsCalendarConnected] = useState(false);
    const [isCheckingConnection, setIsCheckingConnection] = useState(true);
    const [initialValues, setInitialValues] = useState<{ sleepTime: string; wakeTime: string } | null>(
        null
    );

    const { control, setValue, watch } = useForm<UserSettingsFormData>({
        defaultValues: {
            sleepTime:
                initialData?.sleepTime && initialData.sleepTime !== '' ? initialData.sleepTime : '22:00',
            wakeTime:
                initialData?.wakeTime && initialData.wakeTime !== '' ? initialData.wakeTime : '07:00',
            googleCalendarLinked: initialData?.googleCalendarLinked || false,
        },
    });

    const sleepTime = watch('sleepTime');
    const wakeTime = watch('wakeTime');

    const sleepTimeController = useController({
        name: 'sleepTime',
        control,
        rules: { required: 'Sleep time is required' },
    });

    const wakeTimeController = useController({
        name: 'wakeTime',
        control,
        rules: { required: 'Wake time is required' },
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

    useEffect(() => {
        const googleCalendarStatus = searchParams.get('googleCalendar');
        const error = searchParams.get('error');

        if (googleCalendarStatus === 'success') {
            toast.success('Google Calendar connected successfully!');
            setIsCalendarConnected(true);
            setValue('googleCalendarLinked', true);
            navigate('/settings', { replace: true });
        } else if (googleCalendarStatus === 'error') {
            toast.error(`Failed to connect Google Calendar: ${error || 'Unknown error'}`);
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

    const autoSaveTimeSettings = useCallback(
        async (st: string | null | undefined, wt: string | null | undefined) => {
            if (!st || !wt || st === '' || wt === '' || typeof st !== 'string' || typeof wt !== 'string') {
                return;
            }

            try {
                await UserSettingsApi.updateUserSettings({
                    sleepTime: st,
                    wakeTime: wt,
                    googleCalendarLinked: isCalendarConnected,
                });
                toast.success('Time settings saved automatically');
            } catch (error: any) {
                if (error?.response?.status === 401) {
                    return;
                }
                toast.error('Failed to save time settings');
                console.error('Error auto-saving time settings:', error);
            }
        },
        [isCalendarConnected]
    );

    useEffect(() => {
        if (sleepTime && wakeTime && !initialValues) {
            setInitialValues({ sleepTime, wakeTime });
        }
    }, [sleepTime, wakeTime, initialValues]);

    useEffect(() => {
        const hasChanged =
            initialValues &&
            (sleepTime !== initialValues.sleepTime || wakeTime !== initialValues.wakeTime);

        if (
            sleepTime &&
            wakeTime &&
            sleepTime !== '' &&
            wakeTime !== '' &&
            typeof sleepTime === 'string' &&
            typeof wakeTime === 'string' &&
            hasChanged
        ) {
            const timeoutId = setTimeout(() => {
                autoSaveTimeSettings(sleepTime, wakeTime);
            }, 1000);

            return () => clearTimeout(timeoutId);
        }
    }, [sleepTime, wakeTime, autoSaveTimeSettings, initialValues]);

    return (
        <div className="space-y-10">
            <section>
                <h2 className="mb-4 text-lg font-semibold text-ide-text">Sleep schedule</h2>
                <p className="ui-hint mb-6">Changes save automatically after you stop editing.</p>
                <div className="flex flex-col gap-6 sm:flex-row sm:flex-wrap">
                    <div className="flex flex-col gap-1">
                        <label htmlFor="wake-time" className="ui-label">
                            Wake time
                        </label>
                        <input
                            id="wake-time"
                            type="time"
                            className={fieldClass}
                            value={wakeTimeController.field.value || ''}
                            onChange={(e) => wakeTimeController.field.onChange(e.target.value)}
                            onBlur={wakeTimeController.field.onBlur}
                            name={wakeTimeController.field.name}
                            ref={wakeTimeController.field.ref}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label htmlFor="sleep-time" className="ui-label">
                            Sleep time
                        </label>
                        <input
                            id="sleep-time"
                            type="time"
                            className={fieldClass}
                            value={sleepTimeController.field.value || ''}
                            onChange={(e) => sleepTimeController.field.onChange(e.target.value)}
                            onBlur={sleepTimeController.field.onBlur}
                            name={sleepTimeController.field.name}
                            ref={sleepTimeController.field.ref}
                        />
                    </div>
                </div>
            </section>

            <section className="border-t border-ide-border pt-10">
                <h2 className="mb-4 text-lg font-semibold text-ide-text">Google Calendar</h2>

                {isCheckingConnection ? (
                    <div className="flex items-center gap-3">
                        <Spinner className="h-5 w-5" />
                        <span className="text-sm text-ide-muted">Checking connection status...</span>
                    </div>
                ) : isCalendarConnected ? (
                    <div className="flex flex-col gap-4">
                        <div className="mb-2 flex items-center gap-3">
                            <span className="flex h-3 w-3 items-center justify-center rounded-full bg-ide-dim text-[0.65rem] text-ide-bg">
                                ✓
                            </span>
                            <span className="font-medium text-ide-dim">Connected to Google Calendar</span>
                        </div>
                        <button
                            type="button"
                            onClick={handleGoogleCalendarDisconnect}
                            disabled={isDisconnecting}
                            className="ui-btn-secondary border-ide-error text-ide-error hover:bg-ide-error/10 sm:w-auto"
                        >
                            {isDisconnecting ? (
                                <span className="inline-flex items-center gap-2">
                                    <Spinner className="h-4 w-4" /> Disconnecting...
                                </span>
                            ) : (
                                'Disconnect'
                            )}
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <p className="mb-1 text-sm text-ide-muted">
                            Connect your Google Calendar to sync events and manage your schedule
                        </p>
                        <button
                            type="button"
                            onClick={handleGoogleCalendarConnect}
                            disabled={isConnecting}
                            className="ui-btn-primary w-full sm:w-auto sm:min-w-[200px]"
                        >
                            {isConnecting ? (
                                <span className="inline-flex items-center gap-2">
                                    <Spinner className="h-4 w-4 border-t-white" /> Connecting...
                                </span>
                            ) : (
                                'Connect Google Calendar'
                            )}
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
};

export default UserSettingsForm;
