import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { googleCalendarAPI } from '../../../api/google-calendar.api';
import { toast } from 'react-toastify';
import { Spinner } from '../../../ui/Spinner';

const GoogleCallbackPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const code = searchParams.get('code');

    useEffect(() => {
        const handleCallback = async () => {
            if (!code) {
                toast.error('No authorization code received');
                navigate('/settings');
                return;
            }

            try {
                await googleCalendarAPI.saveToken(code);
                toast.success('Google Calendar connected successfully');
            } catch (error) {
                console.error('Error saving Google Calendar token:', error);
                toast.error('Failed to connect Google Calendar');
            } finally {
                navigate('/settings');
            }
        };

        handleCallback();
    }, [code, navigate]);

    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ide-bg text-ide-text">
            <Spinner className="h-10 w-10" />
            <p className="text-lg font-medium text-ide-text">Connecting Google Calendar...</p>
        </div>
    );
};

export default GoogleCallbackPage;
