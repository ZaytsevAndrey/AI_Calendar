import requestsStatuses from '../../common/constants/requestsStatuses';

export function pendingAction(action: string): string {
    return `${ action }_${ requestsStatuses.pending }`;
}

export function successAction(action: string): string {
    return `${ action }_${ requestsStatuses.success }`;
}

export function failureAction(action: string): string {
    return `${ action }_${ requestsStatuses.failure }`;
}

export default function createAsyncAction(baseAction: string) {
    return {
        pending: pendingAction(baseAction),
        success: successAction(baseAction),
        failure: failureAction(baseAction),
    };
}
