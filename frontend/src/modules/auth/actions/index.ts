import createNamespacedAction from 'modules/common/utils/createNamespacedAction';

const createAuthAction = createNamespacedAction('auth');

export default function createAction(actionType: string) {
    return createAuthAction(actionType);
}
