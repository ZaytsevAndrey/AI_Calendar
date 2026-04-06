import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { AppBar, Toolbar, Typography, Button, Box } from '@mui/material';
import { clientLogout } from 'modules/auth/actions/logoutActions';

const Header: React.FC = () => {
    const dispatch = useDispatch();
    const location = useLocation();

    const handleLogout = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Logout button clicked');
        dispatch(clientLogout(true) as any);
    };

    const handleLogoutMouseDown = () => {
        console.log('Logout button mouse down');
    };

    const handleLogoutTouchStart = () => {
        console.log('Logout button touch start');
    };

    return (
        <AppBar position="fixed" sx={{ height: '64px' }}>
            <Toolbar>
                <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                    <Link to="/" style={{ color: 'white', textDecoration: 'none' }}>
                        AI Calendar Assistant
                    </Link>
                </Typography>
                
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button 
                        color="inherit" 
                        component={Link} 
                        to="/calendar"
                        sx={{ 
                            backgroundColor: location.pathname === '/calendar' && !location.search.includes('tab=events') ? 'rgba(255,255,255,0.1)' : 'transparent'
                        }}
                    >
                        Calendar
                    </Button>
                    <Button 
                        color="inherit" 
                        component={Link} 
                        to="/events"
                        sx={{ 
                            backgroundColor: location.pathname === '/events' ? 'rgba(255,255,255,0.1)' : 'transparent'
                        }}
                    >
                        Events
                    </Button>
                    <Button 
                        color="inherit" 
                        component={Link} 
                        to="/phases"
                        sx={{ 
                            backgroundColor: location.pathname === '/phases' ? 'rgba(255,255,255,0.1)' : 'transparent'
                        }}
                    >
                        Phases
                    </Button>
                    <Button 
                        color="inherit" 
                        component={Link} 
                        to="/settings"
                        sx={{ 
                            backgroundColor: location.pathname === '/settings' ? 'rgba(255,255,255,0.1)' : 'transparent'
                        }}
                    >
                        Settings
                    </Button>
                    <Button 
                        color="inherit" 
                        onClick={handleLogout} 
                        onMouseDown={handleLogoutMouseDown}
                        onTouchStart={handleLogoutTouchStart}
                        type="button"
                        disableRipple={false}
                        disableTouchRipple={false}
                    >
                        Logout
                    </Button>
                </Box>
            </Toolbar>
        </AppBar>
    );
};

export default Header; 