import { combineReducers } from '@reduxjs/toolkit';
import authReducer from 'modules/auth/reducers/authReducer';
import forgotPasswordReducer from 'modules/auth/reducers/forgotPasswordReducer';
import resetPasswordReducer from 'modules/auth/reducers/resetPasswordReducer';
import emailVerificationReducer from 'modules/auth/reducers/emailVerificationReducer';


const rootReducer = combineReducers({
    auth: authReducer,
    forgotPassword: forgotPasswordReducer,
    resetPassword: resetPasswordReducer,
    emailVerification: emailVerificationReducer,
});

export default rootReducer;
