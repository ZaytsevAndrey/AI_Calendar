import React, { useEffect, useState } from 'react';
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

    const [updateSettings, { isLoading: savingSettings }] = useUpdateUserSettingsMutation();
    const [setupDefaults, { isLoading: bootstrapping }] = useSetupDefaultPhasesMutation();

    const [wakeTime, setWakeTime] = useState('08:00');
    const [sleepTime, setSleepTime] = useState('23:00');
    const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);

    useEffect(() => {
        if (settings?.wakeTime) setWakeTime(settings.wakeTime);
        if (settings?.sleepTime) setSleepTime(settings.sleepTime);
    }, [settings?.wakeTime, settings?.sleepTime]);

    const errors =
        selectedDays.length === 0
            ? { weekDays: { message: 'Select at least one day' } as { message: string } }
            : {};

    const runBootstrap = async (weekDays: number[] | undefined) => {
        try {
            await setupDefaults(weekDays && weekDays.length > 0 ? { weekDays } : undefined).unwrap();
            navigate('/', { replace: true });
        } catch (err: unknown) {
            const msg =
                err &&
                typeof err === 'object' &&
                'data' in err &&
                (err as { data?: { message?: string } }).data?.message;
            showErrorToast({
                title: 'Could not create phases',
                detail: typeof msg === 'string' ? msg : undefined,
            });
        }
    };

    const handleSave = async () => {
        if (selectedDays.length === 0) {
            showErrorToast({
                title: 'Select weekdays',
                detail: 'Choose at least one day of the week for your phases.',
            });
            return;
        }
        try {
            await updateSettings({ wakeTime, sleepTime }).unwrap();
            await runBootstrap(selectedDays);
        } catch {
            showErrorToast({
                title: 'Could not save settings',
                detail: 'Wake and sleep times were not saved. Try again.',
            });
        }
    };

    const handleSkip = async () => {
        await runBootstrap(undefined);
    };

    const busy = savingSettings || bootstrapping;

    return (
        <div className="page-shell-fill">
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-2xl">
                    <div className="rounded-xl border border-ide-border bg-ide-panel p-5 shadow-ide-md sm:p-8">
                        <h1 className="page-title mb-2">Set up your phases</h1>
                        <p className="page-lead mb-8">
                            Wake and sleep times define the day. Pick weekdays for default phases (e.g. Mon–Fri).
                        </p>

                        <div className="space-y-6">
                            <div>
                                <label htmlFor="setup-wake" className="ui-label">
                                    Wake
                                </label>
                                <input
                                    id="setup-wake"
                                    type="time"
                                    value={wakeTime}
                                    onChange={(e) => setWakeTime(e.target.value)}
                                    className="ui-input max-w-xs"
                                />
                            </div>
                            <div>
                                <label htmlFor="setup-sleep" className="ui-label">
                                    Sleep
                                </label>
                                <input
                                    id="setup-sleep"
                                    type="time"
                                    value={sleepTime}
                                    onChange={(e) => setSleepTime(e.target.value)}
                                    className="ui-input max-w-xs"
                                />
                            </div>
                            <WeekDaysSelector
                                selectedDays={selectedDays}
                                setSelectedDays={setSelectedDays}
                                errors={errors}
                            />
                        </div>

                        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                            <button
                                type="button"
                                disabled={busy || selectedDays.length === 0}
                                onClick={handleSave}
                                className="ui-btn-primary flex-1 sm:flex-initial sm:min-w-[200px]"
                            >
                                Save and create phases
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={handleSkip}
                                className="ui-btn-secondary flex-1 sm:flex-initial"
                            >
                                Skip — default phases
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PhaseSetupPage;
