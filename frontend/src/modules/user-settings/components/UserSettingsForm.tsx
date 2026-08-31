import React, { useEffect, useState, useCallback } from 'react';
import { useForm, useController } from 'react-hook-form';
import { toast } from 'react-toastify';
import { UserSettingsDTO } from '../../../api/user-settings.api';
import { useUpdateUserSettingsMutation } from '../../../api/userSettingsApi';
import { googleCalendarAPI } from '../../../api/google-calendar.api';
import { Spinner } from '../../../ui/Spinner';

interface UserSettingsFormProps {
    initialData: UserSettingsDTO;
}

interface UserSettingsFormData {
    sleepTime: string;
    wakeTime: string;
    googleCalendarLinked: boolean;
    appGoogleCalendarName: string;
    minSplitMinutes: number;
    maxSplitMinutes: number;
    recurringScheduleHorizonDays: number;
}

const fieldClass = 'ui-input max-w-xs';

const UserSettingsForm: React.FC<UserSettingsFormProps> = ({ initialData }) => {
    const [isCalendarConnected, setIsCalendarConnected] = useState(false);
    const [isCheckingConnection, setIsCheckingConnection] = useState(true);
    const [updateUserSettings] = useUpdateUserSettingsMutation();
    const [initialValues, setInitialValues] = useState<{ sleepTime: string; wakeTime: string; minSplitMinutes: number; maxSplitMinutes: number; recurringScheduleHorizonDays: number } | null>(
        null
    );

    const { control, setValue, watch, getValues } = useForm<UserSettingsFormData>({
        defaultValues: {
            sleepTime:
                initialData?.sleepTime && initialData.sleepTime !== '' ? initialData.sleepTime : '22:00',
            wakeTime:
                initialData?.wakeTime && initialData.wakeTime !== '' ? initialData.wakeTime : '07:00',
            googleCalendarLinked: initialData?.googleCalendarLinked || false,
            appGoogleCalendarName:
                initialData?.appGoogleCalendarName?.trim() || 'AI Calendar Assistant',
            minSplitMinutes:
                typeof initialData?.minSplitMinutes === 'number'
                    ? initialData.minSplitMinutes
                    : 30,
            maxSplitMinutes:
                typeof initialData?.maxSplitMinutes === 'number'
                    ? initialData.maxSplitMinutes
                    : 30,
            recurringScheduleHorizonDays:
                typeof initialData?.recurringScheduleHorizonDays === 'number'
                    ? initialData.recurringScheduleHorizonDays
                    : 30,
        },
    });

    const sleepTime = watch('sleepTime');
    const wakeTime = watch('wakeTime');
    const minSplitMinutes = watch('minSplitMinutes');
    const maxSplitMinutes = watch('maxSplitMinutes');
    const recurringScheduleHorizonDays = watch('recurringScheduleHorizonDays');
    const appGoogleCalendarName = watch('appGoogleCalendarName');

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

    const saveAppCalendarName = async () => {
        const v = (getValues('appGoogleCalendarName') ?? '').trim() || 'AI Calendar Assistant';
        try {
            await updateUserSettings({
                appGoogleCalendarName: v,
                googleCalendarLinked: isCalendarConnected,
            }).unwrap();
            toast.success('Calendar name saved');
        } catch (error: any) {
            if (error?.response?.status === 401) return;
            toast.error('Failed to save calendar name');
            console.error(error);
        }
    };

    const autoSaveTimeSettings = useCallback(
        async (
            st: string | null | undefined,
            wt: string | null | undefined,
            minSplit: number | null | undefined,
            maxSplit: number | null | undefined,
            horizonDays: number | null | undefined
        ) => {
            if (!st || !wt || st === '' || wt === '' || typeof st !== 'string' || typeof wt !== 'string') {
                return;
            }
            if (
                typeof minSplit !== 'number' ||
                Number.isNaN(minSplit) ||
                minSplit < 5 ||
                minSplit > 240
            ) {
                return;
            }
            if (
                typeof maxSplit !== 'number' ||
                Number.isNaN(maxSplit) ||
                maxSplit < 5 ||
                maxSplit > 480
            ) {
                return;
            }
            if (typeof horizonDays !== 'number' || Number.isNaN(horizonDays) || horizonDays < 1 || horizonDays > 365) {
                return;
            }

            try {
                await updateUserSettings({
                    sleepTime: st,
                    wakeTime: wt,
                    googleCalendarLinked: isCalendarConnected,
                    minSplitMinutes: minSplit,
                    maxSplitMinutes: Math.max(minSplit, maxSplit),
                    recurringScheduleHorizonDays: horizonDays,
                }).unwrap();
                toast.success('Settings saved automatically');
            } catch (error: any) {
                if (error?.response?.status === 401) {
                    return;
                }
                toast.error('Failed to save settings');
                console.error('Error auto-saving settings:', error);
            }
        },
        [isCalendarConnected, updateUserSettings]
    );

    useEffect(() => {
        if (
            sleepTime &&
            wakeTime &&
            typeof minSplitMinutes === 'number' &&
            typeof maxSplitMinutes === 'number' &&
            typeof recurringScheduleHorizonDays === 'number' &&
            !initialValues
        ) {
            setInitialValues({ sleepTime, wakeTime, minSplitMinutes, maxSplitMinutes, recurringScheduleHorizonDays });
        }
    }, [sleepTime, wakeTime, minSplitMinutes, maxSplitMinutes, recurringScheduleHorizonDays, initialValues]);

    useEffect(() => {
        const hasChanged =
            initialValues &&
            (
                sleepTime !== initialValues.sleepTime ||
                wakeTime !== initialValues.wakeTime ||
                minSplitMinutes !== initialValues.minSplitMinutes ||
                maxSplitMinutes !== initialValues.maxSplitMinutes ||
                recurringScheduleHorizonDays !== initialValues.recurringScheduleHorizonDays
            );

        if (
            sleepTime &&
            wakeTime &&
            sleepTime !== '' &&
            wakeTime !== '' &&
            typeof sleepTime === 'string' &&
            typeof wakeTime === 'string' &&
            typeof minSplitMinutes === 'number' &&
            typeof maxSplitMinutes === 'number' &&
            typeof recurringScheduleHorizonDays === 'number' &&
            hasChanged
        ) {
            const timeoutId = setTimeout(() => {
                autoSaveTimeSettings(
                    sleepTime,
                    wakeTime,
                    minSplitMinutes,
                    maxSplitMinutes,
                    recurringScheduleHorizonDays
                );
            }, 1000);

            return () => clearTimeout(timeoutId);
        }
    }, [sleepTime, wakeTime, minSplitMinutes, maxSplitMinutes, recurringScheduleHorizonDays, autoSaveTimeSettings, initialValues]);

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
                    <div className="flex flex-col gap-1">
                        <label htmlFor="min-split-minutes" className="ui-label">
                            Min split chunk (minutes)
                        </label>
                        <input
                            id="min-split-minutes"
                            type="number"
                            min={5}
                            max={240}
                            className={fieldClass}
                            value={minSplitMinutes || 30}
                            onChange={(e) => {
                                const parsed = parseInt(e.target.value, 10);
                                const nextMin = Number.isNaN(parsed) ? 30 : parsed;
                                setValue('minSplitMinutes', nextMin);
                                if ((maxSplitMinutes || 30) < nextMin) {
                                    setValue('maxSplitMinutes', nextMin);
                                }
                            }}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label htmlFor="max-split-minutes" className="ui-label">
                            Max split chunk (minutes)
                        </label>
                        <input
                            id="max-split-minutes"
                            type="number"
                            min={5}
                            max={480}
                            className={fieldClass}
                            value={maxSplitMinutes || 30}
                            onChange={(e) => {
                                const parsed = parseInt(e.target.value, 10);
                                const nextMax = Number.isNaN(parsed) ? 30 : parsed;
                                setValue('maxSplitMinutes', Math.max(minSplitMinutes || 30, nextMax));
                            }}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label htmlFor="recurring-horizon-days" className="ui-label">
                            Recurring schedule horizon (days)
                        </label>
                        <input
                            id="recurring-horizon-days"
                            type="number"
                            min={1}
                            max={365}
                            className={fieldClass}
                            value={recurringScheduleHorizonDays || 30}
                            onChange={(e) => {
                                const parsed = parseInt(e.target.value, 10);
                                setValue('recurringScheduleHorizonDays', Number.isNaN(parsed) ? 30 : parsed);
                            }}
                        />
                    </div>
                </div>
            </section>

            <section className="border-t border-ide-border pt-10">
                <h2 className="mb-4 text-lg font-semibold text-ide-text">Google Calendar</h2>

                <div className="mb-6 flex max-w-md flex-col gap-1">
                    <label htmlFor="app-google-calendar-name" className="ui-label">
                        App calendar name
                    </label>
                    <input
                        id="app-google-calendar-name"
                        type="text"
                        className={fieldClass}
                        maxLength={200}
                        value={appGoogleCalendarName ?? ''}
                        onChange={(e) => setValue('appGoogleCalendarName', e.target.value, { shouldDirty: true })}
                        onBlur={() => void saveAppCalendarName()}
                    />
                    <p className="text-xs text-ide-muted">
                        Events created by this app are written to a separate Google calendar with this title. Rename
                        it here anytime; if Google is connected, the calendar title updates automatically.
                    </p>
                </div>

                {isCheckingConnection ? (
                    <div className="flex items-center gap-3">
                        <Spinner className="h-5 w-5" />
                        <span className="text-sm text-ide-muted">Checking connection status...</span>
                    </div>
                ) : isCalendarConnected ? (
                    <div className="flex items-center gap-3">
                        <span className="flex h-3 w-3 items-center justify-center rounded-full bg-ide-dim text-[0.65rem] text-ide-bg">
                            ✓
                        </span>
                        <span className="font-medium text-ide-dim">Linked with your Google account</span>
                    </div>
                ) : (
                    <p className="text-sm text-ide-muted">
                        Calendar is linked automatically when you sign in with Google. Sign out and sign in again if
                        this status does not update.
                    </p>
                )}
            </section>
        </div>
    );
};

export default UserSettingsForm;
