import React from 'react';
import { Box } from '@mui/material';
import { useAuth } from './modules/auth/hooks/useAuth';
import Header from './modules/common/components/Header';
import AppRoutes from './AppRoutes';

const App: React.FC = () => {
    const { isAuthenticated } = useAuth();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {isAuthenticated && <Header />}
            <Box 
                component="main" 
                sx={{ 
                    flexGrow: 1,
                    pt: isAuthenticated ? '64px' : 0, // 64px — header height
                    overflow: 'auto',
                    height: '100%'
                }}
            >
                <AppRoutes />
            </Box>
        </Box>
    );
};

export default App;
