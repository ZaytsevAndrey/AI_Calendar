import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import { googleCalendarAPI } from '../../../api/google-calendar.api';
import { toast } from 'react-toastify';

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
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100vh',
                gap: 2,
            }}
        >
            <CircularProgress />
            <Typography variant="h6">Connecting Google Calendar...</Typography>
        </Box>
    );
};

export default GoogleCallbackPage; 